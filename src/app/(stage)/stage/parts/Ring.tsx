import { SIDE_FLASH_MS } from '@/lib/stage/vocab';

/**
 * The countdown ring, with the side badge beside it.
 *
 * Spec §3 says animate `transform` and `opacity` only. A ring sweep is
 * inherently a stroke animation, so this is the one knowing bend: the
 * `stroke-dashoffset` is STEPPED at the render tick with no CSS transition on
 * it, on a single small path. A transition here would fight the clock and
 * stutter on weak hardware. If the real set struggles, the fallback is dropping
 * the ring and keeping the numerals — same component, one branch.
 */

const SIZE = 44;
const RADIUS = 19;
const STROKE = 2.5;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export default function Ring({
  seconds,
  total,
  urgent,
  repsTarget,
  side,
  switching,
}: {
  seconds: number;
  total: number;
  urgent: boolean;
  /** When set, reps are the focal number and the timer is the soft cap. */
  repsTarget: number | null;
  side: 'left' | 'right' | null;
  switching: boolean;
}) {
  const fraction = total > 0 ? Math.max(0, Math.min(1, seconds / total)) : 0;
  const dashOffset = CIRCUMFERENCE * (1 - fraction);

  return (
    <div className="countdown">
      <svg className="countdown__ring" viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden="true">
        <circle
          className="countdown__track"
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          strokeWidth={STROKE}
        />
        <circle
          className={urgent ? 'countdown__sweep countdown__sweep--urgent' : 'countdown__sweep'}
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          strokeWidth={STROKE}
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={dashOffset}
        />
      </svg>

      {repsTarget === null ? (
        <div className={urgent ? 'countdown__value countdown__value--urgent' : 'countdown__value'}>
          {seconds}
        </div>
      ) : (
        <div className="countdown__value">
          {repsTarget}
          <span
            style={{ display: 'block', fontSize: '0.28em', opacity: 0.5, textAlign: 'center' }}
          >
            reps · {seconds}s
          </span>
        </div>
      )}

      {side ? <div className="side-badge">{side === 'left' ? 'L' : 'R'}</div> : null}

      {/* The switch "chime", which is visual — audio is backlog and TV audio
          autoplay is a separate unlock from video. Opacity only. */}
      {switching ? (
        <div className="side-flash side-flash--on" style={{ animationDuration: `${SIDE_FLASH_MS}ms` }} />
      ) : null}
    </div>
  );
}
