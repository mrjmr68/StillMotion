/**
 * What the phone shows while the television is running a session.
 *
 * Pure, and derived from the SAME timeline the stage runs — the console calls
 * `buildTimeline` on the same plan and locates itself with `phase_index`. That
 * is the whole reason `phase_index` exists as a column: `{block, item,
 * seconds_remaining}` cannot tell "30 seconds of goblet squat" from "30 seconds
 * of rest before goblet squat", so a phone built on those three columns would
 * confidently mislabel every rest in the session.
 *
 * The mirror is a mirror. It never computes what SHOULD be happening, only what
 * the TV last said is happening — spec §4 gives the television the clock, and a
 * phone that disagreed with the screen in front of you would be worse than a
 * phone showing nothing.
 */

import { fromCursor, phaseAt } from '../stage/cursor';
import {
  nextMovementPhase,
  progressAt,
  type Phase,
  type PhaseKind,
} from '../stage/timeline';
import type { SessionPlan } from '../planner/schema';

/** The subset of `session_live_state` the mirror reads. */
export type LiveCursor = {
  phase_index: number | null;
  phase: string | null;
  current_block_index: number | null;
  current_item_index: number | null;
  side: 'left' | 'right' | null;
  seconds_remaining: number | null;
  is_paused: boolean | null;
};

export type MirrorView = {
  phase: Phase | null;
  kind: PhaseKind;
  /** Rest and transition both mean "not working" to everything on this screen. */
  resting: boolean;
  blockLabel: string;
  roundLabel: string | null;
  /** During a rest this is the movement being rested BEFORE, matching the TV. */
  movementId: string | null;
  side: 'both' | 'left' | 'right';
  dose: number | null;
  /**
   * Whether Done means anything right now. Spec §8's soft cap only applies to
   * reps work — offering Done on a 40-second hold would be a button that lies.
   */
  canDone: boolean;
  secondsRemaining: number;
  paused: boolean;
  /** 0..1 through the whole session. */
  progress: number;
  sessionSecondsLeft: number;
  nextMovementId: string | null;
};

const IDLE: MirrorView = {
  phase: null,
  kind: 'complete',
  resting: true,
  blockLabel: '',
  roundLabel: null,
  movementId: null,
  side: 'both',
  dose: null,
  canDone: false,
  secondsRemaining: 0,
  paused: false,
  progress: 0,
  sessionSecondsLeft: 0,
  nextMovementId: null,
};

export function mirrorView(
  plan: SessionPlan,
  timeline: Phase[],
  cursor: LiveCursor | null,
): MirrorView {
  if (!cursor) return IDLE;

  // `fromCursor` prefers phase_index and falls back to a block/item/side scan,
  // so a row written before that column existed — or hand-edited in the table
  // editor, which spec §3's "no devtools" makes likelier than usual — still
  // lands somewhere sane instead of on phase zero.
  const index = fromCursor(timeline, {
    phase_index: cursor.phase_index ?? undefined,
    block_index: cursor.current_block_index ?? undefined,
    item_index: cursor.current_item_index ?? undefined,
    side: cursor.side,
  });

  const phase = phaseAt(timeline, index);
  if (!phase) return IDLE;

  const resting = phase.kind === 'rest' || phase.kind === 'transition';
  const upcoming = nextMovementPhase(timeline, phase.index);
  const shown = resting && upcoming ? upcoming : phase;
  const block = plan.blocks[phase.blockIndex];

  const secondsRemaining = Math.max(0, cursor.seconds_remaining ?? 0);

  let tail = 0;
  for (let i = phase.index + 1; i < timeline.length; i += 1) {
    tail += timeline[i].seconds;
  }

  // During a rest the named movement is already the next one, so the strip has
  // to look one further ahead or it names the same thing twice — the same bug
  // the stage's "Next:" strip had, and the same fix.
  const strip = resting && upcoming ? nextMovementPhase(timeline, upcoming.index) : upcoming;

  return {
    phase,
    kind: phase.kind,
    resting,
    blockLabel: block ? block.label : '',
    roundLabel: block && block.rounds > 1 ? `round ${phase.round} of ${block.rounds}` : null,
    movementId: shown.exerciseId || null,
    side: phase.side,
    dose: shown.kind === 'work' ? shown.dose : null,
    canDone: phase.kind === 'work' && phase.softCap,
    secondsRemaining,
    paused: cursor.is_paused === true,
    progress: progressAt(timeline, phase.index),
    sessionSecondsLeft: secondsRemaining + tail,
    nextMovementId: strip ? strip.exerciseId : null,
  };
}

/**
 * Smooth the countdown between reads.
 *
 * The TV writes its cursor every ~2.25 seconds. Showing the raw value would
 * make the phone jump 30 → 28 → 25 while the screen beside it counts evenly, so
 * the mirror carries the last read forward with local elapsed time — and stops
 * dead when the TV says paused, because a paused clock that kept sliding would
 * be the one case where the mirror actively lies.
 */
export function tickedSeconds(view: MirrorView, msSinceRead: number): number {
  if (view.paused) return view.secondsRemaining;
  const elapsed = Math.floor(Math.max(0, msSinceRead) / 1000);
  return Math.max(0, view.secondsRemaining - elapsed);
}

export function formatClock(seconds: number): string {
  const safe = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(safe / 60);
  const rest = safe % 60;
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}
