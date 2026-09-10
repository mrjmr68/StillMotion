import { useEffect, useState } from 'react';
import { CENTERING_REASSURE_AFTER_SECONDS } from '@/lib/stage/vocab';

/**
 * Centering time (spec §7): "a slow breath pacer, dojo-quiet, no text but a
 * single word." The wait is doing work — don't fill it with a spinner.
 *
 * The pacer itself is a CSS keyframe on `transform` with a 40/60 split of a
 * ten-second cycle, which IS the 4-count-in / 6-count-out ratio. No JS, no
 * timer, nothing for a weak GPU to struggle with.
 *
 * The reassurance line exists because generation measures ~2 minutes, not the
 * 20-30s the spec assumed — twelve breath cycles of silence reads as hung.
 */
export default function Centering() {
  const [waited, setWaited] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => setWaited((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div className="centering">
      <div className="pacer" />
      <div className="centering__word">Breathe</div>
      {waited > CENTERING_REASSURE_AFTER_SECONDS ? (
        <div className="centering__reassure">still working</div>
      ) : null}
    </div>
  );
}
