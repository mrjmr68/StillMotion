/**
 * Validation for catalog entries, in two layers.
 *
 * `DraftEntrySchema` is what the LLM is asked to produce. It is deliberately
 * structural only — no `.refine()`, because refinements do not survive
 * compilation to JSON Schema and would be a silent no-op on the model side.
 * Every cross-field rule therefore runs in TypeScript afterwards.
 *
 * `CatalogRowSchema` + the finding helpers cover the full derived row. Errors
 * mirror the DB's CHECK constraints, so we fail here rather than paying for
 * generation and then eating a 23514 at INSERT. Warnings are style/quality
 * signals that annotate an entry for review without blocking it.
 */

import { z } from 'zod';
import {
  ASSET_TIERS,
  BODY_POSITIONS,
  CUES_DB_MAX,
  CUES_DB_MIN,
  CUES_MAX,
  CUES_MIN,
  CUE_MAX_WORDS,
  DOSE_BANDS,
  EQUIPMENT,
  FLOOR_POSITIONS,
  INTENSITY_MAX,
  INTENSITY_MIN,
  MODALITIES,
  MOVEMENT_PATTERNS,
  REGIONS,
  TIMING_TYPES,
} from './vocab';

/* ------------------------------------------------------------------ *
 * Draft — the LLM's output contract
 * ------------------------------------------------------------------ */

/**
 * Note every field is required and nullable rather than optional: constrained
 * decoding is more reliable when the model must emit every key, and an explicit
 * null is easier to reason about than an absent property.
 *
 * Relations are `*_hint` fields holding movement NAMES, never ids. The model is
 * making a movement-science claim ("the harder version is a single-leg RDL"),
 * not a database claim — and it cannot reference ids that don't exist yet.
 * Resolution to real ids happens at import time.
 */
export const DraftEntrySchema = z.strictObject({
  name: z.string().min(1),
  aka: z.array(z.string().min(1)),

  modality: z.enum(MODALITIES),
  movement_pattern: z.enum(MOVEMENT_PATTERNS),

  primary_regions: z.array(z.enum(REGIONS)).min(1),
  secondary_regions: z.array(z.enum(REGIONS)),

  equipment: z.array(z.enum(EQUIPMENT)),
  body_position: z.enum(BODY_POSITIONS),
  unilateral: z.boolean(),

  timing_type: z.enum(TIMING_TYPES),
  /** Per SIDE for unilateral movements. Seconds or a count, depending on timing_type. */
  default_dose: z.number().int().positive(),
  /** Only meaningful when timing_type is 'reps'; bounds the WHOLE block. */
  rep_cap_seconds: z.number().int().positive().nullable(),

  intensity: z.number().int().min(INTENSITY_MIN).max(INTENSITY_MAX),

  /** Policy is 2-4; the DB allows 1-6. Bounded loosely so style never hard-fails a parse. */
  cues: z.array(z.string().min(1)).min(CUES_DB_MIN).max(CUES_DB_MAX),
  setup_note: z.string().nullable(),

  progression_hint: z.string().nullable(),
  regression_hint: z.string().nullable(),
  pairs_well_with_hints: z.array(z.string().min(1)),
  avoid_after_hints: z.array(z.string().min(1)),
});

export type DraftEntry = z.infer<typeof DraftEntrySchema>;

/** What one generation call returns. */
export const BatchSchema = z.strictObject({
  entries: z.array(DraftEntrySchema),
});

export type Batch = z.infer<typeof BatchSchema>;

/* ------------------------------------------------------------------ *
 * Row — the shape that actually reaches Postgres
 * ------------------------------------------------------------------ */

export const CatalogRowSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1),
  aka: z.array(z.string()),
  modality: z.enum(MODALITIES),
  movement_pattern: z.enum(MOVEMENT_PATTERNS),
  primary_regions: z.array(z.enum(REGIONS)),
  secondary_regions: z.array(z.enum(REGIONS)),
  equipment: z.array(z.enum(EQUIPMENT)),
  body_position: z.enum(BODY_POSITIONS),
  unilateral: z.boolean(),
  timing_type: z.enum(TIMING_TYPES),
  default_dose: z.number().int().positive(),
  rep_cap_seconds: z.number().int().positive().nullable(),
  intensity: z.number().int().min(INTENSITY_MIN).max(INTENSITY_MAX),
  progression_id: z.string().nullable(),
  regression_id: z.string().nullable(),
  pairs_well_with: z.array(z.string()),
  avoid_after: z.array(z.string()),
  cues: z.array(z.string()).min(CUES_DB_MIN).max(CUES_DB_MAX),
  setup_note: z.string().nullable(),
  asset_tier: z.enum(ASSET_TIERS),
  asset_path: z.string().min(1),
  loop_seconds: z.number().positive().nullable(),
  is_anchor: z.boolean(),
});

export type CatalogRow = z.infer<typeof CatalogRowSchema>;

export type Finding = { code: string; message: string };

/**
 * Cross-field rules that mirror the DB's CHECK constraints. Anything returned
 * here would fail at INSERT, so it blocks import.
 */
export function rowErrors(row: CatalogRow): Finding[] {
  const findings: Finding[] = [];
  const parsed = CatalogRowSchema.safeParse(row);

  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const path = issue.path.join('.') || '(root)';
      findings.push({ code: 'schema', message: path + ': ' + issue.message });
    }
  }

  // constraint rep_cap_matches_timing
  if (row.timing_type === 'reps' && row.rep_cap_seconds === null) {
    findings.push({
      code: 'rep_cap_required',
      message: "timing_type 'reps' requires rep_cap_seconds",
    });
  }
  if (row.timing_type !== 'reps' && row.rep_cap_seconds !== null) {
    findings.push({
      code: 'rep_cap_forbidden',
      message: "timing_type '" + row.timing_type + "' requires rep_cap_seconds to be null",
    });
  }

  // A still image has no loop duration.
  if (row.asset_tier === 'still' && row.loop_seconds !== null) {
    findings.push({
      code: 'loop_seconds_forbidden',
      message: "asset_tier 'still' requires loop_seconds to be null",
    });
  }

  // constraints progression_not_self / regression_not_self
  if (row.progression_id !== null && row.progression_id === row.id) {
    findings.push({ code: 'self_progression', message: 'progression_id equals id' });
  }
  if (row.regression_id !== null && row.regression_id === row.id) {
    findings.push({ code: 'self_regression', message: 'regression_id equals id' });
  }

  return findings;
}

/**
 * Style and plausibility signals. These never block — they are exactly the
 * material the review pass should be looking at.
 */
export function rowWarnings(row: CatalogRow): Finding[] {
  const findings: Finding[] = [];

  if (row.cues.length < CUES_MIN || row.cues.length > CUES_MAX) {
    findings.push({
      code: 'cue_count',
      message: row.cues.length + ' cues; policy is ' + CUES_MIN + '-' + CUES_MAX,
    });
  }

  for (const cue of row.cues) {
    const words = cue.trim().split(/\s+/).length;
    if (words > CUE_MAX_WORDS) {
      findings.push({ code: 'cue_too_long', message: words + ' words: "' + cue + '"' });
    }
    // Two ideas in one cue — the spec asks for one idea per line.
    //
    // Only a semicolon is checked. An earlier version also flagged the word
    // "and", which was wrong 18 times out of 19 on the first real catalog:
    // "Land soft and quiet", "Shoulders back and down", "Move opposite hand
    // and knee" are all a single idea. A rule with that false-positive rate
    // is worse than no rule, because it trains you to skim past warnings.
    if (cue.includes(';')) {
      findings.push({ code: 'cue_two_ideas', message: 'semicolon joins two ideas: "' + cue + '"' });
    }
  }

  const overlap = row.primary_regions.filter((r) => row.secondary_regions.includes(r));
  if (overlap.length > 0) {
    findings.push({
      code: 'region_overlap',
      message: 'in both primary and secondary: ' + overlap.join(', '),
    });
  }

  if (FLOOR_POSITIONS.includes(row.body_position) && !row.equipment.includes('mat')) {
    findings.push({
      code: 'floor_without_mat',
      message: "body_position '" + row.body_position + "' but no mat in equipment",
    });
  }

  const band = DOSE_BANDS[row.timing_type];
  if (row.default_dose < band.min || row.default_dose > band.max) {
    findings.push({
      code: 'dose_out_of_band',
      message:
        row.default_dose + ' ' + band.unit + '; typical is ' + band.min + '-' + band.max,
    });
  }

  return findings;
}
