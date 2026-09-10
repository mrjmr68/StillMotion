/**
 * POST /api/stage/complete — the session is over.
 *
 * Writes the outcome, the performed record, and one `exercise_logs` row per item
 * per side. Idempotent: the logs upsert on
 * `(session_id, block_index, item_index, side)`, so a retry after a flaky
 * network writes nothing twice.
 */

import type { NextRequest } from 'next/server';
import { serviceClient } from '@/lib/supabase/service';
import type { CompleteRequest } from '@/lib/stage/contract';
import { json, requireStagePairing } from '@/lib/stage/server';

export async function POST(request: NextRequest) {
  const pairing = await requireStagePairing(request);
  if (!pairing || !pairing.user_id) return json({ error: 'unpaired' }, 401);

  const body = (await request.json()) as CompleteRequest;
  if (!body || !body.session_id) return json({ error: 'session_id required' }, 400);

  const supabase = serviceClient();
  const now = new Date().toISOString();
  const outcome = body.outcome === 'abandoned' ? 'abandoned' : 'completed';
  const performed = Array.isArray(body.performed) ? body.performed : [];

  const { error } = await supabase
    .from('sessions')
    .update({
      status: outcome,
      completed_at: now,
      plan_performed: performed as unknown as never,
    })
    .eq('id', body.session_id)
    .eq('user_id', pairing.user_id);

  if (error) return json({ error: 'could_not_complete', detail: error.message }, 500);

  if (performed.length > 0) {
    const rows = performed.map((entry) => ({
      session_id: body.session_id,
      user_id: pairing.user_id as string,
      block_index: entry.block_index,
      item_index: entry.item_index,
      side: entry.side,
      exercise_id: entry.exercise_id,
      prescribed_dose: entry.prescribed_dose,
      completed_dose: entry.completed_dose,
      rest_seconds: entry.rest_seconds,
      was_skipped: entry.was_skipped,
    }));

    const { error: logError } = await supabase
      .from('exercise_logs')
      .upsert(rows, { onConflict: 'session_id,block_index,item_index,side' });

    if (logError) {
      // The session is already recorded; losing the per-item detail is worth
      // reporting but not worth failing the request the TV needs to move on.
      return json({ completed: true, logs_written: false, detail: logError.message });
    }
  }

  // The live cursor is meaningless once the session ends.
  await supabase.from('session_live_state').delete().eq('session_id', body.session_id);

  return json({ completed: true, logs_written: performed.length > 0 });
}
