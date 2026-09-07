/**
 * catalog:generate — draft a batch of catalog entries for review.
 *
 * Generation NEVER writes to Postgres. It writes drafts to a review file, every
 * entry born `status: "pending"`. Import is a separate command that only ever
 * reads entries a human has explicitly approved.
 *
 *   npm run catalog:generate -- --category hinge --dry-run
 *   npm run catalog:generate -- --category hinge
 *   npm run catalog:generate -- --all --effort medium
 */

import { parseArgs } from 'node:util';
import { rowErrors, rowWarnings } from '../../src/lib/catalog/schema';
import { CATEGORIES, findCategory, type Category } from './categories';
import { generateBatch, type Effort } from './lib/anthropic';
import { fetchCatalogDigest } from './lib/db';
import { checkEntry, digestLines, type KnownEntry } from './lib/dedupe';
import { deriveFields, toCatalogRow } from './lib/derive';
import { buildSystemPrompt, buildUserPrompt, PROMPT_VERSION } from './lib/prompt';
import {
  loadAllReviewFiles,
  loadReviewFile,
  mergeEntries,
  reviewPath,
  saveReviewFile,
  type ReviewEntry,
} from './lib/reviewFile';

const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;

function parse() {
  const { values } = parseArgs({
    options: {
      category: { type: 'string', multiple: true, default: [] },
      all: { type: 'boolean', default: false },
      count: { type: 'string' },
      effort: { type: 'string', default: 'high' },
      'dry-run': { type: 'boolean', default: false },
    },
  });

  if (!EFFORTS.includes(values.effort as Effort)) {
    throw new Error(`--effort must be one of: ${EFFORTS.join(', ')}`);
  }

  let categories: Category[];
  if (values.all) {
    categories = CATEGORIES;
  } else if (values.category.length > 0) {
    categories = values.category.map((id) => {
      const found = findCategory(id);
      if (!found) {
        throw new Error(
          `Unknown category "${id}".\n  Available: ${CATEGORIES.map((c) => c.id).join(', ')}`,
        );
      }
      return found;
    });
  } else {
    throw new Error(
      `Pass --category <name> (repeatable) or --all.\n  Available: ${CATEGORIES.map((c) => c.id).join(', ')}`,
    );
  }

  return {
    categories,
    count: values.count ? Number(values.count) : null,
    effort: values.effort as Effort,
    dryRun: values['dry-run'],
  };
}

/** Everything already drafted or imported, from both the DB and the review files. */
async function loadKnown(dryRun: boolean): Promise<KnownEntry[]> {
  const known: KnownEntry[] = [];

  try {
    for (const row of await fetchCatalogDigest()) {
      known.push({ ...row, source: 'catalog', ...castVocab(row) });
    }
  } catch (error) {
    // A partial digest during real generation would silently cause duplicates,
    // so only a dry run is allowed to continue without the catalog.
    if (!dryRun) throw error;
    console.warn(`  ! could not read the catalog: ${(error as Error).message}`);
    console.warn('    (continuing — dry run, so the digest is review files only)\n');
  }

  for (const file of loadAllReviewFiles()) {
    for (const entry of file.entries) {
      if (entry.status === 'rejected' || entry.status === 'duplicate') continue;
      known.push({
        id: entry.derived.id,
        name: entry.draft.name,
        aka: entry.draft.aka,
        modality: entry.draft.modality,
        movement_pattern: entry.draft.movement_pattern,
        body_position: entry.draft.body_position,
        equipment: entry.draft.equipment,
        unilateral: entry.draft.unilateral,
        intensity: entry.draft.intensity,
        source: `review:${file.category}`,
      });
    }
  }

  return known;
}

/** The digest columns come back as bare `string` from generated types; narrow them. */
function castVocab(row: {
  movement_pattern: string;
  body_position: string;
  equipment: string[];
}): Pick<KnownEntry, 'movement_pattern' | 'body_position' | 'equipment'> {
  return {
    movement_pattern: row.movement_pattern as KnownEntry['movement_pattern'],
    body_position: row.body_position as KnownEntry['body_position'],
    equipment: row.equipment as KnownEntry['equipment'],
  };
}

async function runCategory(
  category: Category,
  options: { count: number; effort: Effort; dryRun: boolean },
): Promise<void> {
  const { count, effort, dryRun } = options;

  console.log(`\n── ${category.label} (${category.id}) — target ${count}`);

  const known = await loadKnown(dryRun);
  const digest = digestLines(known);
  console.log(`  ${known.length} movements already known`);

  if (dryRun) {
    const system = buildSystemPrompt();
    const user = buildUserPrompt({ category, count, digest });
    console.log('\n───────── SYSTEM (cached prefix) ─────────');
    console.log(system);
    console.log('\n───────── USER (volatile) ─────────');
    console.log(user);
    const approxTokens = Math.ceil((system.length + user.length) / 4);
    console.log(`\n  ~${approxTokens} input tokens (rough char/4 estimate)`);
    console.log('  dry run — no API call made, nothing written');
    return;
  }

  const { entries, usage } = await generateBatch({ category, count, digest, effort });
  console.log(
    `  ${entries.length} drafted · ${usage.input} in / ${usage.output} out · ` +
      `cache ${usage.cacheRead} read, ${usage.cacheWrite} written`,
  );
  if (usage.cacheRead === 0 && usage.cacheWrite === 0) {
    console.log('  ! prompt caching did not engage — the system prefix may be under the minimum');
  }

  const taken = new Set(known.map((entry) => entry.id));
  const reviewEntries: ReviewEntry[] = [];

  for (const draft of entries) {
    const derived = deriveFields(draft, { taken });
    taken.add(derived.id);

    const row = toCatalogRow(draft, derived);
    const errors = rowErrors(row);
    const warnings = rowWarnings(row);

    const candidate: KnownEntry = {
      id: derived.id,
      name: draft.name,
      aka: draft.aka,
      modality: draft.modality,
      movement_pattern: draft.movement_pattern,
      body_position: draft.body_position,
      equipment: draft.equipment,
      unilateral: draft.unilateral,
      intensity: draft.intensity,
      source: 'incoming',
    };
    const { dupOf, slotPeers, redundant } = checkEntry(candidate, [...known, ...toKnown(reviewEntries)]);

    reviewEntries.push({
      status: dupOf ? 'duplicate' : redundant ? 'needs-review' : 'pending',
      draft,
      derived,
      idOverride: null,
      errors,
      warnings,
      slotPeers,
      dupOf,
      reviewerNote: '',
      approvedHash: null,
      approvedAt: null,
      importedAt: null,
    });
  }

  const existing = loadReviewFile(category.id);
  const merged = mergeEntries(existing?.entries ?? [], reviewEntries);

  saveReviewFile({
    category: category.id,
    generatedAt: new Date().toISOString(),
    model: process.env.ANTHROPIC_MODEL || 'claude-opus-5',
    promptVersion: PROMPT_VERSION,
    entries: merged.entries,
  });

  const errorCount = reviewEntries.filter((e) => e.errors.length > 0).length;
  const warnCount = reviewEntries.filter((e) => e.warnings.length > 0).length;
  const dupCount = reviewEntries.filter((e) => e.dupOf).length;

  console.log(
    `  ${merged.added} added, ${merged.replaced} replaced, ${merged.protectedCount} left alone (already reviewed)`,
  );
  console.log(`  ${errorCount} with errors · ${warnCount} with warnings · ${dupCount} duplicates`);
  console.log(`  → ${reviewPath(category.id)}`);
}

function toKnown(entries: readonly ReviewEntry[]): KnownEntry[] {
  return entries.map((entry) => ({
    id: entry.derived.id,
    name: entry.draft.name,
    aka: entry.draft.aka,
    modality: entry.draft.modality,
    movement_pattern: entry.draft.movement_pattern,
    body_position: entry.draft.body_position,
    equipment: entry.draft.equipment,
    unilateral: entry.draft.unilateral,
    intensity: entry.draft.intensity,
    source: 'incoming',
  }));
}

async function main() {
  const { categories, count, effort, dryRun } = parse();

  for (const category of categories) {
    await runCategory(category, {
      count: count ?? category.targetCount,
      effort,
      dryRun,
    });
  }

  if (!dryRun) {
    console.log('\nAll drafts are status "pending" — nothing reaches the catalog until reviewed.');
  }
}

main().catch((error: unknown) => {
  console.error(`\n${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
