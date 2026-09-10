import type { StageScreen } from '@/lib/stage/contract';
import type { RunState } from '@/lib/stage/machine';
import type { Phase } from '@/lib/stage/timeline';

/**
 * The on-screen debug readout.
 *
 * This is the ONLY debugger the television has — spec §3 says there are no
 * reliable devtools — so it is deliberately available on the real device via
 * `?debug=1`, not just in `?sim=tv`. If something goes wrong on the couch, this
 * is what you will be reading.
 */
export default function DebugHud({
  screen,
  phase,
  state,
  offline,
  failures,
  note,
  sim,
}: {
  screen: StageScreen;
  phase: Phase | null;
  state: RunState | null;
  offline: boolean;
  failures: number;
  note: string | null;
  sim: boolean;
}) {
  return (
    <div className="hud">
      screen {screen}
      {sim ? ' · sim' : ''}
      {offline ? ` · OFFLINE (${failures} fails)` : ''}
      <br />
      {phase
        ? `phase ${phase.index} ${phase.kind}/${phase.side} · block ${phase.blockIndex} item ${phase.itemIndex} · ${phase.seconds}s`
        : 'no phase'}
      <br />
      {state
        ? `paused ${state.pausedAt !== null} · added ${state.addedMs}ms · skipped [${state.skipped.join(',')}] · cmd ${state.lastCommandId ? state.lastCommandId.slice(0, 8) : '-'}`
        : 'no run state'}
      {note ? (
        <>
          <br />
          {note}
        </>
      ) : null}
    </div>
  );
}
