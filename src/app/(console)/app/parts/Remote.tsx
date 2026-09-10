'use client';

/**
 * The remote (spec §4).
 *
 * The phone mirrors and commands; it does not run anything. The television owns
 * the clock, so every number here is the last thing the TV said, carried forward
 * with local elapsed time — never a second timer that could drift away from the
 * screen you are standing in front of and quietly become a liar.
 *
 * Commands are fire-and-forget into `session_live_state`. The TV picks one up on
 * its next 750ms poll, applies it, and acknowledges it by id; the button
 * therefore confirms nothing on press. It says "sent", and the mirror changing
 * is the confirmation — which is honest about where the truth lives.
 */

import { useEffect, useState } from 'react';
import { CUE_LEVEL_LABELS } from '@/lib/console/vocab';
import { formatClock, type MirrorView } from '@/lib/console/mirror';
import type { CueLevel } from '@/lib/stage/contract';
import type { StageCommand } from '@/lib/stage/machine';

const CUE_LEVELS: CueLevel[] = ['off', 'key', 'full'];

export default function Remote({
  view,
  seconds,
  names,
  cueLevel,
  connected,
  pending,
  onCommand,
  onCueLevel,
}: {
  view: MirrorView;
  seconds: number;
  names: Record<string, string>;
  cueLevel: CueLevel;
  connected: boolean;
  pending: StageCommand | null;
  onCommand: (command: StageCommand) => void;
  onCueLevel: (level: CueLevel) => void;
}) {
  /*
   * End is two taps.
   *
   * Every other control is recoverable — a wrong Skip costs one movement, a
   * wrong +30s costs thirty seconds. End writes the logs and closes the session,
   * and it sits on the same screen as Pause, which is the button you reach for
   * with a kettlebell in the other hand.
   */
  const [confirmingEnd, setConfirmingEnd] = useState(false);

  useEffect(() => {
    if (!confirmingEnd) return;
    const timer = setTimeout(() => setConfirmingEnd(false), 4000);
    return () => clearTimeout(timer);
  }, [confirmingEnd]);

  const movement = view.movementId ? (names[view.movementId] ?? view.movementId) : '';
  const nextMovement = view.nextMovementId
    ? (names[view.nextMovementId] ?? view.nextMovementId)
    : null;

  return (
    <div className="flex min-h-[calc(100dvh-7rem)] flex-col gap-6">
      <div className="h-1 overflow-hidden rounded-full bg-neutral-800">
        <div
          className="h-full origin-left bg-neutral-300 transition-transform duration-500"
          style={{ transform: `scaleX(${view.progress})` }}
        />
      </div>

      <header className="flex items-baseline justify-between gap-3 text-sm">
        <span className="text-neutral-400">
          {view.blockLabel}
          {view.roundLabel ? ` · ${view.roundLabel}` : ''}
        </span>
        <span className="tabular-nums text-neutral-500">
          {formatClock(view.sessionSecondsLeft)} left
          {!connected && ' · offline'}
        </span>
      </header>

      <div className="flex flex-1 flex-col justify-center gap-3 text-center">
        <p className="text-xs uppercase tracking-widest text-neutral-500">
          {view.paused
            ? 'Paused'
            : view.kind === 'rest'
              ? 'Rest — coming up'
              : view.kind === 'transition'
                ? 'Set up for'
                : view.kind === 'side_switch'
                  ? 'Switch sides'
                  : 'Working'}
        </p>

        <h1 className="text-3xl font-semibold leading-tight text-neutral-100">{movement}</h1>

        {view.side !== 'both' && view.kind === 'work' && (
          <p className="text-lg font-medium uppercase tracking-widest text-amber-400">
            {view.side}
          </p>
        )}

        <div
          className={`text-7xl font-semibold tabular-nums ${
            view.paused ? 'text-neutral-500' : seconds <= 5 ? 'text-red-400' : 'text-neutral-100'
          }`}
        >
          {seconds}
        </div>

        {view.canDone && view.dose !== null && (
          <p className="text-sm text-neutral-400">{view.dose} reps · timer is a cap</p>
        )}

        {nextMovement && (
          <p className="text-sm text-neutral-500">Next: {nextMovement}</p>
        )}
      </div>

      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Control
            label={view.paused ? 'Resume' : 'Pause'}
            command={view.paused ? 'resume' : 'pause'}
            pending={pending}
            onCommand={onCommand}
            primary
          />
          <Control
            label="Done"
            command="done"
            pending={pending}
            onCommand={onCommand}
            // Rather than hiding it: a control that appears and disappears under
            // your thumb mid-session is worse than one that is visibly inert.
            disabled={!view.canDone}
          />
          <Control label="+30 sec" command="add_30s" pending={pending} onCommand={onCommand} />
          <Control label="Skip" command="skip" pending={pending} onCommand={onCommand} />
        </div>

        <div className="flex items-center justify-between gap-3 rounded-xl border border-neutral-800 px-4 py-2">
          <span className="text-xs uppercase tracking-wide text-neutral-500">Cues</span>
          <div className="flex gap-1">
            {CUE_LEVELS.map((level) => (
              <button
                key={level}
                type="button"
                aria-pressed={level === cueLevel}
                onClick={() => onCueLevel(level)}
                className={`min-h-[2.25rem] rounded-lg px-3 text-sm ${
                  level === cueLevel
                    ? 'bg-neutral-100 text-neutral-900'
                    : 'text-neutral-400'
                }`}
              >
                {CUE_LEVEL_LABELS[level]}
              </button>
            ))}
          </div>
        </div>

        <button
          type="button"
          onClick={() => {
            if (confirmingEnd) {
              onCommand('end');
              setConfirmingEnd(false);
            } else {
              setConfirmingEnd(true);
            }
          }}
          className={`min-h-[3rem] w-full rounded-xl border text-sm font-medium ${
            confirmingEnd
              ? 'border-red-500 bg-red-950/50 text-red-200'
              : 'border-neutral-800 text-neutral-500'
          }`}
        >
          {confirmingEnd ? 'Tap again to end the session' : 'End session'}
        </button>
      </div>
    </div>
  );
}

function Control({
  label,
  command,
  pending,
  onCommand,
  disabled = false,
  primary = false,
}: {
  label: string;
  command: StageCommand;
  pending: StageCommand | null;
  onCommand: (command: StageCommand) => void;
  disabled?: boolean;
  primary?: boolean;
}) {
  const sending = pending === command;
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onCommand(command)}
      className={`min-h-[4rem] rounded-xl text-base font-semibold transition-opacity disabled:opacity-30 ${
        primary
          ? 'bg-neutral-100 text-neutral-900'
          : 'border border-neutral-700 bg-neutral-900 text-neutral-100'
      }`}
    >
      {sending ? 'Sent' : label}
    </button>
  );
}
