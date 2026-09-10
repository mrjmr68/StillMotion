/**
 * "Substitute nearest catalog neighbour by pattern + intensity" (spec §7),
 * made concrete.
 *
 * The metric is deterministic and ties break on a stable key, so repairing the
 * same broken plan twice produces byte-identical output. That matters more than
 * it sounds: a non-deterministic repairer makes every fixture test flaky and
 * every plan diff unreadable.
 */

import type { CatalogRow } from '../catalog/schema';
import type { Checkin } from './schema';
import { satisfiesHardConstraints } from './pools';
import { NEIGHBOR_WEIGHTS, patternFamily } from './vocab';
import { FLOOR_POSITIONS } from '../catalog/vocab';

export type NeighborContext = {
  checkin: Checkin;
  /** Ids already used in the plan — substituting in a duplicate is no fix. */
  inUse: ReadonlySet<string>;
  /** Ids from the last 3 sessions; nudged away from, not forbidden. */
  recent: ReadonlySet<string>;
  allowRepeat?: boolean;
};

function jaccard(a: readonly string[], b: readonly string[]): number {
  if (a.length === 0 && b.length === 0) return 1;
  const setB = new Set(b);
  const intersection = a.filter((x) => setB.has(x)).length;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 1 : intersection / union;
}

/**
 * Lower is closer. `Infinity` means "not a legal substitute at all" — the caller
 * can therefore sort blindly and check the top result for finiteness.
 */
export function neighborDistance(
  target: CatalogRow,
  candidate: CatalogRow,
  context: NeighborContext,
): number {
  if (candidate.id === target.id) return Infinity;
  if (!satisfiesHardConstraints(candidate, context.checkin)) return Infinity;
  if (!context.allowRepeat && context.inUse.has(candidate.id)) return Infinity;

  let distance = 0;

  if (candidate.movement_pattern !== target.movement_pattern) {
    const sameFamily =
      patternFamily(candidate.movement_pattern) === patternFamily(target.movement_pattern) &&
      patternFamily(target.movement_pattern) !== -1;
    distance += sameFamily
      ? NEIGHBOR_WEIGHTS.sameFamilyDifferentPattern
      : NEIGHBOR_WEIGHTS.differentFamily;
  }

  distance += NEIGHBOR_WEIGHTS.perIntensityStep * Math.abs(candidate.intensity - target.intensity);
  distance +=
    NEIGHBOR_WEIGHTS.regionMismatch * (1 - jaccard(target.primary_regions, candidate.primary_regions));

  if (candidate.modality !== target.modality) distance += NEIGHBOR_WEIGHTS.differentModality;
  if (candidate.timing_type !== target.timing_type) distance += NEIGHBOR_WEIGHTS.differentTimingType;

  const targetOnFloor = FLOOR_POSITIONS.includes(target.body_position);
  const candidateOnFloor = FLOOR_POSITIONS.includes(candidate.body_position);
  if (targetOnFloor !== candidateOnFloor) distance += NEIGHBOR_WEIGHTS.crossesFloorBoundary;

  if (context.recent.has(candidate.id)) distance += NEIGHBOR_WEIGHTS.inRecency;

  return distance;
}

/**
 * The closest legal substitute, or null when the pool offers none.
 *
 * `extraFilter` lets a caller add a requirement the distance metric can't
 * express — "must not touch the shoulder", "must fit a main block" — without
 * that requirement leaking into the metric itself.
 */
export function nearestNeighbor(
  target: CatalogRow,
  pool: CatalogRow[],
  context: NeighborContext,
  extraFilter?: (row: CatalogRow) => boolean,
): CatalogRow | null {
  const scored = pool
    .filter((row) => (extraFilter ? extraFilter(row) : true))
    .map((row) => ({ row, distance: neighborDistance(target, row, context) }))
    .filter((entry) => Number.isFinite(entry.distance));

  if (scored.length === 0) return null;

  scored.sort((a, b) => {
    if (a.distance !== b.distance) return a.distance - b.distance;
    const intensityA = Math.abs(a.row.intensity - target.intensity);
    const intensityB = Math.abs(b.row.intensity - target.intensity);
    if (intensityA !== intensityB) return intensityA - intensityB;
    return a.row.id < b.row.id ? -1 : 1;
  });

  return scored[0].row;
}
