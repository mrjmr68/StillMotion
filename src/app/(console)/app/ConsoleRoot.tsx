'use client';

/**
 * The console.
 *
 * One stateful component, the same shape as `StageRoot` on the television side:
 * everything that polls, commands or decides lives here, and the screens are
 * pure functions of what it holds.
 *
 * Two rules shape all of it.
 *
 * The database is the source of truth, not this component. Which screen you are
 * on is derived from `sessions.status` — not from what you last tapped — so a
 * reload, a locked phone, or a television that ran the session to its end all
 * land you exactly where you actually are. There is no local "I pressed Begin"
 * flag to get out of step.
 *
 * The reads come straight from Supabase under the phone's own RLS, while the
 * writes go through route handlers. That asymmetry is deliberate: the phone can
 * legitimately read its own rows, so a server hop for the 750ms mirror poll
 * would be latency for nothing — but every write here has to touch a row the
 * user cannot write directly (a pairing they do not own yet, a live-state row
 * with no update policy), which is exactly what `service_role` is for.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createClient } from '@/lib/supabase/client';
import {
  DEFAULT_CHECKIN,
  type CheckinRequest,
  type StickyCheckin,
} from '@/lib/console/checkin';
import { mirrorView, tickedSeconds, type LiveCursor } from '@/lib/console/mirror';
import { GENERATION_TIMEOUT_MS, MIRROR_MS, STATUS_MS, TICK_MS } from '@/lib/console/vocab';
import type { SessionPlan } from '@/lib/planner/schema';
import { buildTimeline } from '@/lib/stage/timeline';
import type { CueLevel } from '@/lib/stage/contract';
import type { StageCommand } from '@/lib/stage/machine';
import { signOut } from './actions';
import CheckInForm from './parts/CheckInForm';
import Feedback, { type Rating } from './parts/Feedback';
import Generating from './parts/Generating';
import PairPanel from './parts/PairPanel';
import Remote from './parts/Remote';
import ShapeCard from './parts/ShapeCard';

export type ConsoleSession = {
  id: string;
  status: string;
  plan: SessionPlan;
  requested_duration_min: number;
};

export type ConsoleBoot = {
  paired: boolean;
  sticky: StickyCheckin | null;
  /** The check-in from the most recent session, so "same again" is the default. */
  lastCheckin: CheckinRequest | null;
  session: ConsoleSession | null;
  /** A finished session that was never rated — usually the phone was put down. */
  feedback: { id: string; outcome: string; minutes: number } | null;
  cueLevel: CueLevel;
  names: Record<string, string>;
};

function asCueLevel(value: unknown): CueLevel {
  return value === 'off' || value === 'key' || value === 'full' ? value : 'key';
}

const LIVE_COLUMNS =
  'phase_index, phase, current_block_index, current_item_index, side, seconds_remaining, is_paused, cue_level';

export default function ConsoleRoot({ boot }: { boot: ConsoleBoot }) {
  const [supabase] = useState(() => createClient());

  const [session, setSession] = useState<ConsoleSession | null>(boot.session);
  const [feedback, setFeedback] = useState(boot.feedback);
  const [generatingAt, setGeneratingAt] = useState<number | null>(null);
  const [paired, setPaired] = useState(boot.paired);
  const [showPairing, setShowPairing] = useState(false);
  const [cueLevel, setCueLevel] = useState<CueLevel>(boot.cueLevel);

  /*
   * The last cursor read, stamped with the session it belongs to.
   *
   * Carrying the session id rather than clearing the cursor when the session
   * changes is what keeps this out of an effect: a stale row simply stops
   * matching and is ignored. Clearing it on transition would mean a setState in
   * an effect body, and a beat where a new session renders against the old
   * session's phase.
   */
  const [live, setLive] = useState<{
    sessionId: string;
    row: LiveCursor;
    readAt: number;
  } | null>(null);
  const [connected, setConnected] = useState(true);
  const [now, setNow] = useState(() => Date.now());

  const [pendingCommand, setPendingCommand] = useState<StageCommand | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Primitive deps, so the polling effects do not restart every time a status
  // read hands back an equal-but-new object.
  const sessionId = session ? session.id : null;
  const sessionStatus = session ? session.status : null;

  /*
   * Read the session back rather than trusting what an action returned.
   *
   * Every transition this console cares about — planned to active, active to
   * complete — is made by the TELEVISION, not by this screen. So the only
   * reliable way to know where we are is to ask the row.
   */
  const refreshSession = useCallback(
    async (trackedId: string | null) => {
      if (trackedId) {
        const { data } = await supabase
          .from('sessions')
          .select('id, status, plan_generated, requested_duration_min')
          .eq('id', trackedId)
          .maybeSingle();

        if (!data) {
          setSession(null);
          return;
        }
        if (data.status === 'planned' || data.status === 'active') {
          // The wait ends when a session exists, not when the fetch resolves —
          // the fetch may never resolve if the phone slept through it.
          setGeneratingAt(null);
          setSession((previous) =>
            previous && previous.id === data.id && previous.status === data.status
              ? previous
              : {
                  id: data.id,
                  status: data.status,
                  plan: data.plan_generated as unknown as SessionPlan,
                  requested_duration_min: data.requested_duration_min,
                },
          );
          return;
        }

        // It finished on the television. Hold onto it so there is something to
        // rate — this is the only moment the id is still in hand.
        setSession(null);
        setFeedback({
          id: data.id,
          outcome: data.status,
          minutes: data.requested_duration_min,
        });
        return;
      }

      const { data } = await supabase
        .from('sessions')
        .select('id, status, plan_generated, requested_duration_min')
        .in('status', ['planned', 'active'])
        .order('created_at', { ascending: false })
        .limit(5);

      const rows = data ?? [];
      // Active beats planned, matching `currentSessionFor` on the stage side —
      // if the two disagreed, the phone and the TV would be running different
      // sessions with no way to tell.
      const chosen = rows.find((row) => row.status === 'active') ?? rows[0];
      if (!chosen) return;

      setGeneratingAt(null);
      setSession({
        id: chosen.id,
        status: chosen.status,
        plan: chosen.plan_generated as unknown as SessionPlan,
        requested_duration_min: chosen.requested_duration_min,
      });
    },
    [supabase],
  );

  /* ---- status poll ------------------------------------------------- */

  // Written in an effect rather than during render: a ref assigned while
  // rendering is the exact pattern that bit the stage, and the poll only ever
  // reads it from a callback.
  const trackedRef = useRef<string | null>(sessionId);
  useEffect(() => {
    trackedRef.current = sessionId;
  }, [sessionId]);

  useEffect(() => {
    const timer = setInterval(() => {
      void refreshSession(trackedRef.current);
    }, STATUS_MS);
    return () => clearInterval(timer);
  }, [refreshSession]);

  /* ---- mirror poll, only while something is running ----------------- */

  useEffect(() => {
    if (!sessionId || sessionStatus !== 'active') return;

    let cancelled = false;
    const read = async () => {
      const { data, error: readError } = await supabase
        .from('session_live_state')
        .select(LIVE_COLUMNS)
        .eq('session_id', sessionId)
        .maybeSingle();

      if (cancelled) return;
      if (readError || !data) {
        setConnected(false);
        return;
      }
      setConnected(true);
      setLive({ sessionId, row: data as LiveCursor, readAt: Date.now() });
      setCueLevel(asCueLevel((data as { cue_level?: unknown }).cue_level));
    };

    void read();
    const timer = setInterval(() => void read(), MIRROR_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [sessionId, sessionStatus, supabase]);

  useEffect(() => {
    if (sessionStatus !== 'active') return;
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, [sessionStatus]);

  /* ---- actions ----------------------------------------------------- */

  const post = useCallback(async (url: string, body: unknown, timeoutMs?: number) => {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined,
    });
    const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    return { ok: response.ok, data };
  }, []);

  const generate = useCallback(
    async (checkin: CheckinRequest) => {
      setError(null);
      setGeneratingAt(Date.now());
      try {
        const { ok, data } = await post('/api/console/generate', checkin, GENERATION_TIMEOUT_MS);
        if (!ok) {
          setError(typeof data.detail === 'string' ? data.detail : 'Could not build a session.');
          setGeneratingAt(null);
          return;
        }
        await refreshSession(typeof data.session_id === 'string' ? data.session_id : null);
      } catch {
        /*
         * The request died — a slept phone, a dropped connection, a browser that
         * gave up on a two-minute fetch. The session may well be landing anyway,
         * so keep waiting and let the status poll find it. This is the path that
         * makes "closing the phone orphans nothing" true rather than aspirational.
         */
        setError('Lost the connection. Still watching for the session.');
      }
    },
    [post, refreshSession],
  );

  const begin = useCallback(async () => {
    if (!sessionId) return;
    setBusy(true);
    // The phone does not start the session; it asks the TV to, and the TV calls
    // /api/stage/begin. Anything else would let the clock start on a screen
    // nobody is looking at.
    await post('/api/console/command', { session_id: sessionId, command: 'begin' });
    setBusy(false);
  }, [post, sessionId]);

  const discard = useCallback(async () => {
    if (!sessionId) return;
    setBusy(true);
    await supabase.from('sessions').delete().eq('id', sessionId);
    setSession(null);
    setBusy(false);
  }, [sessionId, supabase]);

  const sendCommand = useCallback(
    async (command: StageCommand) => {
      if (!sessionId) return;
      setPendingCommand(command);
      await post('/api/console/command', { session_id: sessionId, command });
      setTimeout(() => setPendingCommand(null), 700);
    },
    [post, sessionId],
  );

  const changeCueLevel = useCallback(
    async (level: CueLevel) => {
      // Optimistic: this is a display setting on another screen, and waiting for
      // a round trip to light the button up makes the control feel broken.
      setCueLevel(level);
      if (!sessionId) return;
      await post('/api/console/command', { session_id: sessionId, cue_level: level });
    },
    [post, sessionId],
  );

  const claim = useCallback(
    async (code: string): Promise<string | null> => {
      const { ok, data } = await post('/api/console/pair/claim', { code });
      if (!ok) {
        return data.error === 'code_not_found_or_expired'
          ? 'That code has expired or was already used. Check the TV for a new one.'
          : 'Could not connect. Try again.';
      }
      setPaired(true);
      setShowPairing(false);
      return null;
    },
    [post],
  );

  const revokePairing = useCallback(async () => {
    await post('/api/console/pair/revoke', {});
    setPaired(false);
  }, [post]);

  const saveFeedback = useCallback(
    async (rating: Rating | null, note: string) => {
      if (!feedback) return;
      setBusy(true);
      await supabase
        .from('sessions')
        .update({ rating, note: note === '' ? null : note })
        .eq('id', feedback.id);
      setBusy(false);
      setFeedback(null);
    },
    [feedback, supabase],
  );

  /* ---- render ------------------------------------------------------ */

  // A cursor is only ever read against the session it was written for.
  const matched = live !== null && live.sessionId === sessionId ? live : null;

  const timeline = useMemo(() => (session ? buildTimeline(session.plan) : []), [session]);
  const view = useMemo(
    () => (session ? mirrorView(session.plan, timeline, matched ? matched.row : null) : null),
    [session, timeline, matched],
  );

  const initialCheckin: CheckinRequest = boot.lastCheckin
    ? boot.lastCheckin
    : { ...DEFAULT_CHECKIN, ...(boot.sticky ?? {}) };

  let body: ReactNode;

  if (feedback) {
    body = (
      <Feedback
        minutes={feedback.minutes}
        outcome={feedback.outcome}
        busy={busy}
        onSave={saveFeedback}
        onSkip={() => setFeedback(null)}
      />
    );
  } else if (generatingAt !== null) {
    body = (
      <Generating
        startedAt={generatingAt}
        paired={paired}
        onCancel={() => setGeneratingAt(null)}
      />
    );
  } else if (session && session.status === 'active' && view) {
    body = (
      <Remote
        view={view}
        seconds={tickedSeconds(view, matched ? now - matched.readAt : 0)}
        names={boot.names}
        cueLevel={cueLevel}
        connected={connected}
        pending={pendingCommand}
        onCommand={sendCommand}
        onCueLevel={changeCueLevel}
      />
    );
  } else if (session && session.status === 'planned') {
    body = (
      <ShapeCard
        plan={session.plan}
        names={boot.names}
        paired={paired}
        busy={busy}
        onBegin={begin}
        onDiscard={discard}
      />
    );
  } else {
    body = (
      <CheckInForm initial={initialCheckin} onGenerate={generate} error={error} />
    );
  }

  const running = session !== null && session.status === 'active';

  return (
    <main className="mx-auto min-h-screen w-full max-w-md bg-neutral-950 px-4 pb-16 pt-4">
      {/* The header is hidden mid-session. Nothing on it is useful while you are
          moving, and Sign out next to Pause is a trap. */}
      {!running && (
        <header className="mb-6 flex items-center justify-between gap-3 text-xs">
          <button
            type="button"
            onClick={() => setShowPairing((was) => !was)}
            className="flex items-center gap-2 text-neutral-400"
          >
            <span
              className={`inline-block h-2 w-2 rounded-full ${
                paired ? 'bg-emerald-500' : 'bg-neutral-600'
              }`}
            />
            {paired ? 'TV connected' : 'Connect TV'}
          </button>

          <form action={signOut}>
            <button type="submit" className="text-neutral-600">
              Sign out
            </button>
          </form>
        </header>
      )}

      {showPairing && !running && (
        <div className="mb-6">
          <PairPanel
            paired={paired}
            onClaim={claim}
            onRevoke={revokePairing}
            onDismiss={() => setShowPairing(false)}
          />
        </div>
      )}

      {body}
    </main>
  );
}
