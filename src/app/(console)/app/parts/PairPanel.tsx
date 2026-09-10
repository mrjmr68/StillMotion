'use client';

/**
 * Connecting the television.
 *
 * The TV shows a four-digit code; the phone claims it. That direction is the
 * whole design — spec §3's "you never type on the TV" — and it is why the code
 * is short enough to read from a sofa and short-lived enough that shortness
 * doesn't matter. The real credential is the token the television already holds;
 * this code only decides whose account it belongs to.
 *
 * Claimed pairings do not expire. `expires_at` gates the unclaimed code alone,
 * so a bookmarked television stays paired rather than dropping off fifteen
 * minutes after you set it up.
 */

import { useState } from 'react';
import { PrimaryButton } from './controls';

export default function PairPanel({
  paired,
  onClaim,
  onRevoke,
  onDismiss,
}: {
  paired: boolean;
  onClaim: (code: string) => Promise<string | null>;
  onRevoke: () => Promise<void>;
  onDismiss: () => void;
}) {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    const failure = await onClaim(code);
    setBusy(false);
    if (failure) {
      setError(failure);
      setCode('');
      return;
    }
    setCode('');
  };

  return (
    <div className="space-y-6 rounded-xl border border-neutral-800 p-5">
      <div className="space-y-1">
        <h2 className="font-medium text-neutral-100">
          {paired ? 'Connect a different television' : 'Connect your television'}
        </h2>
        <p className="text-sm text-neutral-400">
          Open the stage on the TV and type the four digits it shows.
        </p>
      </div>

      <input
        value={code}
        onChange={(event) => setCode(event.target.value.replace(/[^0-9]/g, '').slice(0, 4))}
        // inputMode + pattern is what raises the numeric keypad. `type=number`
        // would too, but it also brings a spinner and drops leading zeros — and
        // a fifth of all codes here start with one.
        inputMode="numeric"
        pattern="[0-9]*"
        autoComplete="off"
        placeholder="0000"
        aria-label="Pairing code"
        className="w-full rounded-xl border border-neutral-700 bg-neutral-900 py-4 text-center text-4xl font-semibold tracking-[0.4em] text-neutral-100 placeholder:text-neutral-700 focus:border-neutral-400 focus:outline-none"
      />

      {error && <p className="text-sm text-red-400">{error}</p>}

      <div className="space-y-3">
        <PrimaryButton onClick={submit} disabled={code.length !== 4 || busy}>
          {busy ? 'Connecting…' : 'Connect'}
        </PrimaryButton>

        {/*
          Forgetting the TV is the only way to make it show a code again — it
          only asks for one in response to a 401. Without this, a set paired to
          the wrong account needs database access to move.
        */}
        {paired && (
          <button
            type="button"
            onClick={() => {
              setBusy(true);
              void onRevoke().finally(() => setBusy(false));
            }}
            disabled={busy}
            className="min-h-[2.75rem] w-full text-sm text-neutral-500 disabled:opacity-40"
          >
            Forget the connected television
          </button>
        )}
        <button
          type="button"
          onClick={onDismiss}
          className="min-h-[2.75rem] w-full text-sm text-neutral-500"
        >
          Not now
        </button>
      </div>
    </div>
  );
}
