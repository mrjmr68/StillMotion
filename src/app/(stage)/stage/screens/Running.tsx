import type { BundleResponse, CueLevel } from '@/lib/stage/contract';
import { nextMovementPhase, progressAt, type Phase } from '@/lib/stage/timeline';
import { CUE_ROTATE_SECONDS, FINAL_SECONDS } from '@/lib/stage/vocab';
import CueLayer from '../parts/CueLayer';
import Figure from '../parts/Figure';
import Ring from '../parts/Ring';

/**
 * The running screen — work, rest, transitions and side switches.
 *
 * One component rather than four, because spec §8's layout is the same in every
 * phase: the same figure box, the same ring, the same cue line, the same next
 * strip. What changes is what fills them. Four near-identical components would
 * be four places for the ten-foot layout to drift apart.
 */
export default function Running({
  bundle,
  timeline,
  phase,
  secondsRemaining,
  paused,
  cueLevel,
}: {
  bundle: BundleResponse;
  timeline: Phase[];
  phase: Phase;
  secondsRemaining: number;
  paused: boolean;
  cueLevel: CueLevel;
}) {
  const plan = bundle.plan;
  const block = plan.blocks[phase.blockIndex];
  const resting = phase.kind === 'rest' || phase.kind === 'transition';

  /*
   * Spec §8: rest screens show the NEXT movement's loop, already playing, with
   * that movement's setup note — "you learn what's coming while you recover
   * from what's done. This is free instruction time, and V1 wasted it."
   */
  const upcoming = nextMovementPhase(timeline, phase.index);
  const shownId = resting && upcoming ? upcoming.exerciseId : phase.exerciseId;
  const movement = bundle.movements[shownId];

  /*
   * During a rest the big name IS the next movement, so the strip has to look
   * one further ahead — otherwise it names the same thing twice and reads as a
   * bug from ten feet. During work it names the upcoming movement as usual.
   */
  const stripPhase =
    resting && upcoming ? nextMovementPhase(timeline, upcoming.index) : upcoming;
  const nextMovement = stripPhase ? bundle.movements[stripPhase.exerciseId] : null;

  const urgent = secondsRemaining <= FINAL_SECONDS;
  const progress = progressAt(timeline, phase.index);

  // Which cue to hold. At level `full` they rotate; at `key` the first cue is
  // the single most important thing and it holds for the whole item.
  const elapsed = phase.seconds - secondsRemaining;
  const cueIndex =
    movement && movement.cues.length > 0
      ? Math.floor(elapsed / CUE_ROTATE_SECONDS) % movement.cues.length
      : 0;

  const roundLabel = block && block.rounds > 1 ? ` · round ${phase.round} of ${block.rounds}` : '';

  return (
    <div className="stage">
      <div className="progress">
        <div className="progress__fill" style={{ transform: `scaleX(${progress})` }} />
      </div>

      <div className="stage__main">
        <div className="block-label">
          {resting ? 'Rest — coming up' : block ? block.label + roundLabel : ''}
          {paused ? ' · paused' : ''}
        </div>

        <Figure movement={movement} />

        <h1 className="movement-name">{movement ? movement.name : shownId}</h1>

        <Ring
          seconds={secondsRemaining}
          total={phase.seconds}
          urgent={urgent}
          // A reps item shows the target reps as the focal number and the timer
          // as a soft cap beneath it — you finish early and tap Done, or it
          // advances at the cap. You are never stranded waiting for permission.
          repsTarget={phase.kind === 'work' && phase.softCap ? phase.dose : null}
          side={phase.kind === 'work' && phase.side !== 'both' ? phase.side : null}
          switching={phase.kind === 'side_switch'}
        />
      </div>

      <div className="stage__foot">
        {resting && movement && movement.setup_note ? (
          <div className="setup-note">{movement.setup_note}</div>
        ) : (
          <CueLayer
            cues={movement ? movement.cues : []}
            level={cueLevel}
            index={cueIndex}
          />
        )}

        <div className="next-strip">
          {nextMovement ? `Next: ${nextMovement.name}` : 'Last one'}
        </div>
      </div>
    </div>
  );
}
