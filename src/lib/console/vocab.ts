/**
 * Console tunables and the labels the phone shows.
 *
 * Same role the other three vocab files play: one file to open when a number or
 * a word needs changing. Nothing here is in the stage's ES2015 fence — the
 * console is a current phone browser, and pretending otherwise would cost
 * readability for no benefit.
 */

import { EQUIPMENT, REGIONS, type Equipment, type Region } from '../catalog/vocab';
import {
  DURATIONS,
  EMPHASES,
  ENERGY_LEVELS,
  FLOOR_TOLERANCES,
  FORMAT_PREFERENCES,
  type Duration,
  type Emphasis,
  type EnergyLevel,
  type FloorTolerance,
  type FormatPreference,
} from '../planner/vocab';

/* ------------------------------------------------------------------ *
 * Timing
 * ------------------------------------------------------------------ */

/**
 * How often the phone re-reads the live cursor while a session is running.
 *
 * Matches the stage's own `SYNC_MS`. Faster would be pointless — the TV only
 * writes the cursor every ~2.25s — and slower would make the mirror visibly lag
 * the screen you are standing in front of.
 */
export const MIRROR_MS = 750;

/** How often the phone checks whether the session's status changed. */
export const STATUS_MS = 2000;

/** Local re-render cadence, so the mirrored countdown doesn't tick in steps. */
export const TICK_MS = 250;

/**
 * How long to wait for generation before offering a way out.
 *
 * Generation measures ~2 minutes, so the console's own waiting screen needs the
 * same honesty the stage's centering screen needed: past this, say so.
 */
export const GENERATION_SLOW_AFTER_MS = 90_000;

/**
 * Give up on the generate request after this long.
 *
 * The request is not the source of truth — the inserted session is — so a
 * timeout here drops back to polling for the session rather than failing. This
 * is what makes closing the phone mid-generation recoverable.
 */
export const GENERATION_TIMEOUT_MS = 300_000;

/* ------------------------------------------------------------------ *
 * Labels
 * ------------------------------------------------------------------ */

export const DURATION_OPTIONS: { value: Duration; label: string; hint: string }[] = [
  { value: 15, label: '15', hint: 'a short one' },
  { value: 25, label: '25', hint: 'the usual' },
  { value: 40, label: '40', hint: 'a full session' },
  { value: 60, label: '60', hint: 'the long one' },
];

export const ENERGY_LABELS: Record<EnergyLevel, string> = {
  flat: 'Flat',
  normal: 'Normal',
  strong: 'Strong',
};

/** What each energy level actually does, so the choice isn't a guess. */
export const ENERGY_HINTS: Record<EnergyLevel, string> = {
  flat: 'gentler, more rest',
  normal: 'as prescribed',
  strong: 'harder, less rest',
};

export const REGION_LABELS: Record<Region, string> = {
  ankle: 'Ankle',
  knee: 'Knee',
  hip: 'Hip',
  spine: 'Back',
  shoulder: 'Shoulder',
  elbow: 'Elbow',
  wrist: 'Wrist',
  neck: 'Neck',
  core: 'Core',
};

export const EQUIPMENT_LABELS: Record<Equipment, string> = {
  kettlebell: 'Kettlebell',
  dumbbell: 'Dumbbell',
  mat: 'Mat',
  wall: 'Wall',
  chair: 'Chair',
  band: 'Band',
};

export const EMPHASIS_LABELS: Record<Emphasis, string> = {
  upper: 'Upper',
  lower: 'Lower',
  full: 'Full body',
  posterior_chain: 'Posterior chain',
  core: 'Core',
};

export const FORMAT_LABELS: Record<FormatPreference, string> = {
  let_it_choose: 'Let it choose',
  circuits: 'Circuits',
  flow: 'Flow',
  straight_sets: 'Straight sets',
};

export const FLOOR_LABELS: Record<FloorTolerance, string> = {
  fine: 'Floor is fine',
  minimize_floor: 'Keep me off the floor',
};

export const CUE_LEVEL_LABELS = { off: 'Off', key: 'Key', full: 'Full' } as const;

/** Re-exported so a screen imports its options and its labels from one place. */
export {
  DURATIONS,
  EMPHASES,
  ENERGY_LEVELS,
  EQUIPMENT,
  FLOOR_TOLERANCES,
  FORMAT_PREFERENCES,
  REGIONS,
};
