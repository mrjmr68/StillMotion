'use client';

/**
 * The stage's only stateful component.
 *
 * Everything else is a pure function of props. Spec §3 says the page must stay
 * "simple enough to debug by eye" on a device with no devtools — one place
 * where state can be wrong is what makes that true.
 *
 * Two loops, deliberately independent:
 *   - the RENDER tick (200ms) re-reads the clock. It never touches the network.
 *   - the SYNC loop (750ms) talks to the server. The timer never awaits it, so
 *     spec §4's "if the network drops, the workout keeps running" holds by
 *     construction rather than by effort.
 *
 * Anything that drives rendering is state. Refs here hold only what the async
 * callbacks need in order to avoid a stale closure — reading a ref during render
 * can silently show yesterday's value, which on a screen with no devtools would
 * be a miserable bug to chase.
 */

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type {
  BundleResponse,
  CueLevel,
  DeliveredCommand,
  PerformedItem,
  StageScreen,
  SyncRequest,
  SyncResponse,
} from '@/lib/stage/contract';
import { STAGE_TOKEN_HEADER } from '@/lib/stage/contract';
import {
  applySimMasks,
  now,
  playChime,
  readFlags,
  unlockMedia,
  type StageFlags,
} from '@/lib/stage/compat';
import { buildTimeline, type Phase } from '@/lib/stage/timeline';
import {
  advance,
  apply,
  currentPhase,
  initial,
  isPaused,
  remainingSeconds,
  type RunState,
} from '@/lib/stage/machine';
import { toCursor } from '@/lib/stage/cursor';
import { OFFLINE_AFTER_FAILURES, RENDER_MS, STATE_WRITE_EVERY, SYNC_MS } from '@/lib/stage/vocab';
import Centering from './screens/Centering';
import Complete from './screens/Complete';
import Pairing from './screens/Pairing';
import Running from './screens/Running';
import Shape from './screens/Shape';
import DebugHud from './parts/DebugHud';

const TOKEN_KEY = 'sm_stage_token';

/*
 * Query flags differ between the server render and the client, so they go
 * through useSyncExternalStore rather than a useState initialiser. Reading
 * `window` in an initialiser makes the server render a HUD-less tree and the
 * client render one WITH the HUD, which is a hydration mismatch — React then
 * throws away the server HTML, and on a television that is a visible flash on
 * every boot for no reason.
 *
 * The snapshot is cached because getSnapshot must return a stable reference or
 * React re-renders forever; the flags cannot change without a navigation.
 */
const SERVER_FLAGS: StageFlags = { sim: false, debug: false, screen: null };
let cachedFlags: StageFlags | null = null;

function subscribeToNothing(): () => void {
  return () => {};
}

function clientFlags(): StageFlags {
  if (!cachedFlags) cachedFlags = readFlags(window.location.search);
  return cachedFlags;
}

function serverFlags(): StageFlags {
  return SERVER_FLAGS;
}

/** localStorage is a fallback only — the HttpOnly cookie is the primary carrier. */
function readStoredToken(): string | null {
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

/**
 * What actually happened, for `plan_performed` and `exercise_logs`.
 *
 * One entry per work phase per side, which is exactly the grain of
 * `exercise_logs`' unique key `(session_id, block_index, item_index, side)` —
 * rounds are already flattened into distinct item indices, so nothing collides
 * and a retry upserts cleanly.
 */
function buildPerformed(timeline: Phase[], skipped: number[]): PerformedItem[] {
  const out: PerformedItem[] = [];
  for (const phase of timeline) {
    if (phase.kind !== 'work') continue;
    const wasSkipped = skipped.indexOf(phase.itemIndex) >= 0;
    out.push({
      block_index: phase.blockIndex,
      item_index: phase.itemIndex,
      side: phase.side === 'both' ? null : phase.side,
      exercise_id: phase.exerciseId,
      prescribed_dose: phase.dose,
      completed_dose: wasSkipped ? 0 : phase.dose,
      rest_seconds: 0,
      was_skipped: wasSkipped,
    });
  }
  return out;
}

function storeToken(token: string): void {
  try {
    window.localStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* a set that blocks storage still works — the cookie carries it */
  }
}

export default function StageRoot() {
  const flags = useSyncExternalStore(subscribeToNothing, clientFlags, serverFlags);

  const [screen, setScreen] = useState<StageScreen>('pairing');
  const [code, setCode] = useState<string | null>(null);
  const [bundle, setBundle] = useState<BundleResponse | null>(null);
  const [run, setRun] = useState<RunState | null>(null);
  const [cueLevel, setCueLevel] = useState<CueLevel>('key');
  const [failures, setFailures] = useState(0);
  const [note, setNote] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  // The timeline is a pure function of the plan, so derive it rather than
  // storing a second copy that could fall out of step.
  const timeline = useMemo(() => (bundle ? buildTimeline(bundle.plan) : []), [bundle]);

  // Callback-only refs: never read during render.
  const runRef = useRef<RunState | null>(null);
  const timelineRef = useRef(timeline);
  const tokenRef = useRef<string | null>(null);
  const beatRef = useRef(0);
  const ackRef = useRef<string | null>(null);
  const sessionRef = useRef<string | null>(null);
  const requestedCodeRef = useRef(false);
  const completedRef = useRef(false);

  useEffect(() => {
    timelineRef.current = timeline;
  }, [timeline]);

  const offline = failures >= OFFLINE_AFTER_FAILURES;

  /* ---------------- network ---------------- */

  const post = useCallback(async (path: string, body: unknown): Promise<Response> => {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (tokenRef.current) headers[STAGE_TOKEN_HEADER] = tokenRef.current;
    return fetch(path, { method: 'POST', headers, body: JSON.stringify(body) });
  }, []);

  /* ---------------- pairing ---------------- */

  // Adopt any stored token before the first sync, so a set that has been here
  // before authenticates immediately. Spec §3: "you bookmark one short URL once."
  // Declared before the code request and the sync loop, so the token is in
  // place before either of them runs — effects fire in declaration order.
  useEffect(() => {
    if (flags.sim) applySimMasks();
    const stored = readStoredToken();
    if (stored) tokenRef.current = stored;
  }, [flags.sim]);

  /*
   * Mint a pairing only when the server says it doesn't know us.
   *
   * The CODE itself now comes back on every sync, so the television never has
   * to remember it — a remount, a hot reload, or a set rebooting mid-pair used
   * to strand the screen on a placeholder with nothing to type. Pairing is
   * therefore driven by a 401, which is the one unambiguous "you have no
   * pairing" signal.
   */
  const requestPairing = useCallback(async () => {
    if (requestedCodeRef.current) return;
    requestedCodeRef.current = true;

    const response = await fetch('/api/stage/pair', { method: 'POST' });
    if (!response.ok) {
      requestedCodeRef.current = false;
      return;
    }
    const data = (await response.json()) as { code: string; stage_token: string };
    tokenRef.current = data.stage_token;
    storeToken(data.stage_token);
    setCode(data.code);
  }, []);

  /* ---------------- commands ---------------- */

  const handleCommand = useCallback(
    (command: DeliveredCommand) => {
      // Acknowledged on the NEXT sync, which is what clears it server-side.
      ackRef.current = command.id;

      if (command.name === 'begin') {
        if (sessionRef.current) void post('/api/stage/begin', { session_id: sessionRef.current });
        return;
      }

      const state = runRef.current;
      if (!state) return;

      const result = apply(state, timelineRef.current, command.name, now(), command.id);
      if (result.note) setNote(result.note);
      if (result.state !== state) {
        runRef.current = result.state;
        setRun(result.state);
      }
    },
    [post],
  );

  /* ---------------- the sync loop ---------------- */

  useEffect(() => {
    let stopped = false;

    async function beat() {
      if (stopped) return;

      const state = runRef.current;
      const phase = state ? currentPhase(state, timelineRef.current) : null;

      // Only every Nth beat carries a cursor: reads stay frequent so a command
      // is picked up promptly, writes stay rare per spec §4's ~2s.
      const isWriteBeat = beatRef.current % STATE_WRITE_EVERY === 0;
      beatRef.current += 1;

      const body: SyncRequest = {
        state:
          isWriteBeat && state && phase && sessionRef.current
            ? {
                session_id: sessionRef.current,
                ...toCursor(phase),
                seconds_remaining: remainingSeconds(state, now()),
                is_paused: isPaused(state),
              }
            : null,
        claimed_command_id: ackRef.current,
      };

      try {
        const response = await post('/api/stage/sync', body);

        // The server has no pairing for this token — get one. Not a failure
        // worth counting toward the offline indicator.
        if (response.status === 401) {
          void requestPairing();
          return;
        }
        if (!response.ok) throw new Error(String(response.status));
        const data = (await response.json()) as SyncResponse;

        ackRef.current = null;
        setFailures(0);
        setCueLevel(data.cue_level);
        setCode(data.code);
        if (data.session_id) sessionRef.current = data.session_id;
        setScreen(data.screen);
        if (data.command) handleCommand(data.command);
      } catch {
        setFailures((count) => count + 1);
      }
    }

    const id = window.setInterval(() => void beat(), SYNC_MS);
    void beat();
    return () => {
      stopped = true;
      window.clearInterval(id);
    };
  }, [post, handleCommand, requestPairing]);

  /* ---------------- the bundle, fetched once per session ---------------- */

  useEffect(() => {
    if (screen !== 'shape' && screen !== 'running') return;
    const sessionId = sessionRef.current;
    if (!sessionId) return;
    if (bundle && bundle.session.id === sessionId) return;

    let cancelled = false;

    async function load() {
      const headers: Record<string, string> = {};
      if (tokenRef.current) headers[STAGE_TOKEN_HEADER] = tokenRef.current;
      const response = await fetch(`/api/stage/bundle?session_id=${sessionId}`, { headers });
      if (!response.ok || cancelled) return;
      const data = (await response.json()) as BundleResponse;
      if (!cancelled) setBundle(data);
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [screen, bundle]);

  /* ---------------- start the clock when the session goes active -------- */

  useEffect(() => {
    if (screen !== 'running' || timeline.length === 0 || runRef.current) return;
    const started = initial(timeline, 0, now());
    runRef.current = started;
    setRun(started);
  }, [screen, timeline]);

  /* ---------------- the render tick ---------------- */

  useEffect(() => {
    const id = window.setInterval(() => {
      const state = runRef.current;
      if (state && !state.finished) {
        const next = advance(state, timelineRef.current, now());
        if (next !== state) {
          const before = currentPhase(state, timelineRef.current);
          const after = currentPhase(next, timelineRef.current);
          // A side switch is announced visually; the chime is backlogged.
          if (before && after && before.side !== after.side) playChime();
          runRef.current = next;
          setRun(next);
        }
      }
      // The clock is derived from wall time, so a bare counter is enough to
      // pull a fresh reading into the render.
      setTick((n) => n + 1);
    }, RENDER_MS);

    return () => window.clearInterval(id);
  }, []);

  /* ---------------- report the session as finished ---------------- */

  /*
   * The clock finishing is what ends a session — either it ran off the end of
   * the timeline or `end` was pressed. Reported once, guarded by a ref, because
   * the render tick would otherwise fire this every 200ms.
   */
  useEffect(() => {
    if (!run || !run.finished || completedRef.current) return;
    const sessionId = sessionRef.current;
    if (!sessionId) return;

    completedRef.current = true;
    const ranEverything = run.phaseIndex >= timeline.length - 1;
    void post('/api/stage/complete', {
      session_id: sessionId,
      outcome: ranEverything ? 'completed' : 'abandoned',
      performed: buildPerformed(timeline, run.skipped),
    });
  }, [run, timeline, post]);

  /* ---------------- the remote's OK button ---------------- */

  useEffect(() => {
    function onGesture() {
      // The first gesture, wherever it lands, is the media unlock — a
      // bookmarked TV never sees the Connect press spec §3 nominates.
      unlockMedia();
      if (screen === 'shape' && sessionRef.current) {
        void post('/api/stage/begin', { session_id: sessionRef.current });
      }
    }
    window.addEventListener('keydown', onGesture);
    window.addEventListener('click', onGesture);
    return () => {
      window.removeEventListener('keydown', onGesture);
      window.removeEventListener('click', onGesture);
    };
  }, [screen, post]);

  /* ---------------- render ---------------- */

  void tick; // the render tick's only job is to get us here again

  const shown = (flags.screen ? flags.screen : screen) as StageScreen;
  const phase = run ? currentPhase(run, timeline) : null;

  let body: React.ReactNode;
  if (shown === 'pairing') body = <Pairing code={code} />;
  else if (shown === 'shape') body = <Shape bundle={bundle} />;
  else if (shown === 'complete') body = <Complete bundle={bundle} />;
  else if (shown === 'running' && bundle && run && phase) {
    body = (
      <Running
        bundle={bundle}
        timeline={timeline}
        phase={phase}
        secondsRemaining={remainingSeconds(run, now())}
        paused={isPaused(run)}
        cueLevel={cueLevel}
      />
    );
  } else if (run && run.finished) body = <Complete bundle={bundle} />;
  else body = <Centering />;

  return (
    <>
      {body}
      {offline ? <div className="offline-dot" title="not reaching the server" /> : null}
      {flags.debug ? (
        <DebugHud
          screen={shown}
          phase={phase}
          state={run}
          offline={offline}
          failures={failures}
          note={note}
          sim={flags.sim}
        />
      ) : null}
    </>
  );
}
