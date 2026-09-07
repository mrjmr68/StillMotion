/**
 * The catalog's controlled vocabulary — the single source of truth.
 *
 * This file exists because `exercise_catalog` uses `text` + `CHECK` rather than
 * native Postgres enums (see docs/DECISIONS.md), and `supabase gen types` types
 * a CHECK-constrained column as a bare `string`. That decision explicitly
 * anticipated hand-maintaining this file.
 *
 * It serves double duty: `schema.ts` builds every zod enum from these arrays,
 * and the generation prompt interpolates the same arrays. Prompt and validator
 * therefore cannot disagree about what values are legal.
 *
 * Keep in sync with supabase/migrations/20260807120100_exercise_catalog.sql.
 * `catalog:check --vocab` (increment 2) will diff these against the live CHECKs.
 */

export const MODALITIES = [
  'mobility',
  'yoga',
  'strength',
  'capacity',
  'balance',
  'breath',
] as const;
export type Modality = (typeof MODALITIES)[number];

export const MOVEMENT_PATTERNS = [
  'hinge',
  'squat',
  'lunge',
  'push_h',
  'push_v',
  'pull_h',
  'pull_v',
  'rotate',
  'anti_rotate',
  'carry',
  'gait',
  'ground_transition',
] as const;
export type MovementPattern = (typeof MOVEMENT_PATTERNS)[number];

export const REGIONS = [
  'ankle',
  'knee',
  'hip',
  'spine',
  'shoulder',
  'elbow',
  'wrist',
  'neck',
  'core',
] as const;
export type Region = (typeof REGIONS)[number];

/**
 * Note there is no 'none' member: absence of equipment is the empty array, so
 * that `equipment: ['none', 'mat']` can't be expressed at all.
 */
export const EQUIPMENT = [
  'kettlebell',
  'dumbbell',
  'mat',
  'wall',
  'chair',
  'band',
] as const;
export type Equipment = (typeof EQUIPMENT)[number];

export const BODY_POSITIONS = [
  'standing',
  'kneeling',
  'seated',
  'prone',
  'supine',
  'quadruped',
] as const;
export type BodyPosition = (typeof BODY_POSITIONS)[number];

/** Body positions that put you on the floor — used for the mat-check warning. */
export const FLOOR_POSITIONS: readonly BodyPosition[] = [
  'prone',
  'supine',
  'quadruped',
  'kneeling',
];

export const TIMING_TYPES = [
  'duration',
  'reps',
  'breaths',
  'hold_per_side',
] as const;
export type TimingType = (typeof TIMING_TYPES)[number];

export const ASSET_TIERS = ['still', 'pose_cycle', 'animated'] as const;
export type AssetTier = (typeof ASSET_TIERS)[number];

export const INTENSITY_MIN = 1;
export const INTENSITY_MAX = 5;

/**
 * The DB CHECK allows 1..6 cues; project policy is 2..4 (spec §5).
 * The headroom is deliberate — the DB shouldn't have to migrate if the style
 * guide loosens. Policy is enforced here, in TS, where it can be a warning.
 */
export const CUES_DB_MIN = 1;
export const CUES_DB_MAX = 6;
export const CUES_MIN = 2;
export const CUES_MAX = 4;

/** Spec §8: "under nine words, imperative, one idea." */
export const CUE_MAX_WORDS = 8;

/**
 * Sane dose bands per timing type, used for warnings only — a value outside
 * the band is suspicious, not illegal.
 *
 * Units: seconds for `duration` and `hold_per_side`, a count for `reps` and
 * `breaths`. For unilateral movements the dose is PER SIDE (owner decision;
 * see docs/DECISIONS.md) — the runtime schedules both sides automatically.
 */
export const DOSE_BANDS: Record<TimingType, { min: number; max: number; unit: string }> = {
  duration: { min: 20, max: 120, unit: 'seconds' },
  reps: { min: 3, max: 20, unit: 'reps' },
  breaths: { min: 3, max: 10, unit: 'breaths' },
  hold_per_side: { min: 15, max: 60, unit: 'seconds per side' },
};

/**
 * Fallback multiplier for deriving `rep_cap_seconds` when the model doesn't
 * supply one: roughly four seconds per rep. `rep_cap_seconds` bounds the WHOLE
 * reps block, not one rep (owner decision; see docs/DECISIONS.md).
 */
export const REP_CAP_SECONDS_PER_REP = 4;
