/**
 * The session clock, as a pure reducer.
 *
 * No DOM, no network, no timer, no clock inside it — `now` is always passed in.
 * React calls `advance()` at 5Hz and renders the result; a CLI script calls the
 * same functions with a fake clock and asserts. That is the whole reason this is
 * a reducer rather than a hook: spec §3 says the TV has no reliable devtools, so
 * everything that CAN be verified away from the device MUST be.
 *
 * THE CLOCK NEVER ACCUMULATES. Remaining time is always derived from wall time:
 *
 *   remaining = duration + added - (now - startedAt - pausedAccum - activePause)
 *
 * `setInterval` drift over a 60-minute session on weak hardware is real, and TV
 * browsers throttle timers in the background. Subtracting a tick per frame would
 * turn that drift into a session that ends minutes late; deriving from wall time
 * means 200ms of jitter is 200ms of jitter, forever.
 */

import { restIndexForItem, nextItemIndex } from './cursor';
import type { Phase } from './timeline';

export type StageCommand =
  | 'begin'
  | 'pause'
  | 'resume'
  | 'skip'
  | 'add_30s'
  | 'done'
  | 'end'
  | 'swap';

export type RunState = {
  phaseIndex: number;
  /** Wall-clock ms when the current phase started. */
  phaseStartedAt: number;
  /** Nominal length of the current phase, ms. */
  phaseDurationMs: number;
  /** Time added to the CURRENT phase only, by add_30s. Never mutates the plan. */
  addedMs: number;
  /** Wall-clock ms when the current pause began, or null when running. */
  pausedAt: number | null;
  /** Total paused ms accumulated within the current phase. */
  pausedAccumMs: number;
  finished: boolean;
  /** Items the user skipped, for `plan_performed` and `exercise_logs`. */
  skipped: number[];
  /** Last command id applied, so a redelivered command is ignored. */
  lastCommandId: string | null;
};

export const ADD_SECONDS = 30;

export function initial(timeline: Phase[], startIndex: number, now: number): RunState {
  const index = startIndex >= 0 && startIndex < timeline.length ? startIndex : 0;
  const phase = timeline[index];
  return {
    phaseIndex: index,
    phaseStartedAt: now,
    phaseDurationMs: phase ? phase.seconds * 1000 : 0,
    addedMs: 0,
    pausedAt: null,
    pausedAccumMs: 0,
    finished: timeline.length === 0,
    skipped: [],
    lastCommandId: null,
  };
}

/** Milliseconds left in the current phase. Never negative. */
export function remainingMs(state: RunState, now: number): number {
  const activePause = state.pausedAt === null ? 0 : now - state.pausedAt;
  const elapsed = now - state.phaseStartedAt - state.pausedAccumMs - activePause;
  const remaining = state.phaseDurationMs + state.addedMs - elapsed;
  return remaining > 0 ? remaining : 0;
}

export function remainingSeconds(state: RunState, now: number): number {
  return Math.ceil(remainingMs(state, now) / 1000);
}

/**
 * Move to a specific phase. Resets everything phase-scoped — including
 * `addedMs`, because thirty seconds added to a plank does not belong to the
 * stretch that follows it.
 */
function goTo(state: RunState, timeline: Phase[], index: number, now: number): RunState {
  if (index >= timeline.length || index < 0) {
    return { ...state, finished: true, pausedAt: null };
  }
  return {
    ...state,
    phaseIndex: index,
    phaseStartedAt: now,
    phaseDurationMs: timeline[index].seconds * 1000,
    addedMs: 0,
    // A pause survives the phase boundary: if you paused and the timer ran out
    // while paused, you are still paused on the next screen.
    pausedAt: state.pausedAt === null ? null : now,
    pausedAccumMs: 0,
  };
}

/**
 * Advance the clock. Called on every render tick.
 *
 * A phase whose timer reaches zero auto-advances UNLESS it is a reps soft cap —
 * no wait, even then it advances. That is spec §8's actual requirement: "don't
 * tap, and it advances at the cap. You are never stranded holding a kettlebell
 * waiting for permission to continue." The soft cap changes what is DISPLAYED
 * (target reps, with the timer secondary), not whether time runs out.
 */
export function advance(state: RunState, timeline: Phase[], now: number): RunState {
  if (state.finished) return state;
  if (state.pausedAt !== null) return state;
  if (remainingMs(state, now) > 0) return state;

  // Roll forward through any zero-length phases in one tick.
  let next = state;
  let guard = 0;
  do {
    next = goTo(next, timeline, next.phaseIndex + 1, now);
    guard += 1;
  } while (!next.finished && next.phaseDurationMs + next.addedMs <= 0 && guard < timeline.length + 1);

  return next;
}

export type ApplyResult = { state: RunState; handled: boolean; note?: string };

export function apply(
  state: RunState,
  timeline: Phase[],
  command: StageCommand,
  now: number,
  commandId?: string,
): ApplyResult {
  // At-most-once: a redelivered command (our ack was lost) must not fire twice.
  // This matters most for add_30s, the one command a human genuinely presses
  // twice in a row on purpose — which is why the id comes from the payload
  // rather than the command name.
  if (commandId && commandId === state.lastCommandId) {
    return { state, handled: false, note: 'duplicate command ignored' };
  }

  const stamp = (next: RunState): RunState =>
    commandId ? { ...next, lastCommandId: commandId } : next;

  const current = timeline[state.phaseIndex];

  switch (command) {
    case 'pause': {
      if (state.pausedAt !== null) return { state: stamp(state), handled: false };
      return { state: stamp({ ...state, pausedAt: now }), handled: true };
    }

    case 'resume': {
      if (state.pausedAt === null) return { state: stamp(state), handled: false };
      return {
        state: stamp({
          ...state,
          pausedAccumMs: state.pausedAccumMs + (now - state.pausedAt),
          pausedAt: null,
        }),
        handled: true,
      };
    }

    case 'add_30s': {
      return { state: stamp({ ...state, addedMs: state.addedMs + ADD_SECONDS * 1000 }), handled: true };
    }

    case 'done': {
      // Reps only. On a pure timer the screen owns the clock and Done is
      // meaningless — silently ignoring it is correct, not a missing feature.
      if (!current || !current.softCap || current.kind !== 'work') {
        return { state: stamp(state), handled: false, note: 'done ignored: not a reps phase' };
      }
      return { state: stamp(goTo(state, timeline, state.phaseIndex + 1, now)), handled: true };
    }

    case 'skip': {
      if (!current) return { state: stamp(state), handled: false };

      // From work, skip to this item's own rest — you still get the recovery.
      // From rest or a transition, skip to the next item entirely.
      let target: number | null = null;
      if (current.kind === 'work' || current.kind === 'side_switch') {
        target = restIndexForItem(timeline, state.phaseIndex);
      }
      if (target === null) target = nextItemIndex(timeline, state.phaseIndex);
      if (target === null) return { state: stamp({ ...state, finished: true }), handled: true };

      const skipped =
        state.skipped.indexOf(current.itemIndex) >= 0
          ? state.skipped
          : state.skipped.concat([current.itemIndex]);

      return { state: stamp({ ...goTo(state, timeline, target, now), skipped }), handled: true };
    }

    case 'end': {
      return { state: stamp({ ...state, finished: true, pausedAt: null }), handled: true };
    }

    case 'begin': {
      // Handled by the screen state machine, not the clock.
      return { state: stamp(state), handled: false };
    }

    case 'swap': {
      // Deferred: swapping needs a catalog row the TV never bundled, and how a
      // replacement gets chosen belongs with the console slice that owns it.
      return { state: stamp(state), handled: false, note: 'swap is not implemented yet' };
    }

    default:
      return { state, handled: false };
  }
}

export function isPaused(state: RunState): boolean {
  return state.pausedAt !== null;
}

export function currentPhase(state: RunState, timeline: Phase[]): Phase | null {
  if (state.finished) return null;
  if (state.phaseIndex < 0 || state.phaseIndex >= timeline.length) return null;
  return timeline[state.phaseIndex];
}
