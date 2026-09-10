'use client';

/**
 * The session, before it starts.
 *
 * Spec §7: "the TV shows the session shape for a beat — '38 minutes · 4 blocks ·
 * kettlebell + floor' — then waits for Begin." The phone shows the same summary
 * and one more thing the television deliberately does not: the actual movements.
 *
 * That asymmetry is the point of two screens. Ten feet away you want the shape;
 * in your hand, before you commit forty minutes, you want to know whether it put
 * shrimp squats in. Everything here is derived from the stored plan, so it
 * cannot disagree with what the TV is about to run.
 */

import { formatSeconds } from '@/lib/planner/budget';
import type { SessionPlan } from '@/lib/planner/schema';
import { PrimaryButton, QuietButton } from './controls';

export default function ShapeCard({
  plan,
  names,
  paired,
  busy,
  onBegin,
  onDiscard,
}: {
  plan: SessionPlan;
  names: Record<string, string>;
  paired: boolean;
  busy: boolean;
  onBegin: () => void;
  onDiscard: () => void;
}) {
  const minutes = Math.round(plan.totals.total_seconds / 60);
  const equipment = plan.checkin.equipment_on_hand;

  const summary = [
    `${minutes} minutes`,
    `${plan.blocks.length} blocks`,
    equipment.length > 0 ? equipment.join(' + ') : 'bodyweight',
  ].join(' · ');

  // The template path is not a failure — it is the guarantee working — but it
  // produces a different session than asked for, and finding that out mid-workout
  // would be worse than a line of text here.
  const fellBack = plan.source === 'template' || plan.source === 'template_degraded';

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold text-neutral-100">{summary}</h1>
        <p className="text-neutral-400">{plan.intent}</p>
      </header>

      {fellBack && (
        <p className="rounded-xl border border-amber-900/60 bg-amber-950/30 px-4 py-3 text-sm text-amber-200">
          Built from a template this time — the generator didn&apos;t produce a
          usable plan. It&apos;s a real session, just not a bespoke one.
        </p>
      )}

      <div className="space-y-4">
        {plan.blocks.map((block) => (
          <div key={block.index} className="rounded-xl border border-neutral-800 p-4">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="font-medium text-neutral-100">{block.label}</h2>
              <span className="text-xs uppercase tracking-wide text-neutral-500">
                {block.rounds > 1 ? `${block.rounds} rounds · ` : ''}
                {block.format}
              </span>
            </div>

            <ul className="mt-3 space-y-1.5 text-sm text-neutral-300">
              {/* One line per movement, not per round — a circuit listed three
                  times reads as three different exercises at a glance. */}
              {block.items
                .filter((item) => item.round === 1)
                .map((item) => (
                  <li key={item.index} className="flex justify-between gap-3">
                    <span>{names[item.exercise_id] ?? item.exercise_id}</span>
                    <span className="shrink-0 tabular-nums text-neutral-500">
                      {doseLabel(item.timing_type, item.dose)}
                      {item.sides.length === 2 ? ' /side' : ''}
                    </span>
                  </li>
                ))}
            </ul>
          </div>
        ))}
      </div>

      <p className="text-xs text-neutral-500">
        {formatSeconds(plan.totals.work_seconds)} of work ·{' '}
        {formatSeconds(plan.totals.rest_seconds)} rest ·{' '}
        {formatSeconds(plan.totals.transition_seconds)} moving between things
      </p>

      <div className="space-y-3">
        <PrimaryButton onClick={onBegin} disabled={busy || !paired}>
          {busy ? 'Starting…' : 'Begin'}
        </PrimaryButton>
        {!paired && (
          <p className="text-center text-xs text-neutral-500">
            Connect the television to begin. The session keeps until you do.
          </p>
        )}
        <QuietButton onClick={onDiscard} disabled={busy}>
          Discard and check in again
        </QuietButton>
      </div>
    </div>
  );
}

function doseLabel(timingType: string, dose: number): string {
  if (timingType === 'reps') return `${dose} reps`;
  if (timingType === 'breaths') return `${dose} breaths`;
  return `${dose}s`;
}
