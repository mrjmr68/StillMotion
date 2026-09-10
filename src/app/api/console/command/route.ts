/**
 * POST /api/console/command — the phone sends a command to the TV.
 *
 * The server stamps an id into the payload. That id, not the command name, is
 * what the TV acknowledges and what the sync endpoint compare-and-swaps on —
 * because `add_30s` is the one command a human genuinely presses twice in a row,
 * and a CAS on the name would silently collapse the second press into the first.
 *
 * Also handles the cue level, which spec §8 models on subtitles: switched from
 * the phone at any moment, persisted as a preference.
 *
 * EVERY write here is an upsert, and that is load-bearing rather than defensive.
 * `session_live_state` has no row until a session starts, so the original
 * `update` meant the one command that STARTS a session had nowhere to land: zero
 * rows changed, no error from Postgres, a 200 from here, and a television that
 * never heard anything. Begin from the phone could not work, and it went unseen
 * because the first verification pressed OK on the TV instead.
 */

import { randomUUID } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { serviceClient } from '@/lib/supabase/service';
import type { CommandRequest } from '@/lib/stage/contract';
import { json } from '@/lib/stage/server';

const COMMANDS = ['begin', 'pause', 'resume', 'skip', 'add_30s', 'swap', 'done', 'end'];
const CUE_LEVELS = ['off', 'key', 'full'];

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims && claims.claims ? (claims.claims.sub as string | undefined) : undefined;
  if (!userId) return json({ error: 'unauthenticated' }, 401);

  const body = (await request.json()) as CommandRequest & { cue_level?: string };
  if (!body || !body.session_id) return json({ error: 'session_id required' }, 400);

  const service = serviceClient();

  // Ownership check: a command must not reach someone else's television.
  const { data: session } = await service
    .from('sessions')
    .select('id')
    .eq('id', body.session_id)
    .eq('user_id', userId)
    .maybeSingle();
  if (!session) return json({ error: 'session_not_found' }, 404);

  // Cue level is a setting, not a command — it takes effect on the next poll
  // rather than being consumed once.
  if (body.cue_level) {
    if (CUE_LEVELS.indexOf(body.cue_level) < 0) return json({ error: 'invalid_cue_level' }, 400);

    await service.from('session_live_state').upsert(
      { session_id: body.session_id, user_id: userId, cue_level: body.cue_level },
      { onConflict: 'session_id' },
    );
    // The preferences row may not exist either — it is created by the first
    // check-in, and changing cues before ever generating is a legal order of
    // operations.
    await service
      .from('user_preferences')
      .upsert({ user_id: userId, cue_level: body.cue_level }, { onConflict: 'user_id' });

    if (!body.command) return json({ cue_level: body.cue_level });
  }

  if (!body.command || COMMANDS.indexOf(body.command) < 0) {
    return json({ error: 'invalid_command' }, 400);
  }

  const id = randomUUID();
  const payload = { ...(body.payload ?? {}), id };

  const { data: queued, error } = await service
    .from('session_live_state')
    .upsert(
      {
        session_id: body.session_id,
        user_id: userId,
        pending_command: body.command,
        pending_command_payload: payload,
      },
      { onConflict: 'session_id' },
    )
    .select('session_id');

  if (error) return json({ error: 'could_not_queue', detail: error.message }, 500);

  /*
   * Affecting no rows is a failure, and saying so is the actual lesson here.
   * The original bug was not the missing upsert so much as the silence around
   * it — a write that changes nothing looks identical to a write that worked,
   * and the only symptom was a button that did nothing.
   */
  if (!queued || queued.length === 0) {
    return json({ error: 'not_queued', detail: 'the command changed no rows' }, 500);
  }

  return json({ id, command: body.command });
}
