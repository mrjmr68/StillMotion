/**
 * POST /api/stage/sync — the workhorse.
 *
 * Called every 750ms. Reads what screen the TV should be on and whether a
 * command is waiting; writes the cursor on every third call (~2.25s, matching
 * spec §4's "every ~2s").
 *
 * The timer never awaits this. Spec §4: "if the network drops, the workout
 * keeps running" — so server state is a mirror, never a source, and the only
 * time the TV reads a cursor back is once at mount.
 */

import type { NextRequest } from 'next/server';
import { serviceClient } from '@/lib/supabase/service';
import type { SyncRequest, SyncResponse } from '@/lib/stage/contract';
import type { StageCommand } from '@/lib/stage/machine';
import {
  cueLevelOf,
  currentSessionFor,
  json,
  requireStagePairing,
  touchPairing,
} from '@/lib/stage/server';

export async function POST(request: NextRequest) {
  const pairing = await requireStagePairing(request);
  if (!pairing) return json({ error: 'unpaired' }, 401);

  let body: SyncRequest = { state: null, claimed_command_id: null };
  try {
    body = (await request.json()) as SyncRequest;
  } catch {
    // A sync with no body is a read-only beat. Not an error.
  }

  const supabase = serviceClient();

  // Not yet claimed by a phone — keep showing the code.
  if (!pairing.user_id || !pairing.claimed_at) {
    const response: SyncResponse = {
      screen: 'pairing',
      code: pairing.code,
      session_id: null,
      session_status: null,
      cue_level: 'key',
      command: null,
      server_time: Date.now(),
    };
    return json(response);
  }

  void touchPairing(pairing.id);

  const session = await currentSessionFor(pairing.user_id);

  // Generation is in flight. `sessions` deliberately doesn't exist until the
  // plan is complete, so the pairing row is the only thing that can carry this.
  if (!session) {
    const response: SyncResponse = {
      screen: pairing.stage_screen === 'centering' ? 'centering' : 'idle',
      code: null,
      session_id: null,
      session_status: null,
      cue_level: 'key',
      command: null,
      server_time: Date.now(),
    };
    return json(response);
  }

  // ---- write the cursor, on write beats only --------------------------
  if (body.state && body.state.session_id === session.id) {
    const cursor = body.state;
    await supabase.from('session_live_state').upsert(
      {
        session_id: session.id,
        user_id: pairing.user_id,
        phase_index: cursor.phase_index,
        phase: cursor.phase,
        current_block_index: cursor.block_index,
        current_item_index: cursor.item_index,
        side: cursor.side,
        seconds_remaining: cursor.seconds_remaining,
        is_paused: cursor.is_paused,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'session_id' },
    );
  }

  // ---- clear an acknowledged command ----------------------------------
  //
  // Compare-and-swap on the payload's id rather than the command name, because
  // add_30s is the one command a human genuinely presses twice in a row and a
  // CAS on the name would silently collapse the second press into the first.
  if (body.claimed_command_id) {
    await supabase
      .from('session_live_state')
      .update({ pending_command: null, pending_command_payload: null })
      .eq('session_id', session.id)
      .eq('pending_command_payload->>id', body.claimed_command_id);
  }

  const { data: live } = await supabase
    .from('session_live_state')
    .select('pending_command, pending_command_payload, cue_level')
    .eq('session_id', session.id)
    .maybeSingle();

  const payload = (live && live.pending_command_payload) as Record<string, unknown> | null;
  const commandId = payload && typeof payload.id === 'string' ? payload.id : null;

  const response: SyncResponse = {
    screen:
      session.status === 'active'
        ? 'running'
        : session.status === 'completed' || session.status === 'abandoned'
          ? 'complete'
          : 'shape',
    code: null,
    session_id: session.id,
    session_status: session.status,
    cue_level: cueLevelOf(live ? live.cue_level : 'key'),
    command:
      live && live.pending_command && commandId
        ? { id: commandId, name: live.pending_command as StageCommand, payload }
        : null,
    server_time: Date.now(),
  };

  return json(response);
}
