/**
 * Binding an approval to the exact content that was approved.
 *
 * `status: "approved"` alone is only a convention — it survives any later edit
 * to the entry, so what reaches Postgres could differ from what a human actually
 * read. Hashing the payload at approval time and re-checking it at import turns
 * that into a property: the exact bytes that reach the database are the exact
 * bytes that were looked at. Editing an approved entry silently un-approves it.
 */

import { createHash } from 'node:crypto';
import type { DerivedFields } from './derive';
import type { DraftEntry } from '../../../src/lib/catalog/schema';
import type { ReviewEntry } from './reviewFile';

/**
 * Stable stringify: object keys sorted at every level, so a hash depends on
 * content rather than on key insertion order (which JSON round-trips and
 * editors both love to change).
 */
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
}

/**
 * Hash over draft + derived — everything that determines the row, before
 * relation ids are resolved. Relations are deliberately excluded: they depend on
 * which *other* entries exist, so including them would invalidate an approval
 * whenever an unrelated batch was drafted.
 */
export function approvalHash(payload: { draft: DraftEntry; derived: DerivedFields }): string {
  return createHash('sha256')
    .update(canonical({ draft: payload.draft, derived: payload.derived }))
    .digest('hex');
}

export type ApprovalCheck =
  | { ok: true }
  | { ok: false; reason: 'not-approved' | 'no-hash' | 'stale'; detail: string };

export function checkApproval(entry: ReviewEntry): ApprovalCheck {
  if (entry.status !== 'approved') {
    return { ok: false, reason: 'not-approved', detail: `status is "${entry.status}"` };
  }
  if (!entry.approvedHash) {
    return {
      ok: false,
      reason: 'no-hash',
      detail: 'approved but carries no hash — re-approve it via `catalog:review`',
    };
  }

  const current = approvalHash({ draft: entry.draft, derived: entry.derived });
  if (current !== entry.approvedHash) {
    return {
      ok: false,
      reason: 'stale',
      detail: 'edited after approval — re-approve it via `catalog:review`',
    };
  }

  return { ok: true };
}
