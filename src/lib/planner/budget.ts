/**
 * Time budgeting. Pure — no I/O, no Supabase, no environment.
 *
 * This module is deliberately importable from three places: the validator (to
 * check spec §7's ±10% rule), the stage runtime later (to drive the countdown),
 * and a fixture test with no environment at all. If the TV ever computes a
 * countdown differently from `itemWorkSeconds`, the ±10% guarantee silently
 * becomes false — so this must be shared, never re-derived.
 */

import type { CatalogRow } from '../catalog/schema';
import {
  BLOCK_CHANGE_SECONDS,
  EQUIPMENT_CHANGE_SECONDS,
  INTER_SIDE_REST_SECONDS,
  POSITION_CHANGE_SECONDS_PER_TIER,
  POSITION_TIER,
  REPS_ESTIMATE_MAX_FACTOR,
  REPS_ESTIMATE_MIN_FACTOR,
  SECONDS_PER_BREATH,
} from './vocab';
import type { PlanBlock, PlanItem, PlanTotals } from './schema';

/**
 * Work time for ONE side of one item.
 *
 * The reps branch is the whole reason `rep_cap_seconds` exists. The cap is
 * calibrated against the movement's own `default_dose`, so prescribing 6 reps of
 * something whose default is 10 reps / 45s estimates ~27s rather than 45s.
 * Without that scaling every dose the repairer touches would be invisible to the
 * budget, and the ±10% check would be measuring the wrong plan.
 */
export function itemWorkSeconds(row: CatalogRow, dose: number): number {
  switch (row.timing_type) {
    case 'duration':
    case 'hold_per_side':
      return dose;

    case 'breaths':
      return dose * SECONDS_PER_BREATH;

    case 'reps': {
      const cap = row.rep_cap_seconds ?? dose * 4;
      const scaled = (cap * dose) / Math.max(row.default_dose, 1);
      return Math.round(
        Math.min(
          Math.max(scaled, cap * REPS_ESTIMATE_MIN_FACTOR),
          cap * REPS_ESTIMATE_MAX_FACTOR,
        ),
      );
    }
  }
}

/**
 * Lead-in cost before an item: changing position, swapping equipment, and
 * reading a new block card.
 *
 * `body_position` earns its place in the catalog for exactly this (spec §5) — a
 * session that flips standing→floor→standing six times feels bad in a way
 * that's hard to name and easy to detect programmatically.
 */
export function transitionSeconds(
  previous: CatalogRow | null,
  next: CatalogRow,
  crossesBlockBoundary: boolean,
): number {
  let seconds = crossesBlockBoundary ? BLOCK_CHANGE_SECONDS : 0;
  if (!previous) return seconds;

  const tierDelta = Math.abs(POSITION_TIER[next.body_position] - POSITION_TIER[previous.body_position]);
  seconds += tierDelta * POSITION_CHANGE_SECONDS_PER_TIER;

  const before = [...previous.equipment].sort().join(',');
  const after = [...next.equipment].sort().join(',');
  if (before !== after) seconds += EQUIPMENT_CHANGE_SECONDS;

  return seconds;
}

/** Everything one item costs: work on each side, side switches, rest, lead-in. */
export function itemTotalSeconds(item: PlanItem): number {
  const sides = item.sides.length;
  return (
    item.work_seconds * sides +
    INTER_SIDE_REST_SECONDS * (sides - 1) +
    item.rest_seconds +
    item.transition_seconds
  );
}

/** Work only — no rest, no transitions. Used for the main-work fraction. */
export function itemWorkTotalSeconds(item: PlanItem): number {
  return item.work_seconds * item.sides.length;
}

export function planTiming(blocks: PlanBlock[], requestedMinutes: number): PlanTotals {
  let work = 0;
  let rest = 0;
  let transition = 0;
  let mainWork = 0;

  for (const block of blocks) {
    for (const item of block.items) {
      const itemWork = itemWorkTotalSeconds(item);
      work += itemWork + INTER_SIDE_REST_SECONDS * (item.sides.length - 1);
      rest += item.rest_seconds;
      transition += item.transition_seconds;
      if (block.kind === 'main') mainWork += itemWork;
    }
  }

  const total = work + rest + transition;
  const requested = requestedMinutes * 60;

  return {
    work_seconds: work,
    rest_seconds: rest,
    transition_seconds: transition,
    total_seconds: total,
    main_work_seconds: mainWork,
    requested_seconds: requested,
    drift_pct: (total - requested) / requested,
  };
}

/** Every item in the plan, flattened in the order the session runs. */
export function flatItems(blocks: PlanBlock[]): { block: PlanBlock; item: PlanItem }[] {
  return blocks.flatMap((block) => block.items.map((item) => ({ block, item })));
}

export function formatSeconds(seconds: number): string {
  const rounded = Math.round(seconds);
  const minutes = Math.floor(rounded / 60);
  const remainder = rounded % 60;
  return `${minutes}:${String(remainder).padStart(2, '0')}`;
}
