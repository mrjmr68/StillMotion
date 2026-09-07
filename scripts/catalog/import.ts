/**
 * catalog:import — write approved entries into exercise_catalog.
 *
 * Dry run by default. `--commit` is required to write anything, and
 * `--allow-update` is separately required to change a row that already exists,
 * because `exercise_logs` and `user_movement_preferences` FK into this table and
 * silently rewriting a referenced row is the worst thing this harness could do.
 *
 * Only entries that are BOTH status "approved" AND still match the content hash
 * bound at approval time are eligible. Editing an approved entry un-approves it.
 *
 *   npm run catalog:import                    # dry run, everything approved
 *   npm run catalog:import -- --commit
 *   npm run catalog:import -- --category hinge --commit
 */

import { parseArgs } from 'node:util';
import { normalizeName } from '../../src/lib/catalog/ids';
import type { CatalogRow } from '../../src/lib/catalog/schema';
import { CATEGORIES, findCategory } from './categories';
import { checkApproval } from './lib/approval';
import { serviceClient } from './lib/db';
import { refreshEntry, toCatalogRow } from './lib/derive';
import { bold, dim, green, red, yellow } from './lib/render';
import {
  loadReviewFile,
  saveReviewFile,
  type ReviewEntry,
  type ReviewFile,
} from './lib/reviewFile';

type Candidate = {
  file: ReviewFile;
  entry: ReviewEntry;
  row: CatalogRow;
};

function parse() {
  const { values } = parseArgs({
    options: {
      category: { type: 'string', multiple: true, default: [] },
      commit: { type: 'boolean', default: false },
      'allow-update': { type: 'boolean', default: false },
    },
  });

  const categoryIds =
    values.category.length > 0
      ? values.category.map((id) => {
          if (!findCategory(id)) throw new Error(`Unknown category "${id}"`);
          return id;
        })
      : CATEGORIES.map((c) => c.id);

  return { categoryIds, commit: values.commit, allowUpdate: values['allow-update'] };
}

function loadRefreshed(categoryId: string): ReviewFile | null {
  const file = loadReviewFile(categoryId);
  if (!file) return null;

  const taken = new Set<string>();
  const entries = file.entries.map((entry) => {
    const refreshed = refreshEntry(entry, taken);
    taken.add(refreshed.derived.id);
    return refreshed;
  });

  return { ...file, entries };
}

/**
 * Map every name and alias to the id that claims it, so relation hints (which
 * are movement NAMES) can resolve to real ids.
 *
 * Only ids that will actually exist in the DB after this run belong here —
 * anything else would resolve to a foreign key that fails.
 */
function buildNameIndex(candidates: Candidate[], existingIds: Map<string, string[]>): Map<string, string> {
  const index = new Map<string, string>();

  const claim = (name: string, id: string) => {
    const key = normalizeName(name);
    if (key && !index.has(key)) index.set(key, id);
  };

  for (const { entry } of candidates) {
    claim(entry.draft.name, entry.derived.id);
    for (const alias of entry.draft.aka) claim(alias, entry.derived.id);
  }
  for (const [id, names] of existingIds) {
    for (const name of names) claim(name, id);
  }

  return index;
}

type Resolution = { row: CatalogRow; dropped: string[] };

function resolveRelations(row: CatalogRow, entry: ReviewEntry, index: Map<string, string>): Resolution {
  const dropped: string[] = [];

  const lookup = (hint: string | null): string | null => {
    if (!hint) return null;
    const id = index.get(normalizeName(hint)) ?? null;
    if (!id) dropped.push(hint);
    // A movement can't be its own progression; the DB has a CHECK for it.
    return id === row.id ? null : id;
  };

  const lookupMany = (hints: string[]): string[] => {
    const ids: string[] = [];
    for (const hint of hints) {
      const id = lookup(hint);
      if (id && !ids.includes(id)) ids.push(id);
    }
    return ids;
  };

  return {
    row: {
      ...row,
      progression_id: lookup(entry.draft.progression_hint),
      regression_id: lookup(entry.draft.regression_hint),
      pairs_well_with: lookupMany(entry.draft.pairs_well_with_hints),
      avoid_after: lookupMany(entry.draft.avoid_after_hints),
    },
    dropped,
  };
}

/** Compare only the columns we write, so DB-managed timestamps don't read as drift. */
function contentDiffers(a: CatalogRow, b: Record<string, unknown>): boolean {
  for (const [key, value] of Object.entries(a)) {
    const other = b[key];
    const left = Array.isArray(value) ? JSON.stringify(value) : value;
    const right = Array.isArray(other) ? JSON.stringify(other) : other;
    if (left !== right) return true;
  }
  return false;
}

async function main() {
  const { categoryIds, commit, allowUpdate } = parse();

  const files = categoryIds.map(loadRefreshed).filter((f): f is ReviewFile => f !== null);
  if (files.length === 0) {
    console.log('No review files. Run `npm run catalog:generate -- --all` first.');
    return;
  }

  // ---- eligibility -------------------------------------------------------
  const candidates: Candidate[] = [];
  const skipped: { name: string; reason: string }[] = [];

  for (const file of files) {
    for (const entry of file.entries) {
      const check = checkApproval(entry);
      if (!check.ok) {
        // Only mention entries someone tried to approve; pending ones are just noise.
        if (check.reason !== 'not-approved' || entry.status === 'needs-review') {
          skipped.push({ name: entry.draft.name, reason: check.detail });
        }
        continue;
      }
      candidates.push({ file, entry, row: toCatalogRow(entry.draft, entry.derived) });
    }
  }

  if (candidates.length === 0) {
    console.log('Nothing approved to import.');
    console.log(dim('Run `npm run catalog:review -- --triage` to approve entries.'));
    if (skipped.length > 0) {
      console.log(`\n${yellow(`${skipped.length} skipped:`)}`);
      for (const s of skipped) console.log(`  ${s.name} — ${s.reason}`);
    }
    return;
  }

  // ---- validation: all or nothing ---------------------------------------
  const invalid = candidates.filter(({ entry }) => entry.errors.length > 0);
  if (invalid.length > 0) {
    console.error(red(`${invalid.length} approved entr${invalid.length === 1 ? 'y has' : 'ies have'} errors. Nothing was written.`));
    for (const { entry } of invalid) {
      console.error(`\n  ${bold(entry.draft.name)}`);
      for (const error of entry.errors) console.error(`    ${error.code}: ${error.message}`);
    }
    process.exit(1);
  }

  // ---- what already exists ----------------------------------------------
  const supabase = serviceClient();
  const { data: existing, error: readError } = await supabase.from('exercise_catalog').select('*');
  if (readError) throw new Error(`Could not read exercise_catalog: ${readError.message}`);

  const existingById = new Map((existing ?? []).map((row) => [row.id as string, row]));
  const existingNames = new Map(
    (existing ?? []).map((row) => [row.id as string, [row.name as string, ...(row.aka as string[])]]),
  );

  // ---- resolve relations -------------------------------------------------
  const index = buildNameIndex(candidates, existingNames);
  const resolved = candidates.map((candidate) => {
    const { row, dropped } = resolveRelations(candidate.row, candidate.entry, index);
    return { ...candidate, row, dropped };
  });

  // ---- classify ----------------------------------------------------------
  const inserts = resolved.filter((c) => !existingById.has(c.row.id));
  const updates = resolved.filter(
    (c) => existingById.has(c.row.id) && contentDiffers(c.row, existingById.get(c.row.id)!),
  );
  const unchanged = resolved.length - inserts.length - updates.length;

  console.log(bold(`\n${resolved.length} approved · ${inserts.length} insert · ${updates.length} update · ${unchanged} unchanged`));

  for (const c of inserts) console.log(`  ${green('+')} ${c.row.id.padEnd(44)} ${dim(c.row.name)}`);
  for (const c of updates) console.log(`  ${yellow('~')} ${c.row.id.padEnd(44)} ${dim(c.row.name)}`);

  const linked = resolved.filter((c) => c.row.progression_id || c.row.regression_id);
  console.log(dim(`\n  ${linked.length} with progression/regression links`));

  const allDropped = resolved.flatMap((c) => c.dropped.map((d) => ({ name: c.row.name, hint: d })));
  if (allDropped.length > 0) {
    console.log(yellow(`\n  ${allDropped.length} hint${allDropped.length === 1 ? '' : 's'} could not resolve and will be dropped:`));
    for (const d of allDropped) console.log(dim(`    ${d.name} → ${d.hint}`));
    console.log(dim('    (expected while categories are still being drafted — re-run import later to link them)'));
  }

  if (skipped.length > 0) {
    console.log(yellow(`\n  ${skipped.length} skipped:`));
    for (const s of skipped) console.log(dim(`    ${s.name} — ${s.reason}`));
  }

  if (updates.length > 0 && !allowUpdate) {
    console.error(
      red(`\n${updates.length} row(s) already exist with different content.`) +
        '\nOther tables reference these ids, so overwriting needs --allow-update.',
    );
    process.exit(1);
  }

  if (!commit) {
    console.log(dim('\nDry run — nothing written. Add --commit to apply.'));
    return;
  }

  // ---- pass 1: rows without relations ------------------------------------
  // Postgres checks FKs per row, so a single insert where A references B fails
  // if A is checked first. Write the rows first, link them second. Both passes
  // are idempotent, so a failure between them is fixed by re-running.
  const toWrite = [...inserts, ...updates];
  if (toWrite.length > 0) {
    const { error } = await supabase
      .from('exercise_catalog')
      .upsert(toWrite.map((c) => ({ ...c.row, progression_id: null, regression_id: null })));
    if (error) throw new Error(`Insert failed: ${error.message}`);
    console.log(green(`\n  pass 1: ${toWrite.length} rows written`));
  }

  // ---- pass 2: relations -------------------------------------------------
  let linkedCount = 0;
  for (const c of resolved) {
    if (!c.row.progression_id && !c.row.regression_id) continue;
    const { error } = await supabase
      .from('exercise_catalog')
      .update({ progression_id: c.row.progression_id, regression_id: c.row.regression_id })
      .eq('id', c.row.id);
    if (error) throw new Error(`Linking ${c.row.id} failed: ${error.message}`);
    linkedCount += 1;
  }
  console.log(green(`  pass 2: ${linkedCount} rows linked`));

  // ---- stamp the review files -------------------------------------------
  const now = new Date().toISOString();
  const touched = new Set<ReviewFile>();
  for (const c of resolved) {
    c.entry.importedAt = now;
    touched.add(c.file);
  }
  for (const file of touched) saveReviewFile(file);

  console.log(green(`\nDone. ${resolved.length} entries in the catalog.`));
}

main().catch((error: unknown) => {
  console.error(`\n${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
