/**
 * Terminal rendering for a catalog entry. Shared by `review` (the triage loop)
 * and `import` (the dry-run plan) so an entry looks the same wherever you see it.
 */

import type { ReviewEntry } from './reviewFile';

const ANSI = {
  reset: '\u001b[0m',
  dim: '\u001b[2m',
  bold: '\u001b[1m',
  red: '\u001b[31m',
  yellow: '\u001b[33m',
  green: '\u001b[32m',
  cyan: '\u001b[36m',
};

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code: string, text: string) => (useColor ? `${code}${text}${ANSI.reset}` : text);

export const dim = (t: string) => paint(ANSI.dim, t);
export const bold = (t: string) => paint(ANSI.bold, t);
export const red = (t: string) => paint(ANSI.red, t);
export const yellow = (t: string) => paint(ANSI.yellow, t);
export const green = (t: string) => paint(ANSI.green, t);
export const cyan = (t: string) => paint(ANSI.cyan, t);

export function formatDose(entry: ReviewEntry): string {
  const { draft, derived } = entry;
  switch (draft.timing_type) {
    case 'reps':
      return `${draft.default_dose} reps (cap ${derived.rep_cap_seconds}s)`;
    case 'breaths':
      return `${draft.default_dose} breaths`;
    case 'hold_per_side':
      return `${draft.default_dose}s per side`;
    default:
      return `${draft.default_dose}s`;
  }
}

export function statusLabel(entry: ReviewEntry): string {
  switch (entry.status) {
    case 'approved':
      return green('approved');
    case 'rejected':
      return dim('rejected');
    case 'duplicate':
      return red('duplicate');
    case 'needs-review':
      return yellow('needs-review');
    default:
      return 'pending';
  }
}

/** The full entry, for triage. */
export function renderEntry(entry: ReviewEntry, context?: { index: number; total: number }): string {
  const { draft, derived } = entry;
  const lines: string[] = [];

  const counter = context ? dim(`[${context.index}/${context.total}] `) : '';
  const aka = draft.aka.length > 0 ? dim(`  [${draft.aka.join(' / ')}]`) : '';
  lines.push(`${counter}${bold(draft.name)}${aka}`);

  const equipment = draft.equipment.length > 0 ? draft.equipment.join('+') : 'bodyweight';
  const unilateral = draft.unilateral ? ' · UNILATERAL (dose is per side)' : '';
  lines.push(
    dim('  ') +
      [
        draft.modality,
        draft.movement_pattern,
        draft.body_position,
        equipment,
        `intensity ${draft.intensity}`,
      ].join(' · ') +
      unilateral,
  );

  const secondary =
    draft.secondary_regions.length > 0 ? ` (${draft.secondary_regions.join(', ')})` : '';
  lines.push(`  ${formatDose(entry)}   ${dim('regions:')} ${draft.primary_regions.join(', ')}${dim(secondary)}`);

  lines.push('');
  for (const cue of draft.cues) lines.push(`    ${cyan('·')} ${cue}`);
  lines.push('');

  if (draft.setup_note) lines.push(`  ${dim('setup:')} ${draft.setup_note}`);

  const relations: string[] = [];
  if (draft.regression_hint) relations.push(`easier: ${draft.regression_hint}`);
  if (draft.progression_hint) relations.push(`harder: ${draft.progression_hint}`);
  if (relations.length > 0) lines.push(`  ${dim(relations.join('   |   '))}`);

  if (draft.pairs_well_with_hints.length > 0) {
    lines.push(`  ${dim('pairs with: ' + draft.pairs_well_with_hints.join(', '))}`);
  }
  if (draft.avoid_after_hints.length > 0) {
    lines.push(`  ${dim('avoid after: ' + draft.avoid_after_hints.join(', '))}`);
  }

  lines.push(`  ${dim('id:')} ${derived.id}`);

  for (const error of entry.errors) lines.push(`  ${red('ERROR')} ${error.code}: ${error.message}`);
  for (const warning of entry.warnings) {
    lines.push(`  ${yellow('warn')}  ${warning.code}: ${warning.message}`);
  }
  if (entry.dupOf) lines.push(`  ${red('duplicate of')} ${entry.dupOf}`);
  if (entry.slotPeers.length > 0) {
    lines.push(`  ${dim('same slot as: ' + entry.slotPeers.join(', '))}`);
  }
  if (entry.reviewerNote) lines.push(`  ${dim('note:')} ${entry.reviewerNote}`);

  return lines.join('\n');
}

/** One line per entry, for the status table. */
export function renderRow(entry: ReviewEntry): string {
  const flags = [
    entry.errors.length > 0 ? red(`${entry.errors.length}e`) : '  ',
    entry.warnings.length > 0 ? yellow(`${entry.warnings.length}w`) : '  ',
  ].join(' ');
  const name = entry.draft.name.length > 38 ? `${entry.draft.name.slice(0, 37)}…` : entry.draft.name;
  return `  ${statusLabel(entry).padEnd(useColor ? 22 : 13)} ${flags}  ${name.padEnd(38)} ${dim(entry.derived.id)}`;
}
