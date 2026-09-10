/**
 * stage:drive — stand in for the phone.
 *
 * The check-in console doesn't exist yet, so this drives the same rows the
 * console will: claim a pairing code, queue a command, change the cue level,
 * or tail the live cursor the way the phone's mirror will.
 *
 * It writes through the service client rather than the console's HTTP
 * endpoints, because those require a Supabase cookie session that a terminal
 * doesn't have. The rows and their semantics are identical, so the contract the
 * console inherits is still the one exercised here.
 *
 *   npm run stage:drive -- --user <uuid> --claim 4821
 *   npm run stage:drive -- --user <uuid> --command pause
 *   npm run stage:drive -- --user <uuid> --cue full
 *   npm run stage:drive -- --user <uuid> --watch
 */

import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';
import { serviceClient } from '../catalog/lib/db';
import { bold, dim, green, red, yellow } from '../catalog/lib/render';

const COMMANDS = ['begin', 'pause', 'resume', 'skip', 'add_30s', 'swap', 'done', 'end'];
const CUE_LEVELS = ['off', 'key', 'full'];
const WATCH_MS = 750;

async function activeSession(userId: string): Promise<{ id: string; status: string } | null> {
  const { data } = await serviceClient()
    .from('sessions')
    .select('id, status')
    .eq('user_id', userId)
    .in('status', ['planned', 'active'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}

async function claim(userId: string, code: string) {
  const now = new Date().toISOString();
  const { data, error } = await serviceClient()
    .from('pairings')
    .update({ user_id: userId, claimed_at: now })
    .eq('code', code)
    .is('claimed_at', null)
    .is('revoked_at', null)
    .gt('expires_at', now)
    .select('id')
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) {
    console.log(red(`no unclaimed, unexpired pairing with code ${code}`));
    process.exit(1);
  }
  console.log(green(`paired — code ${code} now belongs to ${userId}`));
}

async function sendCommand(userId: string, command: string, sessionId: string | null) {
  const session = sessionId ? { id: sessionId } : await activeSession(userId);
  if (!session) {
    console.log(red('no planned or active session — run `npm run stage:seed` first'));
    process.exit(1);
  }

  // The id lives in the payload, not the command name, because add_30s is the
  // one command a human presses twice in a row on purpose and the stage's
  // compare-and-swap ack must be able to tell those two presses apart.
  const id = randomUUID();
  const { error } = await serviceClient()
    .from('session_live_state')
    .update({ pending_command: command, pending_command_payload: { id } })
    .eq('session_id', session.id);

  if (error) throw new Error(error.message);
  console.log(green(`queued ${bold(command)}`) + dim(` (${id.slice(0, 8)}) on session ${session.id}`));
}

async function setCueLevel(userId: string, level: string, sessionId: string | null) {
  const session = sessionId ? { id: sessionId } : await activeSession(userId);
  if (session) {
    await serviceClient()
      .from('session_live_state')
      .update({ cue_level: level })
      .eq('session_id', session.id);
  }
  await serviceClient().from('user_preferences').update({ cue_level: level }).eq('user_id', userId);
  console.log(green(`cue level → ${level}`));
}

/** The console's mirror, rendered as one terminal line. */
async function watch(userId: string) {
  console.log(dim('polling session_live_state every 750ms · ctrl-c to stop\n'));
  let lastLine = '';

  for (;;) {
    const session = await activeSession(userId);
    let line: string;

    if (!session) {
      line = dim('no session');
    } else {
      const { data } = await serviceClient()
        .from('session_live_state')
        .select('*')
        .eq('session_id', session.id)
        .maybeSingle();

      if (!data) {
        line = `${session.status} · no live state yet`;
      } else {
        const side = data.side ? ` ${String(data.side).toUpperCase()}` : '';
        const paused = data.is_paused ? yellow(' PAUSED') : '';
        const pending = data.pending_command ? yellow(` <${data.pending_command}>`) : '';
        line =
          `${session.status} · phase ${String(data.phase_index).padStart(3)} ` +
          `${String(data.phase ?? '?').padEnd(12)} ` +
          `b${data.current_block_index}/i${data.current_item_index}${side} · ` +
          `${String(data.seconds_remaining).padStart(3)}s · cues ${data.cue_level}` +
          paused +
          pending;
      }
    }

    if (line !== lastLine) {
      console.log(line);
      lastLine = line;
    }
    await new Promise((resolve) => setTimeout(resolve, WATCH_MS));
  }
}

async function main() {
  const { values } = parseArgs({
    options: {
      user: { type: 'string' },
      session: { type: 'string' },
      claim: { type: 'string' },
      command: { type: 'string' },
      cue: { type: 'string' },
      watch: { type: 'boolean', default: false },
    },
  });

  if (!values.user) throw new Error('--user <uuid> is required');
  const sessionId = values.session ?? null;

  if (values.claim) return claim(values.user, values.claim);

  if (values.cue) {
    if (CUE_LEVELS.indexOf(values.cue) < 0) {
      throw new Error(`--cue must be one of: ${CUE_LEVELS.join(', ')}`);
    }
    await setCueLevel(values.user, values.cue, sessionId);
    if (!values.command) return;
  }

  if (values.command) {
    if (COMMANDS.indexOf(values.command) < 0) {
      throw new Error(`--command must be one of: ${COMMANDS.join(', ')}`);
    }
    return sendCommand(values.user, values.command, sessionId);
  }

  if (values.watch) return watch(values.user);

  throw new Error('nothing to do — pass --claim, --command, --cue or --watch');
}

main().catch((error: unknown) => {
  console.error(`\n${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
