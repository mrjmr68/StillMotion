/**
 * The session as a flat list of timed phases.
 *
 * This is `itemTotalSeconds` unrolled, term for term. That module computes
 *
 *   work x sides + INTER_SIDE_REST x (sides - 1) + rest + transition
 *
 * and this one emits exactly those terms as separate phases, so
 *
 *   sum(phase.seconds) === plan.totals.total_seconds
 *
 * is an identity rather than a coincidence — and `stage:check` asserts it across
 * every template and scenario. That assertion is what keeps the planner's ±10%
 * duration guarantee true at *runtime*: if the TV counted down differently from
 * what the validator budgeted, the guarantee would be silently false.
 *
 * Note it CONSUMES `item.work_seconds` rather than recomputing it. `expand.ts`
 * already derived that via `itemWorkSeconds`, so there is exactly one
 * implementation of "how long is this movement" in the codebase.
 */

import { INTER_SIDE_REST_SECONDS } from '../planner/vocab';
import type { PlanItem, SessionPlan } from '../planner/schema';

export type PhaseKind = 'transition' | 'work' | 'side_switch' | 'rest' | 'complete';

export type Phase = {
  kind: PhaseKind;
  /** Index into the timeline. This is the authoritative runtime cursor. */
  index: number;
  blockIndex: number;
  /** Flat item index within the block, matching `exercise_logs.item_index`. */
  itemIndex: number;
  exerciseId: string;
  seconds: number;
  /** Which side this phase trains. 'both' for bilateral movements. */
  side: 'both' | 'left' | 'right';
  /**
   * True only for `reps` work. Spec §8's soft cap: show the target reps and run
   * a timer, advance on Done OR at the cap, so "you are never stranded holding
   * a kettlebell waiting for permission to continue."
   */
  softCap: boolean;
  /** Reps/seconds/breaths target for the movement, for display. */
  dose: number;
  intensity: number;
  round: number;
};

function phase(
  partial: Omit<Phase, 'index'> & { index?: number },
  index: number,
): Phase {
  return {
    index,
    kind: partial.kind,
    blockIndex: partial.blockIndex,
    itemIndex: partial.itemIndex,
    exerciseId: partial.exerciseId,
    seconds: partial.seconds,
    side: partial.side,
    softCap: partial.softCap,
    dose: partial.dose,
    intensity: partial.intensity,
    round: partial.round,
  };
}

/**
 * Expand one item into its phases.
 *
 *   bilateral:  [transition] [work(both)]              [rest]
 *   unilateral: [transition] [work(L)] [switch] [work(R)] [rest]
 *
 * Zero-second phases are dropped — a transition of 0s or a rest of 0s is not a
 * screen anyone should see.
 */
function phasesForItem(item: PlanItem, blockIndex: number, startIndex: number): Phase[] {
  const out: Phase[] = [];
  const softCap = item.timing_type === 'reps';

  const base = {
    blockIndex,
    itemIndex: item.index,
    exerciseId: item.exercise_id,
    dose: item.dose,
    intensity: item.intensity,
    round: item.round,
  };

  let next = startIndex;

  if (item.transition_seconds > 0) {
    out.push(
      phase(
        { ...base, kind: 'transition', seconds: item.transition_seconds, side: 'both', softCap: false },
        next,
      ),
    );
    next += 1;
  }

  if (item.sides.length === 1) {
    out.push(
      phase({ ...base, kind: 'work', seconds: item.work_seconds, side: 'both', softCap }, next),
    );
    next += 1;
  } else {
    out.push(
      phase({ ...base, kind: 'work', seconds: item.work_seconds, side: 'left', softCap }, next),
    );
    next += 1;

    if (INTER_SIDE_REST_SECONDS > 0) {
      out.push(
        phase(
          {
            ...base,
            kind: 'side_switch',
            seconds: INTER_SIDE_REST_SECONDS,
            side: 'right',
            softCap: false,
          },
          next,
        ),
      );
      next += 1;
    }

    out.push(
      phase({ ...base, kind: 'work', seconds: item.work_seconds, side: 'right', softCap }, next),
    );
    next += 1;
  }

  if (item.rest_seconds > 0) {
    out.push(
      phase({ ...base, kind: 'rest', seconds: item.rest_seconds, side: 'both', softCap: false }, next),
    );
  }

  return out;
}

export function buildTimeline(plan: SessionPlan): Phase[] {
  const phases: Phase[] = [];

  for (const block of plan.blocks) {
    for (const item of block.items) {
      const expanded = phasesForItem(item, block.index, phases.length);
      for (const entry of expanded) phases.push(entry);
    }
  }

  return phases;
}

/** Total wall-clock seconds. Must equal `plan.totals.total_seconds`. */
export function timelineSeconds(timeline: Phase[]): number {
  let total = 0;
  for (const entry of timeline) total += entry.seconds;
  return total;
}

/**
 * The next phase that shows a *different* movement — what the "Next:" strip
 * names, and what a rest screen previews. Spec §8: rest screens show the next
 * movement's loop already playing, because that is free instruction time.
 */
export function nextMovementPhase(timeline: Phase[], from: number): Phase | null {
  if (from < 0 || from >= timeline.length) return null;
  const current = timeline[from].exerciseId;

  for (let i = from + 1; i < timeline.length; i += 1) {
    if (timeline[i].exerciseId !== current && timeline[i].kind === 'work') return timeline[i];
  }
  return null;
}

/** How far through the session this phase starts, 0..1 — the top progress bar. */
export function progressAt(timeline: Phase[], index: number): number {
  const total = timelineSeconds(timeline);
  if (total <= 0) return 0;

  let elapsed = 0;
  for (let i = 0; i < index && i < timeline.length; i += 1) elapsed += timeline[i].seconds;
  return elapsed / total;
}
