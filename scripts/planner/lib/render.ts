/**
 * Terminal rendering of a session plan.
 *
 * This is the point of the whole CLI. The catalog harness's lesson was that
 * generated content you can't see at a glance is content you can't judge — so
 * this has to make the exercise science readable: what order, how long, how
 * hard, and what the repairer changed on the way.
 */

import type { CatalogRow } from '../../../src/lib/catalog/schema';
import { formatSeconds, itemTotalSeconds } from '../../../src/lib/planner/budget';
import type { SessionPlan } from '../../../src/lib/planner/schema';
import { FOCUS_LABELS } from '../../../src/lib/planner/vocab';
import { bold, cyan, dim, green, red, yellow } from '../../catalog/lib/render';

const KIND_LABEL: Record<string, string> = {
  prepare: 'PREPARE',
  integrate: 'INTEGRATE',
  main: 'MAIN',
  down_regulate: 'DOWN-REG',
};

const MODALITY_ABBREV: Record<string, string> = {
  mobility: 'mob',
  yoga: 'yog',
  strength: 'str',
  capacity: 'cap',
  balance: 'bal',
  breath: 'brt',
};

function doseLabel(item: SessionPlan['blocks'][number]['items'][number]): string {
  const perSide = item.sides.length > 1 ? '/side' : '';
  switch (item.timing_type) {
    case 'reps':
      return `${item.dose} reps${perSide}`;
    case 'breaths':
      return `${item.dose} breaths`;
    case 'hold_per_side':
      return `${item.dose}s/side`;
    default:
      return `${item.dose}s`;
  }
}

export function renderPlan(plan: SessionPlan, catalog: Map<string, CatalogRow>): string {
  const out: string[] = [];
  const { checkin, totals } = plan;

  const header = [
    `${checkin.duration_min} min`,
    checkin.energy,
    FOCUS_LABELS[checkin.focus],
    checkin.avoid_regions.length > 0 ? `avoiding ${checkin.avoid_regions.join(', ')}` : null,
    checkin.equipment_on_hand.length > 0 ? checkin.equipment_on_hand.join(', ') : 'bodyweight',
  ]
    .filter(Boolean)
    .join(' · ');
  out.push(bold(header));

  const sourceColor = plan.source.startsWith('template') ? yellow : green;
  out.push(
    dim(
      [
        sourceColor(plan.source),
        `${plan.repairs.length} repair${plan.repairs.length === 1 ? '' : 's'}`,
        plan.model ?? 'no model',
      ].join(' · '),
    ),
  );
  out.push('');
  out.push(dim(`  "${plan.intent}"`));
  out.push('');

  for (const block of plan.blocks) {
    const blockSeconds = block.items.reduce((sum, item) => sum + itemTotalSeconds(item), 0);
    const roundsLabel = block.rounds > 1 ? `${block.format} · ${block.rounds} rounds` : block.format;
    out.push(
      `  ${bold(KIND_LABEL[block.kind] ?? block.kind)}  ${block.label}` +
        dim(`  (${roundsLabel})`) +
        dim(`   ${formatSeconds(blockSeconds)}`),
    );

    // Only the first round is listed in full; later rounds repeat it.
    const firstRound = block.items.filter((item) => item.round === 1);
    for (const item of firstRound) {
      const row = catalog.get(item.exercise_id);
      const name = row?.name ?? red(`${item.exercise_id} (unknown)`);
      const workLabel =
        item.sides.length > 1
          ? `~${item.work_seconds * 2}s`
          : `~${item.work_seconds}s`;

      out.push(
        `    ${dim(String(item.index + 1).padStart(2))} ${String(name).padEnd(38)} ` +
          `${doseLabel(item).padEnd(15)} ${dim(workLabel.padEnd(7))} ` +
          `${dim(`r${item.rest_seconds}`.padEnd(5))} ` +
          `${MODALITY_ABBREV[row?.modality ?? ''] ?? '?'} ${row?.intensity ?? '?'}  ` +
          dim(row?.body_position ?? ''),
      );
    }
    out.push('');
  }

  const driftPct = (totals.drift_pct * 100).toFixed(1);
  const driftColor = Math.abs(totals.drift_pct) > 0.1 ? red : dim;
  const mainPct = Math.round((totals.main_work_seconds / Math.max(totals.total_seconds, 1)) * 100);

  out.push(
    `  work ${formatSeconds(totals.work_seconds)} · rest ${formatSeconds(totals.rest_seconds)} · ` +
      `transitions ${formatSeconds(totals.transition_seconds)} · ` +
      bold(`total ${formatSeconds(totals.total_seconds)}`) +
      ' ' +
      driftColor(`(${totals.drift_pct >= 0 ? '+' : ''}${driftPct}%)`),
  );
  out.push(dim(`  main work ${formatSeconds(totals.main_work_seconds)} (${mainPct}% of session)`));

  if (plan.repairs.length > 0) {
    out.push('');
    out.push(bold('  repairs'));
    for (const repair of plan.repairs) {
      const arrow = repair.from && repair.to ? `${repair.from} → ${repair.to}` : repair.detail;
      out.push(`    ${cyan(repair.code.padEnd(24))} ${arrow}`);
    }
  }

  const errors = plan.findings.filter((f) => !isWarningCode(f.code));
  const warnings = plan.findings.filter((f) => isWarningCode(f.code));

  if (errors.length > 0) {
    out.push('');
    out.push(bold(red('  unresolved')));
    for (const finding of errors) out.push(`    ${red(finding.code.padEnd(24))} ${finding.message}`);
  }

  if (warnings.length > 0) {
    out.push('');
    out.push(bold('  warnings'));
    for (const finding of warnings) {
      out.push(`    ${yellow(finding.code.padEnd(24))} ${finding.message}`);
    }
  }

  return out.join('\n');
}

const WARNING_CODES = new Set([
  'avoided_region_secondary',
  'repeat_recency',
  'dose_out_of_band',
  'duplicate_within_session',
  'main_work_fraction',
  'transition_churn',
  'floor_round_trips',
  'no_antagonist_alternation',
  'nervous_system_late',
  'intensity_ramp',
  'consecutive_region_unavoidable',
  'pool_too_thin',
]);

function isWarningCode(code: string): boolean {
  return WARNING_CODES.has(code);
}
