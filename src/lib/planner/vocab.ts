/**
 * Planner vocabulary and tunables.
 *
 * Same role `src/lib/catalog/vocab.ts` plays for the catalog: one file that
 * feeds BOTH the zod schemas and the LLM prompt, so the rules the model is told
 * and the rules the validator enforces cannot drift apart.
 *
 * Every magic number in the planner lives here as a named constant. If you find
 * yourself tuning a threshold, this is the only file you should have to open.
 */

import type { BodyPosition, MovementPattern } from '../catalog/vocab';

/** Bump when the stored SessionPlan shape changes incompatibly. */
export const PLAN_VERSION = 1;

/* ------------------------------------------------------------------ *
 * Session structure (spec §7: prepare → integrate → main work → down-regulate)
 * ------------------------------------------------------------------ */

export const BLOCK_KINDS = ['prepare', 'integrate', 'main', 'down_regulate'] as const;
export type BlockKind = (typeof BLOCK_KINDS)[number];

/** The order blocks must appear in. `integrate` is optional; `main` may repeat. */
export const BLOCK_ORDER: Record<BlockKind, number> = {
  prepare: 0,
  integrate: 1,
  main: 2,
  down_regulate: 3,
};

export const BLOCK_FORMATS = ['circuit', 'straight', 'flow'] as const;
export type BlockFormat = (typeof BLOCK_FORMATS)[number];

/* ------------------------------------------------------------------ *
 * Check-in (spec §6)
 * ------------------------------------------------------------------ */

export const DURATIONS = [15, 25, 40, 60] as const;
export type Duration = (typeof DURATIONS)[number];

export const ENERGY_LEVELS = ['flat', 'normal', 'strong'] as const;
export type EnergyLevel = (typeof ENERGY_LEVELS)[number];

export const FOCUSES = ['surprise', 'mobility', 'strength', 'sweat', 'balance', 'stretch'] as const;
export type Focus = (typeof FOCUSES)[number];

/** The spec's user-facing labels, for prompts and UI. */
export const FOCUS_LABELS: Record<Focus, string> = {
  surprise: 'surprise me',
  mobility: 'loose & mobile',
  strength: 'strength',
  sweat: 'sweat',
  balance: 'balance & control',
  stretch: 'long stretch',
};

export const EMPHASES = ['upper', 'lower', 'full', 'posterior_chain', 'core'] as const;
export type Emphasis = (typeof EMPHASES)[number];

export const FORMAT_PREFERENCES = ['let_it_choose', 'circuits', 'flow', 'straight_sets'] as const;
export type FormatPreference = (typeof FORMAT_PREFERENCES)[number];

export const FLOOR_TOLERANCES = ['fine', 'minimize_floor'] as const;
export type FloorTolerance = (typeof FLOOR_TOLERANCES)[number];

/* ------------------------------------------------------------------ *
 * Time budget
 * ------------------------------------------------------------------ */

/** Spec §7: total time within ±10% of requested. */
export const TIME_TOLERANCE = 0.1;

/** A breath is roughly five seconds at the cadences this system prescribes. */
export const SECONDS_PER_BREATH = 5;

/** Switching sides on a unilateral item. */
export const INTER_SIDE_REST_SECONDS = 5;

/**
 * How far a reps estimate may stray from the movement's own rep cap. The cap is
 * calibrated against `default_dose`, so a dose below default scales the estimate
 * down — but never below half the cap (setup dominates) or above 1.25x (past
 * that the cap itself should have been higher).
 */
export const REPS_ESTIMATE_MIN_FACTOR = 0.5;
export const REPS_ESTIMATE_MAX_FACTOR = 1.25;

/**
 * Transition cost. `body_position` exists in the catalog precisely because
 * transition cost is a real quality signal (spec §5) — a session that flips
 * standing→floor→standing six times feels bad in a way that is hard to name and
 * easy to detect programmatically.
 */
export const POSITION_TIER: Record<BodyPosition, number> = {
  standing: 0,
  seated: 1,
  kneeling: 2,
  quadruped: 3,
  prone: 3,
  supine: 3,
};

export const POSITION_CHANGE_SECONDS_PER_TIER = 5;
export const EQUIPMENT_CHANGE_SECONDS = 8;
/** Reading the block card and setting up for what's next. */
export const BLOCK_CHANGE_SECONDS = 20;

/**
 * Churn threshold. A flat percentage trips on every 15-minute plan regardless of
 * how well sequenced it is (900s x 10% = 90s of tolerance, while a 10-item
 * session incurs 100-150s of transitions), so the threshold has a floor.
 */
export const TRANSITION_CHURN_FLOOR_SECONDS = 60;
export const TRANSITION_CHURN_FRACTION = 0.1;
/** Standing→floor→standing round trips before it reads as churn. */
export const MAX_FLOOR_ROUND_TRIPS = 3;

/* ------------------------------------------------------------------ *
 * Structural thresholds
 * ------------------------------------------------------------------ */

/** Spec §7: "hardest work is not in the final 15% of the session." */
export const FINAL_STRETCH_FRACTION = 0.15;

/** Spec §7: "mobility/breath items ... never count as main work." */
export const MAIN_WORK_MIN_FRACTION = 0.4;
export const MAIN_WORK_WARN_FRACTION = 0.55;

/** Spec §7: "no more than two consecutive items sharing a primary region." */
export const MAX_CONSECUTIVE_SHARED_REGION = 2;

/** A main block with fewer items than this isn't a block. */
export const MIN_MAIN_BLOCK_ITEMS = 2;

/**
 * Rest bands by block kind, in seconds — the floor and ceiling the time repairer
 * may move rest between before it has to touch actual content.
 */
export const REST_BANDS: Record<BlockKind, { min: number; max: number }> = {
  prepare: { min: 0, max: 20 },
  integrate: { min: 0, max: 30 },
  main: { min: 15, max: 90 },
  down_regulate: { min: 0, max: 15 },
};

/* ------------------------------------------------------------------ *
 * Feasibility
 * ------------------------------------------------------------------ */

/**
 * Below these pool sizes there is no session to be had, so generation is skipped
 * entirely and the template is served instead. Checked BEFORE spending 20-30
 * seconds on a call that cannot succeed.
 */
export const MIN_POOL_SIZES: Record<Duration, { prep: number; main: number; downreg: number }> = {
  15: { prep: 2, main: 4, downreg: 2 },
  25: { prep: 3, main: 6, downreg: 2 },
  40: { prep: 3, main: 8, downreg: 3 },
  60: { prep: 4, main: 10, downreg: 3 },
};

/* ------------------------------------------------------------------ *
 * Pattern families — for neighbour distance
 * ------------------------------------------------------------------ */

export const PATTERN_FAMILIES: readonly (readonly MovementPattern[])[] = [
  ['push_h', 'push_v'],
  ['pull_h', 'pull_v'],
  ['hinge', 'squat', 'lunge'],
  ['rotate', 'anti_rotate'],
  ['gait', 'carry', 'ground_transition'],
];

export function patternFamily(pattern: MovementPattern): number {
  return PATTERN_FAMILIES.findIndex((family) => family.includes(pattern));
}

/** Upper/lower classification, for the agonist/antagonist alternation check. */
export const UPPER_PATTERNS: readonly MovementPattern[] = [
  'push_h',
  'push_v',
  'pull_h',
  'pull_v',
];
export const LOWER_PATTERNS: readonly MovementPattern[] = ['hinge', 'squat', 'lunge', 'gait'];

/* ------------------------------------------------------------------ *
 * Neighbour distance weights
 * ------------------------------------------------------------------ */

export const NEIGHBOR_WEIGHTS = {
  sameFamilyDifferentPattern: 2,
  differentFamily: 6,
  perIntensityStep: 3,
  regionMismatch: 4,
  differentModality: 1,
  crossesFloorBoundary: 2,
  differentTimingType: 1,
  inRecency: 1,
} as const;

/** How far a substituted item's work time may drift from what it replaced. */
export const SUBSTITUTE_WORK_TOLERANCE = 0.2;

/* ------------------------------------------------------------------ *
 * Focus scoring (spec §6)
 * ------------------------------------------------------------------ */

/**
 * Focus is a scoring BIAS, never a filter.
 *
 * This is what makes "balance & control" work despite the catalog having zero
 * entries with `modality: 'balance'`: the label promises a quality of movement —
 * single-leg work, carries, gait, ground transitions — not a database column.
 * Biasing rather than filtering yields ~31 candidates for it.
 *
 * Filtering would also be wrong for every other focus: "strength" shouldn't make
 * mobility prep unschedulable, it should make the main work strength-flavoured.
 */
export type FocusBias = {
  modalities?: Partial<Record<string, number>>;
  patterns?: Partial<Record<MovementPattern, number>>;
  timingTypes?: Partial<Record<string, number>>;
  unilateral?: number;
  standing?: number;
  intensityAtMost?: { value: number; bonus: number };
  intensityAtLeast?: { value: number; bonus: number };
};

export const FOCUS_BIAS: Record<Focus, FocusBias> = {
  surprise: {},
  mobility: {
    modalities: { mobility: 3, yoga: 3 },
    intensityAtMost: { value: 2, bonus: 1 },
  },
  strength: {
    modalities: { strength: 3 },
    intensityAtLeast: { value: 3, bonus: 2 },
  },
  sweat: {
    modalities: { capacity: 3 },
    patterns: { gait: 2 },
    intensityAtLeast: { value: 4, bonus: 2 },
  },
  balance: {
    unilateral: 3,
    patterns: { gait: 2, carry: 2, lunge: 2, ground_transition: 2, anti_rotate: 2 },
    standing: 1,
  },
  stretch: {
    modalities: { yoga: 3, mobility: 3 },
    timingTypes: { hold_per_side: 2, duration: 2, breaths: 2 },
  },
};

/**
 * Told to the model verbatim, because otherwise it hunts for a modality that
 * does not exist and either invents an id or returns a thin block.
 */
export const BALANCE_FOCUS_NOTE =
  'Balance & control means unilateral work, carries, gait, and ground transitions. ' +
  'There are no entries with modality "balance" — do not look for them.';

/* ------------------------------------------------------------------ *
 * Overhead-loading detection (spec §7: never load a joint overhead before it
 * has been taken through range)
 * ------------------------------------------------------------------ */

export const OVERHEAD_LOADED_MIN_INTENSITY = 3;

/**
 * Catches overhead loading that `movement_pattern` alone misses — an overhead
 * carry is `carry`, a windmill is `rotate`, a get-up is `ground_transition`.
 *
 * This is the one rule the schema genuinely cannot express. The honest fix is a
 * `loads_overhead` column on `exercise_catalog`; this heuristic is correct on
 * all 91 current rows, so that migration is deferred rather than skipped.
 */
export const OVERHEAD_NAME_PATTERN = /overhead|push press|snatch|jerk|windmill|get.?up/i;

/** Preference order for the prep item inserted to satisfy the overhead rule. */
export const OVERHEAD_PREP_PREFERENCE = [
  'push_v_wall_slide',
  'push_v_banded_shoulder_pass_through',
  'push_v_supine_overhead_reach',
  'rotate_thread_the_needle',
];
