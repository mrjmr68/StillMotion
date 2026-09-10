/**
 * Constraint filtering, focus scoring, and the feasibility gate.
 *
 * Two mechanisms that must not be conflated:
 *   - HARD constraints remove rows. Equipment you don't own, regions you asked
 *     to avoid, movements you excluded, the floor when you asked to stay off it.
 *   - FOCUS is a scoring bias that never removes anything.
 */

import type { CatalogRow } from '../catalog/schema';
import { FLOOR_POSITIONS } from '../catalog/vocab';
import type { Checkin } from './schema';
import {
  FOCUS_BIAS,
  MIN_POOL_SIZES,
  type BlockKind,
  type Duration,
  type Focus,
} from './vocab';

/**
 * Rows that are legal for this check-in at all.
 *
 * Note avoidance tests `primary_regions` ONLY. Extending it to
 * `secondary_regions` is tempting and wrong on both counts: measured against the
 * live catalog, mat/wall/chair + "avoid hip" leaves 25 rows on primary-only but
 * 12 rows with just 2 main-work entries if secondary counts too — which makes a
 * 60-minute session arithmetically impossible. And it's wrong on the merits:
 * "avoid hip today" means don't make the hip the target, not "never let the hip
 * participate," which would rule out standing up. Secondary overlap is surfaced
 * as a warning instead.
 */
export function applyHardConstraints(catalog: CatalogRow[], checkin: Checkin): CatalogRow[] {
  const excluded = new Set(checkin.exclude_exercise_ids);
  const owned = new Set(checkin.equipment_on_hand);
  const avoided = new Set(checkin.avoid_regions);

  return catalog.filter((row) => {
    if (excluded.has(row.id)) return false;
    if (!row.equipment.every((item) => owned.has(item))) return false;
    if (row.primary_regions.some((region) => avoided.has(region))) return false;
    if (
      checkin.floor_tolerance === 'minimize_floor' &&
      FLOOR_POSITIONS.includes(row.body_position)
    ) {
      return false;
    }
    return true;
  });
}

/** True when this row would be legal — the same test, for one candidate. */
export function satisfiesHardConstraints(row: CatalogRow, checkin: Checkin): boolean {
  return applyHardConstraints([row], checkin).length === 1;
}

/**
 * Which structural slot a row can fill. Spec §7: "mobility/breath items may
 * bookend or fill rest; they never count as main work."
 */
export function fitsBlockKind(row: CatalogRow, kind: BlockKind): boolean {
  switch (kind) {
    case 'prepare':
      return (row.modality === 'mobility' || row.modality === 'breath') && row.intensity <= 2;
    case 'down_regulate':
      return (
        (row.modality === 'breath' || row.modality === 'yoga' || row.modality === 'mobility') &&
        row.intensity <= 2
      );
    case 'main':
      return (
        (row.modality === 'strength' || row.modality === 'capacity' || row.modality === 'balance') &&
        row.intensity >= 3
      );
    case 'integrate':
      // The bridge between prep and load — anything moderate.
      return row.intensity >= 2 && row.intensity <= 4;
  }
}

export function poolFor(catalog: CatalogRow[], kind: BlockKind): CatalogRow[] {
  return catalog.filter((row) => fitsBlockKind(row, kind));
}

/**
 * How well a row serves today's focus. Additive, never negative, never a filter.
 * Used to order the prompt's table hint and to break ties during repair.
 */
export function focusScore(row: CatalogRow, focus: Focus): number {
  const bias = FOCUS_BIAS[focus];
  let score = 0;

  if (bias.modalities?.[row.modality]) score += bias.modalities[row.modality] ?? 0;
  if (bias.patterns?.[row.movement_pattern]) score += bias.patterns[row.movement_pattern] ?? 0;
  if (bias.timingTypes?.[row.timing_type]) score += bias.timingTypes[row.timing_type] ?? 0;
  if (bias.unilateral && row.unilateral) score += bias.unilateral;
  if (bias.standing && row.body_position === 'standing') score += bias.standing;
  if (bias.intensityAtMost && row.intensity <= bias.intensityAtMost.value) {
    score += bias.intensityAtMost.bonus;
  }
  if (bias.intensityAtLeast && row.intensity >= bias.intensityAtLeast.value) {
    score += bias.intensityAtLeast.bonus;
  }

  return score;
}

export type Feasibility = {
  ok: boolean;
  counts: { prep: number; main: number; downreg: number };
  required: { prep: number; main: number; downreg: number };
  shortfalls: string[];
};

/**
 * Can a session of this length be built from this pool at all?
 *
 * Runs BEFORE generation, because a 20-30 second call that cannot succeed is
 * worse than no call. Below the minimum there is no session to be had and the
 * template is served; above it the plan degrades instead — fewer distinct
 * movements, more rounds, more repetition, but still a real plan.
 */
export function feasibility(pool: CatalogRow[], duration: Duration): Feasibility {
  const counts = {
    prep: poolFor(pool, 'prepare').length,
    main: poolFor(pool, 'main').length,
    downreg: poolFor(pool, 'down_regulate').length,
  };
  const required = MIN_POOL_SIZES[duration];

  const shortfalls: string[] = [];
  if (counts.prep < required.prep) {
    shortfalls.push(`prepare: ${counts.prep} of ${required.prep} needed`);
  }
  if (counts.main < required.main) {
    shortfalls.push(`main work: ${counts.main} of ${required.main} needed`);
  }
  if (counts.downreg < required.downreg) {
    shortfalls.push(`down-regulate: ${counts.downreg} of ${required.downreg} needed`);
  }

  return { ok: shortfalls.length === 0, counts, required, shortfalls };
}
