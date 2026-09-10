'use client';

/**
 * The wait.
 *
 * Spec §7 puts the breath pacer on the television and calls the wait a feature —
 * "the session is being made for you." The phone's job during that is narrower
 * and mostly negative: don't imply anything is broken, don't invite a second
 * press, and don't pretend to know how long is left.
 *
 * So it counts up rather than down. A progress bar would be a fabrication —
 * nothing reports progress — and a countdown that overran would be worse than no
 * estimate at all.
 */

import { useEffect, useState } from 'react';
import { GENERATION_SLOW_AFTER_MS } from '@/lib/console/vocab';
import { formatClock } from '@/lib/console/mirror';
import { QuietButton } from './controls';

export default function Generating({
  startedAt,
  paired,
  onCancel,
}: {
  startedAt: number;
  paired: boolean;
  onCancel: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const elapsedMs = Math.max(0, now - startedAt);
  const slow = elapsedMs > GENERATION_SLOW_AFTER_MS;

  return (
    <div className="space-y-8 py-10 text-center">
      <div className="space-y-3">
        <h1 className="text-2xl font-semibold text-neutral-100">Building your session</h1>
        <p className="text-neutral-400">
          {paired ? 'Breathe with the television.' : 'This takes about two minutes.'}
        </p>
      </div>

      <div className="text-5xl font-semibold tabular-nums text-neutral-200">
        {formatClock(elapsedMs / 1000)}
      </div>

      {slow && (
        <p className="text-sm text-neutral-500">
          Still working. Longer sessions take longer to design.
        </p>
      )}

      <p className="text-xs text-neutral-500">
        You can close this. The session finishes on its own and will be here when
        you come back.
      </p>

      <QuietButton onClick={onCancel}>Stop waiting</QuietButton>
    </div>
  );
}
