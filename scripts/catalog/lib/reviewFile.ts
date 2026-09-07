/**
 * The review file — a per-category JSON document that is the curation record.
 *
 * These are COMMITTED to git on purpose: they are the provenance of what was
 * approved, they make a re-import reproducible, and they are the only place the
 * reviewer's edits survive. Catalog content does not belong in a migration
 * (migrations are append-only; curated content churns).
 */

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Finding } from '../../../src/lib/catalog/schema';
import type { DraftEntry } from '../../../src/lib/catalog/schema';
import type { DerivedFields } from './derive';

const HERE = fileURLToPath(new URL('.', import.meta.url));
export const REVIEW_DIR = join(HERE, '..', 'review');

export type ReviewStatus = 'pending' | 'approved' | 'rejected' | 'duplicate' | 'needs-review';

export type ReviewEntry = {
  status: ReviewStatus;
  /** The editable fields. Everything else is recomputed from these. */
  draft: DraftEntry;
  derived: DerivedFields;
  /** Set this to pin an id by hand; ids are permanent once imported. */
  idOverride: string | null;
  errors: Finding[];
  warnings: Finding[];
  /** Ids of entries competing for the same movement slot — context for review. */
  slotPeers: string[];
  /** Set when this entry duplicates another by name or alias. */
  dupOf: string | null;
  reviewerNote: string;
  /** Bound at approval time over the exact payload; see increment 2. */
  approvedHash: string | null;
  approvedAt: string | null;
  importedAt: string | null;
};

export type ReviewFile = {
  category: string;
  generatedAt: string;
  model: string;
  promptVersion: number;
  entries: ReviewEntry[];
};

export function reviewPath(categoryId: string): string {
  return join(REVIEW_DIR, `${categoryId}.review.json`);
}

export function loadReviewFile(categoryId: string): ReviewFile | null {
  try {
    return JSON.parse(readFileSync(reviewPath(categoryId), 'utf8')) as ReviewFile;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

export function loadAllReviewFiles(): ReviewFile[] {
  let names: string[];
  try {
    names = readdirSync(REVIEW_DIR).filter((n) => n.endsWith('.review.json'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }

  return names.map(
    (name) => JSON.parse(readFileSync(join(REVIEW_DIR, name), 'utf8')) as ReviewFile,
  );
}

export function saveReviewFile(file: ReviewFile): void {
  mkdirSync(REVIEW_DIR, { recursive: true });
  writeFileSync(reviewPath(file.category), `${JSON.stringify(file, null, 2)}\n`, 'utf8');
}

/**
 * Fold newly generated entries into whatever is already on disk.
 *
 * Entries the reviewer has already touched (anything not `pending`) are never
 * overwritten — a re-run appends new drafts alongside them rather than
 * discarding a morning of curation. Incoming entries that collide by id with a
 * still-`pending` entry replace it, since a pending entry carries no human work.
 */
export function mergeEntries(
  existing: ReviewEntry[],
  incoming: ReviewEntry[],
): { entries: ReviewEntry[]; added: number; replaced: number; protectedCount: number } {
  const result = [...existing];
  const indexById = new Map(existing.map((entry, index) => [entry.derived.id, index]));

  let added = 0;
  let replaced = 0;
  let protectedCount = 0;

  for (const entry of incoming) {
    const at = indexById.get(entry.derived.id);

    if (at === undefined) {
      result.push(entry);
      indexById.set(entry.derived.id, result.length - 1);
      added += 1;
      continue;
    }

    if (result[at].status === 'pending') {
      result[at] = entry;
      replaced += 1;
    } else {
      protectedCount += 1;
    }
  }

  return { entries: result, added, replaced, protectedCount };
}
