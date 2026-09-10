/**
 * POST /api/stage/begin — the workout starts.
 *
 * Marks the session active and seeds the live-state row the phone mirrors.
 */

import type { NextRequest } from 'next/server';
import { serviceClient } from '@/lib/supabase/service';
import type { BeginRequest } from '@/lib/stage/contract';
import { json, requireStagePairing } from '@/lib/stage/server';

export async function POST(request: NextRequest) {
  const pairing = await requireStagePairing(request);
  if (!pairing || !pairing.user_id) return json({ error: 'unpaired' }, 401);

  const body = (await request.json()) as BeginRequest;
  if (!body || !body.session_id) return json({ error: 'session_id required' }, 400);

  const supabase = serviceClient();
  const now = new Date().toISOString();

  /*
   * Abandon any other active session first.
   *
   * `uq_sessions_one_active_per_user` is a partial unique index, so without this
   * one crashed television leaves the account permanently unable to start
   * anything — the insert would just keep failing with no obvious cause. For a
   * single-user app, unconditionally abandoning the old one is both correct and
   * the only behaviour that can't wedge.
   */
  await supabase
    .from('sessions')
    .update({ status: 'abandoned', completed_at: now })
    .eq('user_id', pairing.user_id)
    .eq('status', 'active')
    .neq('id', body.session_id);

  const { error } = await supabase
    .from('sessions')
    .update({ status: 'active', started_at: now })
    .eq('id', body.session_id)
    .eq('user_id', pairing.user_id);

  if (error) return json({ error: 'could_not_begin', detail: error.message }, 500);

  await supabase.from('session_live_state').upsert(
    {
      session_id: body.session_id,
      user_id: pairing.user_id,
      phase_index: 0,
      phase: 'transition',
      current_block_index: 0,
      current_item_index: 0,
      seconds_remaining: 0,
      is_paused: false,
      updated_at: now,
    },
    { onConflict: 'session_id' },
  );

  return json({ started: true });
}
