/**
 * Dedupe "by name and pattern" (spec §5), read as two distinct checks:
 * name is the IDENTITY check, pattern is the REDUNDANCY detector.
 *
 * Both run against the union of the current batch, every other review file
 * (whatever its status), and the live catalog — dedupe that only looks within
 * one batch is worthless when you are generating thirteen of them.
 *
 * No fuzzy/edit-distance matching: at n≈80, alias-set intersection plus slot
 * keys catches the real collisions, and Levenshtein just adds false positives.
 */

import { nameIdentitySet, nameSetsCollide, slotKey } from '../../../src/lib/catalog/ids';
import type { BodyPosition, Equipment, MovementPattern } from '../../../src/lib/catalog/vocab';

export type KnownEntry = {
  id: string;
  name: string;
  aka: string[];
  modality: string;
  movement_pattern: MovementPattern;
  body_position: BodyPosition;
  equipment: Equipment[];
  unilateral: boolean;
  intensity: number;
  /** Where this came from, for a legible collision message. */
  source: string;
};

export type DedupeResult = {
  /** Id of an entry claiming one of the same names. Hard collision. */
  dupOf: string | null;
  /** Ids competing for the same movement slot. Context, not a verdict. */
  slotPeers: string[];
  /** True when a slot peer is close enough that the planner would feel them as the same. */
  redundant: boolean;
};

export function checkEntry(candidate: KnownEntry, known: readonly KnownEntry[]): DedupeResult {
  const candidateNames = nameIdentitySet(candidate.name, candidate.aka);
  const candidateSlot = slotKey(candidate);

  let dupOf: string | null = null;
  const slotPeers: string[] = [];
  let redundant = false;

  for (const other of known) {
    if (other.id === candidate.id) continue;

    // Identity: compare the full {name} ∪ {aka} sets, not name-vs-name. The real
    // trap is aliased — "Bird Dog" in one batch vs. "Quadruped Contralateral
    // Reach" with aka ["Bird Dog"] in another. Name-only comparison misses it.
    if (dupOf === null && nameSetsCollide(candidateNames, nameIdentitySet(other.name, other.aka))) {
      dupOf = other.id;
    }

    if (slotKey(other) === candidateSlot) {
      slotPeers.push(other.id);
      // A shared slot alone is fine — hinge/standing/kettlebell/bilateral holds
      // both a deadlift and a swing. It is only redundancy when the modality
      // matches too and the intensities are within one of each other.
      if (other.modality === candidate.modality && Math.abs(other.intensity - candidate.intensity) <= 1) {
        redundant = true;
      }
    }
  }

  return { dupOf, slotPeers, redundant };
}

/** One line per known movement, for priming the generator against re-drafting them. */
export function digestLines(known: readonly KnownEntry[]): string[] {
  return known.map((entry) => {
    const aka = entry.aka.length > 0 ? ` (aka ${entry.aka.join(', ')})` : '';
    const equipment = entry.equipment.length > 0 ? entry.equipment.join('+') : 'bodyweight';
    return `${entry.name}${aka} — ${entry.movement_pattern}/${entry.body_position}/${equipment}`;
  });
}
