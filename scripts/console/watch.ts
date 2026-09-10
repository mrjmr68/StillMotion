/**
 * console:watch — watch the handshake between the phone and the television.
 *
 * `next start` logs almost nothing, so during a real run on the real TV there is
 * no request log to read. This watches the only thing that matters anyway: the
 * rows the two screens talk through.
 *
 * It is deliberately quiet. Printing the cursor every 750ms tells you nothing you
 * cannot see by looking at the television; what you cannot see is a command that
 * was written and never collected. So it reports transitions and, above all,
 * STUCK commands — the signature of the phone writing somewhere the TV is not
 * reading, which is exactly the bug that made Begin do nothing.
 *
 *   npm run console:watch
 */

import { serviceClient } from '../../src/lib/supabase/service';

const POLL_MS = 1000;
/** How long a command may sit unclaimed before it counts as a failure. */
const STUCK_AFTER_MS = 3000;

type Snapshot = {
  sessionId: string | null;
  status: string | null;
  liveExists: boolean;
  pending: string | null;
  pendingId: string | null;
  phaseIndex: number | null;
  phase: string | null;
};

function stamp(): string {
  return new Date().toISOString().slice(11, 19);
}

function say(line: string): void {
  // One line per event, flushed immediately — this is an event stream, not a log.
  process.stdout.write(`${stamp()} ${line}\n`);
}

async function read(): Promise<Snapshot> {
  const db = serviceClient();

  const { data: session } = await db
    .from('sessions')
    .select('id, status')
    .in('status', ['planned', 'active'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!session) {
    return {
      sessionId: null,
      status: null,
      liveExists: false,
      pending: null,
      pendingId: null,
      phaseIndex: null,
      phase: null,
    };
  }

  const { data: live } = await db
    .from('session_live_state')
    .select('pending_command, pending_command_payload, phase_index, phase')
    .eq('session_id', session.id)
    .maybeSingle();

  const payload = live ? (live.pending_command_payload as { id?: string } | null) : null;

  return {
    sessionId: session.id,
    status: session.status,
    liveExists: live !== null,
    pending: live ? live.pending_command : null,
    pendingId: payload && typeof payload.id === 'string' ? payload.id : null,
    phaseIndex: live ? live.phase_index : null,
    phase: live ? live.phase : null,
  };
}

async function main() {
  say('watching sessions and session_live_state · ctrl-c to stop');

  let previous: Snapshot | null = null;
  let pendingSince = 0;
  let warnedStuck = false;

  for (;;) {
    let now: Snapshot;
    try {
      now = await read();
    } catch (error) {
      say(`READ FAILED ${error instanceof Error ? error.message : String(error)}`);
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      continue;
    }

    if (!previous || previous.sessionId !== now.sessionId) {
      say(
        now.sessionId
          ? `session ${now.sessionId.slice(0, 8)} is ${now.status}`
          : 'no open session',
      );
    } else if (previous.status !== now.status) {
      say(`status ${previous.status} -> ${now.status}`);
    }

    if (previous && previous.liveExists !== now.liveExists) {
      say(now.liveExists ? 'live state row created' : 'live state row gone');
    }

    // A command appearing, and then being collected, is the handshake working.
    if (now.pendingId !== null && now.pendingId !== (previous ? previous.pendingId : null)) {
      say(`queued ${now.pending} (${now.pendingId.slice(0, 8)})`);
      pendingSince = Date.now();
      warnedStuck = false;
    }

    if (now.pendingId === null && previous && previous.pendingId !== null) {
      const took = pendingSince > 0 ? Date.now() - pendingSince : 0;
      say(`claimed ${previous.pending} after ${took}ms`);
      pendingSince = 0;
      warnedStuck = false;
    }

    /*
     * The detector that earns this script's existence. A command still sitting
     * here after three seconds has not been collected, and the TV polls every
     * 750ms — so either it is not running, or the command was written somewhere
     * it does not look.
     */
    if (
      now.pendingId !== null &&
      !warnedStuck &&
      pendingSince > 0 &&
      Date.now() - pendingSince > STUCK_AFTER_MS
    ) {
      say(`STUCK: ${now.pending} unclaimed after ${STUCK_AFTER_MS}ms — the TV is not collecting`);
      warnedStuck = true;
    }

    // Phase changes only when it crosses a block, which is rare enough to be
    // worth knowing and quiet enough not to drown everything else.
    if (previous && previous.phase !== now.phase && now.phase !== null) {
      say(`phase ${now.phaseIndex} ${now.phase}`);
    }

    previous = now;
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

main().catch((error: unknown) => {
  say(`FATAL ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
