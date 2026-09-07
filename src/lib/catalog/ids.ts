/**
 * Pure helpers for catalog identity: id derivation, name normalization, and the
 * "slot key" used to detect near-duplicate movements. No I/O.
 */

import type { BodyPosition, Equipment, MovementPattern } from './vocab';

/** Longest id we'll derive before truncating. Ids are `text`, so this is style, not a limit. */
const MAX_ID_LENGTH = 48;

/**
 * Strip a string to its comparable essence: NFKD-decompose, drop diacritics,
 * lowercase, collapse every run of non-alphanumerics to a single space, trim.
 *
 * Used for *identity* comparison during dedupe — "Cossack Squat",
 * "cossack  squat", and "Cossack-Squat" all normalize to "cossack squat".
 */
export function normalizeName(value: string): string {
  return (
    value
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      // Possessives collapse to the bare noun, so "Farmer's Carry" and "Farmer
      // Carry" are the same movement. Without this the apostrophe becomes a
      // separator and leaves a stray "s" token ("farmer s carry"), which both
      // drops valid relation hints and hides real duplicates. Observed on the
      // first real catalog with Farmer's Carry and Child's Pose.
      .replace(/['\u2019]s\b/g, '')
      // Any other apostrophe is removed rather than turned into a space, so
      // contractions don't split into fragments.
      .replace(/['\u2019]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
  );
}

/** Like `normalizeName`, but underscore-joined for use inside an id. */
export function slugify(value: string): string {
  return normalizeName(value).replace(/ /g, '_');
}

/**
 * Derive a stable id from the movement pattern and name.
 *
 * Ids are permanent once imported: `exercise_logs` and `user_movement_preferences`
 * both FK into `exercise_catalog(id)`, so a drifting id is data loss. Derivation
 * is deterministic so re-running generation on an unchanged draft is a no-op.
 *
 * @param taken ids already claimed, to disambiguate against (`_2`, `_3`, ...)
 */
export function deriveId(
  pattern: MovementPattern,
  name: string,
  taken: ReadonlySet<string> = new Set(),
): string {
  const base = `${pattern}_${slugify(name)}`.slice(0, MAX_ID_LENGTH).replace(/_+$/, '');

  if (!taken.has(base)) return base;

  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${base.slice(0, MAX_ID_LENGTH - String(suffix).length - 1)}_${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/**
 * Every name this entry answers to, normalized — its primary name plus aliases.
 *
 * Dedupe compares these as *sets* rather than comparing names directly, because
 * the real collision case is aliased: "Bird Dog" drafted in one batch and
 * "Quadruped Contralateral Reach" with aka `["Bird Dog"]` in another. Comparing
 * only primary names misses that entirely.
 */
export function nameIdentitySet(name: string, aka: readonly string[] = []): Set<string> {
  return new Set([name, ...aka].map(normalizeName).filter(Boolean));
}

/** True when two entries claim any name in common. */
export function nameSetsCollide(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  for (const value of a) {
    if (b.has(value)) return true;
  }
  return false;
}

/**
 * The "shape" of a movement, for near-duplicate detection.
 *
 * A slot collision is NOT a duplicate — hinge/standing/kettlebell/bilateral
 * legitimately holds both a deadlift and a swing. It just means two entries
 * compete for the same role, which is worth a human glance during review.
 */
export function slotKey(entry: {
  movement_pattern: MovementPattern;
  body_position: BodyPosition;
  equipment: readonly Equipment[];
  unilateral: boolean;
}): string {
  const equipment = [...entry.equipment].sort().join('+') || 'none';
  return [
    entry.movement_pattern,
    entry.body_position,
    equipment,
    entry.unilateral ? 'unilateral' : 'bilateral',
  ].join('|');
}
