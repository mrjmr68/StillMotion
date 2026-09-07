/**
 * Turning an LLM draft into the row that actually reaches Postgres.
 *
 * The dividing line: the LLM owns any field where a wrong value is a
 * movement-science judgment a human must adjudicate. The harness owns any field
 * where, given the other fields, there is exactly one correct value — because
 * there a wrong value is a bug, not an opinion.
 */

import { deriveId } from '../../../src/lib/catalog/ids';
import {
  rowErrors,
  rowWarnings,
  type CatalogRow,
  type DraftEntry,
  type Finding,
} from '../../../src/lib/catalog/schema';
import { REP_CAP_SECONDS_PER_REP } from '../../../src/lib/catalog/vocab';

/** The subset of a row the harness computes rather than the model. */
export type DerivedFields = Pick<
  CatalogRow,
  'id' | 'asset_tier' | 'asset_path' | 'loop_seconds' | 'rep_cap_seconds' | 'is_anchor'
>;

export function deriveFields(
  draft: DraftEntry,
  options: { taken?: ReadonlySet<string>; idOverride?: string | null } = {},
): DerivedFields {
  const id =
    options.idOverride ?? deriveId(draft.movement_pattern, draft.name, options.taken ?? new Set());

  return {
    id,

    // Tier 0. Not a judgment — it is the tier the project is at.
    asset_tier: 'still',

    // Per-id, not a shared placeholder: dropping real art at this path later
    // needs no row update, which is what makes "improves without a code change" true.
    asset_path: `catalog/${id}/still.svg`,

    // Mechanically coupled to the tier — a single still has no loop duration.
    loop_seconds: null,

    // The COUPLING is a DB CHECK (rep_cap is required iff timing is reps, and
    // forbidden otherwise); the MAGNITUDE is judgment, so take the model's value
    // when it gave one and fall back to a rough seconds-per-rep estimate.
    // Bounds the whole reps block, not one rep (see docs/DECISIONS.md).
    rep_cap_seconds:
      draft.timing_type === 'reps'
        ? (draft.rep_cap_seconds ?? Math.ceil(draft.default_dose * REP_CAP_SECONDS_PER_REP))
        : null,

    // Always false. The spec's own open-items list says the anchor set is an
    // undecided owner decision; letting the model guess would silently
    // manufacture a decision that was explicitly deferred.
    is_anchor: false,
  };
}

/**
 * Assemble the full row. Relation columns are left null here — the model emits
 * relation *hints* as movement names, and those resolve to real ids at import
 * time against the union of every drafted and already-imported entry.
 */
export function toCatalogRow(draft: DraftEntry, derived: DerivedFields): CatalogRow {
  return {
    id: derived.id,
    name: draft.name,
    aka: draft.aka,
    modality: draft.modality,
    movement_pattern: draft.movement_pattern,
    primary_regions: draft.primary_regions,
    secondary_regions: draft.secondary_regions,
    equipment: draft.equipment,
    body_position: draft.body_position,
    unilateral: draft.unilateral,
    timing_type: draft.timing_type,
    default_dose: draft.default_dose,
    rep_cap_seconds: derived.rep_cap_seconds,
    intensity: draft.intensity,
    progression_id: null,
    regression_id: null,
    pairs_well_with: [],
    avoid_after: [],
    cues: draft.cues,
    setup_note: draft.setup_note,
    asset_tier: derived.asset_tier,
    asset_path: derived.asset_path,
    loop_seconds: derived.loop_seconds,
    is_anchor: derived.is_anchor,
  };
}

/**
 * Recompute everything downstream of `draft` for an entry loaded from disk.
 *
 * `derived`, `errors`, and `warnings` are all functions of `draft`, so they are
 * refreshed on every command rather than trusted from the file — otherwise
 * editing a name in the JSON would leave a stale id pointing at the old one.
 *
 * The exception is an already-imported entry: its id is frozen, because
 * `exercise_logs` and `user_movement_preferences` FK into it and re-keying the
 * row would orphan that history.
 */
export function refreshEntry<
  T extends {
    draft: DraftEntry;
    derived: DerivedFields;
    idOverride: string | null;
    importedAt: string | null;
    errors: Finding[];
    warnings: Finding[];
  },
>(entry: T, taken: ReadonlySet<string> = new Set()): T {
  const frozenId = entry.importedAt ? entry.derived.id : null;
  const derived = deriveFields(entry.draft, {
    taken,
    idOverride: frozenId ?? entry.idOverride,
  });
  const row = toCatalogRow(entry.draft, derived);

  return { ...entry, derived, errors: rowErrors(row), warnings: rowWarnings(row) };
}
