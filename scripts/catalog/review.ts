/**
 * catalog:review — look at drafted entries and decide what's allowed into the catalog.
 *
 * This is the ONLY command that can set an entry's status to "approved" (spec
 * §5: "nothing enters the catalog without your eyes on it"). Normally that
 * happens one explicit keystroke at a time in `--triage`.
 *
 * `--approve-all` waives it in bulk. That is an owner escape hatch rather than a
 * convenience — the rule belongs to whoever owns the catalog, so they can also
 * suspend it — and it stamps every entry it touches with a note saying it was
 * not individually reviewed, so the review file never misrepresents what
 * actually happened.
 *
 *   npm run catalog:review                       # status table, everything
 *   npm run catalog:review -- --category hinge   # one category
 *   npm run catalog:review -- --triage           # interactive, pending only
 *   npm run catalog:review -- --approve-all      # waive individual review
 */

import { createInterface } from 'node:readline';
import { parseArgs } from 'node:util';
import { CATEGORIES, findCategory } from './categories';
import { approvalHash } from './lib/approval';
import { refreshEntry } from './lib/derive';
import { bold, dim, green, red, renderEntry, renderRow, yellow } from './lib/render';
import {
  loadReviewFile,
  saveReviewFile,
  type ReviewEntry,
  type ReviewFile,
  type ReviewStatus,
} from './lib/reviewFile';

const STATUSES = ['pending', 'approved', 'rejected', 'duplicate', 'needs-review', 'all'] as const;

function parse() {
  const { values } = parseArgs({
    options: {
      category: { type: 'string', multiple: true, default: [] },
      status: { type: 'string', default: 'all' },
      triage: { type: 'boolean', default: false },
      'approve-all': { type: 'boolean', default: false },
    },
  });

  if (!STATUSES.includes(values.status as (typeof STATUSES)[number])) {
    throw new Error(`--status must be one of: ${STATUSES.join(', ')}`);
  }

  const categoryIds =
    values.category.length > 0
      ? values.category.map((id) => {
          if (!findCategory(id)) throw new Error(`Unknown category "${id}"`);
          return id;
        })
      : CATEGORIES.map((c) => c.id);

  return {
    categoryIds,
    // Triage defaults to the things actually awaiting a decision.
    status: (values.triage && values.status === 'all' ? 'pending' : values.status) as
      | ReviewStatus
      | 'all',
    triage: values.triage,
    approveAll: values['approve-all'],
  };
}

/**
 * Approve everything outstanding in one go.
 *
 * This deliberately exists as an owner escape hatch, not a convenience: the
 * spec's rule is that nothing enters the catalog unreviewed, so waiving it is a
 * decision the catalog owner makes explicitly. What it must never do is lie
 * about what happened — every entry it touches is stamped with a reviewer note
 * saying it was not individually reviewed, so the provenance in the review file
 * stays true.
 *
 * Entries with validation errors are still refused, and entries already flagged
 * as duplicates are left alone — those are the two cases where a blanket yes is
 * most likely to be a mistake.
 */
function approveAll(files: ReviewFile[]): void {
  const NOTE = 'bulk approved without individual review';
  const now = new Date().toISOString();

  let approved = 0;
  const refusedForErrors: string[] = [];
  const leftAsDuplicate: string[] = [];
  const touched = new Set<ReviewFile>();

  for (const file of files) {
    for (const entry of file.entries) {
      if (entry.status === 'approved' || entry.status === 'rejected') continue;

      if (entry.status === 'duplicate') {
        leftAsDuplicate.push(entry.draft.name);
        continue;
      }
      if (entry.errors.length > 0) {
        refusedForErrors.push(entry.draft.name);
        continue;
      }

      entry.status = 'approved';
      entry.approvedAt = now;
      entry.approvedHash = approvalHash({ draft: entry.draft, derived: entry.derived });
      entry.reviewerNote = entry.reviewerNote ? `${entry.reviewerNote}; ${NOTE}` : NOTE;
      approved += 1;
      touched.add(file);
    }
  }

  for (const file of touched) saveReviewFile(file);

  console.log(green(`${approved} approved`) + dim(` — each stamped "${NOTE}"`));
  if (leftAsDuplicate.length > 0) {
    console.log(yellow(`\n${leftAsDuplicate.length} left as duplicate (decide on these individually):`));
    for (const name of leftAsDuplicate) console.log(`  ${name}`);
  }
  if (refusedForErrors.length > 0) {
    console.log(red(`\n${refusedForErrors.length} refused for validation errors:`));
    for (const name of refusedForErrors) console.log(`  ${name}`);
  }
  console.log(dim('\nNext: `npm run catalog:import` (dry run — add --commit to write).'));
}

/** Load a category's file with derived/errors/warnings recomputed from the drafts. */
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

function summarize(files: ReviewFile[], status: ReviewStatus | 'all'): void {
  const totals: Record<string, number> = {};
  let shown = 0;

  for (const file of files) {
    const matching = file.entries.filter((e) => status === 'all' || e.status === status);
    for (const entry of file.entries) totals[entry.status] = (totals[entry.status] ?? 0) + 1;
    if (matching.length === 0) continue;

    console.log(`\n${bold(file.category)} ${dim(`(${matching.length}/${file.entries.length})`)}`);
    for (const entry of matching) console.log(renderRow(entry));
    shown += matching.length;
  }

  const parts = Object.entries(totals)
    .sort()
    .map(([k, v]) => `${k} ${v}`);
  console.log(`\n${shown} shown · ${parts.join(' · ') || 'nothing drafted yet'}`);

  const approved = totals.approved ?? 0;
  if (approved > 0) {
    console.log(dim(`\nRun \`npm run catalog:import\` to see what ${approved} approved would write.`));
  }
  if ((totals.pending ?? 0) > 0) {
    console.log(dim('Run `npm run catalog:review -- --triage` to work through the pending ones.'));
  }
}

/** Read one keypress. Falls back to line input where raw mode isn't available. */
async function readKey(prompt: string): Promise<string> {
  process.stdout.write(prompt);

  if (process.stdin.isTTY && typeof process.stdin.setRawMode === 'function') {
    return new Promise((resolve) => {
      process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.once('data', (buffer) => {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        const key = buffer.toString('utf8');
        // Ctrl-C reads as a normal byte in raw mode; honour it anyway.
        if (key === '\u0003') {
          process.stdout.write('\n');
          process.exit(130);
        }
        process.stdout.write(`${key}\n`);
        resolve(key.toLowerCase());
      });
    });
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise<string>((resolve) => rl.question('', resolve));
  rl.close();
  return answer.trim().toLowerCase().charAt(0);
}

async function triage(files: ReviewFile[], status: ReviewStatus | 'all'): Promise<void> {
  const queue: { file: ReviewFile; entry: ReviewEntry }[] = [];
  for (const file of files) {
    for (const entry of file.entries) {
      if (status === 'all' || entry.status === status) queue.push({ file, entry });
    }
  }

  if (queue.length === 0) {
    console.log(`Nothing with status "${status}". ${dim('Try --status all.')}`);
    return;
  }

  console.log(
    `${bold(`${queue.length} to review`)}\n` +
      dim('  a approve · r reject · n needs-review · s skip · q save and quit\n'),
  );

  const touched = new Set<ReviewFile>();
  let approved = 0;
  let rejected = 0;

  for (const [index, { file, entry }] of queue.entries()) {
    console.log(`\n${'─'.repeat(72)}`);
    console.log(renderEntry(entry, { index: index + 1, total: queue.length }));

    if (entry.errors.length > 0) {
      console.log(red('\n  This entry has errors and cannot be imported until they are fixed.'));
    }

    let key = '';
    while (!['a', 'r', 'n', 's', 'q'].includes(key)) {
      key = await readKey('\n  [a/r/n/s/q] ');
    }

    if (key === 'q') break;
    if (key === 's') continue;

    if (key === 'a') {
      if (entry.errors.length > 0) {
        console.log(red('  refused: fix the errors first'));
        continue;
      }
      entry.status = 'approved';
      entry.approvedAt = new Date().toISOString();
      // Bind the approval to this exact content — editing it later un-approves it.
      entry.approvedHash = approvalHash({ draft: entry.draft, derived: entry.derived });
      approved += 1;
      console.log(green('  approved'));
    } else if (key === 'r') {
      entry.status = 'rejected';
      entry.approvedHash = null;
      entry.approvedAt = null;
      rejected += 1;
      console.log(dim('  rejected'));
    } else {
      entry.status = 'needs-review';
      entry.approvedHash = null;
      entry.approvedAt = null;
      console.log(yellow('  marked needs-review'));
    }

    touched.add(file);
  }

  for (const file of touched) saveReviewFile(file);

  console.log(
    `\n${green(`${approved} approved`)} · ${rejected} rejected · ` +
      `${touched.size} file${touched.size === 1 ? '' : 's'} written`,
  );
  if (approved > 0) {
    console.log(dim('\nNext: `npm run catalog:import` (dry run — add --commit to write).'));
  }
}

async function main() {
  const { categoryIds, status, triage: interactive, approveAll: approveAllFlag } = parse();

  const files = categoryIds
    .map(loadRefreshed)
    .filter((file): file is ReviewFile => file !== null);

  if (files.length === 0) {
    console.log('No review files yet. Run `npm run catalog:generate -- --all` first.');
    return;
  }

  if (approveAllFlag) {
    approveAll(files);
  } else if (interactive) {
    await triage(files, status);
  } else {
    summarize(files, status);
  }
}

main().catch((error: unknown) => {
  console.error(`\n${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
