/**
 * GET /api/stage/bundle?session_id=… — everything the TV needs, once.
 *
 * This endpoint is mandatory rather than an optimisation. `exercise_catalog` is
 * `select ... to authenticated` and the television has no session, so it cannot
 * read a single catalog row directly. Handing over the plan plus every movement
 * it references in one response is what lets the rest of the workout run with
 * the network optional (spec §4).
 */

import type { NextRequest } from 'next/server';
import { serviceClient } from '@/lib/supabase/service';
import type { BundleResponse, StageMovement } from '@/lib/stage/contract';
import type { SessionPlan } from '@/lib/planner/schema';
import {
  cueLevelOf,
  json,
  requireStagePairing,
  toStageMovement,
  type CatalogRowForStage,
} from '@/lib/stage/server';

export async function GET(request: NextRequest) {
  const pairing = await requireStagePairing(request);
  if (!pairing || !pairing.user_id) return json({ error: 'unpaired' }, 401);

  const sessionId = request.nextUrl.searchParams.get('session_id');
  if (!sessionId) return json({ error: 'session_id required' }, 400);

  const supabase = serviceClient();

  // Scoped by user_id as well as id: the pairing must own the session it asks
  // for, or a leaked token would read someone else's workout.
  const { data: session, error } = await supabase
    .from('sessions')
    .select('id, status, requested_duration_min, plan_generated')
    .eq('id', sessionId)
    .eq('user_id', pairing.user_id)
    .maybeSingle();

  if (error || !session) return json({ error: 'session_not_found' }, 404);

  const plan = session.plan_generated as unknown as SessionPlan;

  const ids = Array.from(
    new Set(plan.blocks.flatMap((block) => block.items.map((item) => item.exercise_id))),
  );

  const { data: rows, error: catalogError } = await supabase
    .from('exercise_catalog')
    .select('id, name, cues, setup_note, timing_type, unilateral, body_position, intensity, asset_path, asset_ready, asset_kind')
    .in('id', ids);

  if (catalogError) return json({ error: 'catalog_unavailable', detail: catalogError.message }, 500);

  const movements: Record<string, StageMovement> = {};
  for (const row of (rows ?? []) as CatalogRowForStage[]) {
    movements[row.id] = toStageMovement(row);
  }

  const { data: live } = await supabase
    .from('session_live_state')
    .select('cue_level')
    .eq('session_id', session.id)
    .maybeSingle();

  const body: BundleResponse = {
    session: {
      id: session.id,
      requested_duration_min: session.requested_duration_min,
      status: session.status,
    },
    plan,
    movements,
    cue_level: cueLevelOf(live ? live.cue_level : 'key'),
  };

  return json(body);
}
