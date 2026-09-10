/**
 * The stage — hardware probe.
 *
 * This is deliberately STATIC: no state, no polling, no client component. Its
 * only job is to answer four questions on the actual television before any
 * runtime code is written:
 *
 *   1. Does it boot at all? (React 19 + Next 16 on a several-years-old engine
 *      is not a given, and Next's compile target is global rather than
 *      per-route, so this is the cheapest possible probe.)
 *   2. Is the exercise name readable from the couch?
 *   3. Is the cue line readable? 2.6vmin is the ten-foot-UI floor and the
 *      likeliest thing to be wrong.
 *   4. Is anything cut off by overscan?
 *
 * Every element of spec §8's layout is here at its real size and colour, with
 * placeholder content: progress bar, block label, figure box, very large name,
 * countdown ring mid-sweep, side badge, cue line, "Next:" strip.
 *
 * The runtime replaces the content, not the layout.
 */

import { FINAL_SECONDS } from '@/lib/stage/vocab';

/** Ring geometry. Kept here so the probe needs no client JS at all. */
const RING = { size: 44, radius: 19, stroke: 2.5 };
const CIRCUMFERENCE = 2 * Math.PI * RING.radius;

/** A mid-sweep value, so the ring is visibly a ring rather than a circle. */
const FRACTION_REMAINING = 0.62;
const SECONDS_SHOWN = 24;

export default function StageProbePage() {
  const urgent = SECONDS_SHOWN <= FINAL_SECONDS;
  const dashOffset = CIRCUMFERENCE * (1 - FRACTION_REMAINING);

  return (
    <div className="stage">
      <div className="progress">
        <div className="progress__fill" style={{ transform: 'scaleX(0.38)' }} />
      </div>

      <div className="stage__main">
        <div className="block-label">Strength circuit · round 2 of 3</div>

        <div className="figure">
          {/* No artwork exists at Tier 0. The placeholder reserves the exact box
              the real figure will occupy, so the type scale tuned at ten feet
              today still holds the day art lands. */}
          <div className="figure__placeholder">
            <span>standing</span>
          </div>
        </div>

        <h1 className="movement-name">Single-Leg Romanian Deadlift</h1>

        <div className="countdown">
          <svg
            className="countdown__ring"
            viewBox={`0 0 ${RING.size} ${RING.size}`}
            aria-hidden="true"
          >
            <circle
              className="countdown__track"
              cx={RING.size / 2}
              cy={RING.size / 2}
              r={RING.radius}
              strokeWidth={RING.stroke}
            />
            <circle
              className={
                urgent ? 'countdown__sweep countdown__sweep--urgent' : 'countdown__sweep'
              }
              cx={RING.size / 2}
              cy={RING.size / 2}
              r={RING.radius}
              strokeWidth={RING.stroke}
              strokeDasharray={CIRCUMFERENCE}
              strokeDashoffset={dashOffset}
            />
          </svg>
          <div className={urgent ? 'countdown__value countdown__value--urgent' : 'countdown__value'}>
            {SECONDS_SHOWN}
          </div>
          {/* Beside the ring, not below it — it costs no vertical budget there. */}
          <div className="side-badge">L</div>
        </div>
      </div>

      <div className="stage__foot">
        <div className="cues">
          <div className="cue">Reach the back heel to the wall.</div>
        </div>
        <div className="next-strip">Next: Kettlebell Bent-Over Row</div>
      </div>

      {/* Present on the real TV too, not only in sim — §3 says there are no
          reliable devtools, so an on-screen readout is the only debugger. */}
      <div className="hud">
        probe · static · no runtime
        <br />
        if you can read the cue line above from the couch, 2.6vmin holds
      </div>
    </div>
  );
}
