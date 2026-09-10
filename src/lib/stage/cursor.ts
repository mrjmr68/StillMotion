/**
 * Translating between the runtime cursor (a timeline index) and the persisted
 * cursor (`session_live_state`'s block/item/side columns).
 *
 * Why both exist: `phase_index` is authoritative and is what a mid-session TV
 * reload restores from, but `{block_index, item_index, side}` is what
 * `exercise_logs` is keyed on and what a human reads in the table editor. The
 * round-trip between them has to be exact, which is why `stage:check` asserts
 * it for every phase of every template — a cursor that doesn't round-trip means
 * a reload silently resumes in the wrong place.
 */

import type { Phase } from './timeline';

export type PersistedCursor = {
  phase_index: number;
  phase: string;
  block_index: number;
  item_index: number;
  side: 'left' | 'right' | null;
};

export function toCursor(phase: Phase): PersistedCursor {
  return {
    phase_index: phase.index,
    phase: phase.kind,
    block_index: phase.blockIndex,
    item_index: phase.itemIndex,
    // 'both' persists as null: the column exists to say WHICH side of a
    // unilateral movement is running, and a bilateral movement has no answer.
    side: phase.side === 'both' ? null : phase.side,
  };
}

export function phaseAt(timeline: Phase[], index: number): Phase | null {
  if (index < 0 || index >= timeline.length) return null;
  return timeline[index];
}

/**
 * Recover a timeline index from a persisted cursor.
 *
 * Prefers `phase_index` — it is exact. The block/item/side scan is a fallback
 * for a row written before `phase_index` existed, or one hand-edited during
 * debugging, which spec §3's "no reliable devtools" makes more likely than it
 * would normally be.
 */
export function fromCursor(timeline: Phase[], cursor: Partial<PersistedCursor>): number {
  const index = cursor.phase_index;
  if (typeof index === 'number' && index >= 0 && index < timeline.length) {
    const candidate = timeline[index];
    const blockMatches =
      typeof cursor.block_index !== 'number' || candidate.blockIndex === cursor.block_index;
    const itemMatches =
      typeof cursor.item_index !== 'number' || candidate.itemIndex === cursor.item_index;
    if (blockMatches && itemMatches) return index;
  }

  for (let i = 0; i < timeline.length; i += 1) {
    const candidate = timeline[i];
    if (candidate.blockIndex !== cursor.block_index) continue;
    if (candidate.itemIndex !== cursor.item_index) continue;
    const side = candidate.side === 'both' ? null : candidate.side;
    if (cursor.side !== undefined && side !== cursor.side) continue;
    return i;
  }

  return 0;
}

/** Where this item's rest phase is — `skip` from work jumps here. */
export function restIndexForItem(timeline: Phase[], from: number): number | null {
  if (from < 0 || from >= timeline.length) return null;
  const current = timeline[from];

  for (let i = from; i < timeline.length; i += 1) {
    const candidate = timeline[i];
    if (candidate.blockIndex !== current.blockIndex) break;
    if (candidate.itemIndex !== current.itemIndex) break;
    if (candidate.kind === 'rest') return i;
  }
  return null;
}

/** The next phase belonging to a different item — `skip` from rest lands here. */
export function nextItemIndex(timeline: Phase[], from: number): number | null {
  if (from < 0 || from >= timeline.length) return null;
  const current = timeline[from];

  for (let i = from + 1; i < timeline.length; i += 1) {
    const candidate = timeline[i];
    if (candidate.blockIndex !== current.blockIndex || candidate.itemIndex !== current.itemIndex) {
      return i;
    }
  }
  return null;
}
