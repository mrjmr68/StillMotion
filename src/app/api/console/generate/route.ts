/**
 * POST /api/console/generate — the check-in becomes a session.
 *
 * This is the one endpoint in the project that takes minutes rather than
 * milliseconds, and everything about its shape follows from that.
 *
 * The inserted session, not this response, is the source of truth. The phone
 * polls for it independently, so a dropped connection, a locked screen, or a
 * browser that gives up on a two-minute fetch all recover by themselves — which
 * is what spec §7's "closing the phone during generation orphans nothing" has to
 * mean in practice, not just in the schema.
 *
 * Auth is checked here rather than in the proxy, for the same reason
 * `pair/claim` checks it here: `PROTECTED_PATHS` redirects to the /login HTML
 * page, and a 307 to HTML is useless to a caller expecting JSON.
 */

import type { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { serviceClient } from '@/lib/supabase/service';
import { CheckinRequestSchema, resolveCheckin } from '@/lib/console/checkin';
import { buildSession } from '@/lib/planner';
import { makeGenerator } from '@/lib/planner/generate';
import { PLANNER_PROMPT_VERSION } from '@/lib/planner/prompt';
import {
  fetchCatalog,
  fetchPreferences,
  fetchRecency,
  findOpenSession,
  insertSession,
  saveStickyPreferences,
} from '@/lib/planner/store';
import { json } from '@/lib/stage/server';

/**
 * Generation measures ~2 minutes at effort `high`. Node has no request timeout
 * of its own, so this only matters on a platform that imposes one — but the
 * value being wrong is exactly the kind of thing that is discovered on the day
 * of a deploy, so it is stated now.
 */
export const maxDuration = 300;

/** Matches the CLI's default, so `plan --dry-run` predicts what happens here. */
const EFFORT = 'high';

/**
 * Tell a paired television that a session is being generated.
 *
 * `sessions` deliberately does not exist until the plan is complete, and
 * `status` has no 'generating' value, so the pairing row is the only thing that
 * can carry this — see the stage_runtime migration. Best-effort on purpose: a
 * TV that misses the centering screen is a cosmetic loss, and failing the whole
 * check-in over it would not be.
 */
async function setStageScreen(userId: string, screen: 'idle' | 'centering'): Promise<void> {
  try {
    await serviceClient()
      .from('pairings')
      .update({ stage_screen: screen })
      .eq('user_id', userId)
      .is('revoked_at', null)
      .not('claimed_at', 'is', null);
  } catch {
    // Non-fatal by design. The workout does not depend on it.
  }
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims && claims.claims ? (claims.claims.sub as string | undefined) : undefined;
  if (!userId) return json({ error: 'unauthenticated' }, 401);

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }

  const parsed = CheckinRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return json({ error: 'invalid_checkin', detail: parsed.error.issues }, 400);
  }
  const submitted = parsed.data;

  /*
   * Idempotence, and the reason it isn't optional.
   *
   * A two-minute wait invites a second press, and `uq_sessions_one_active_per_user`
   * only stops a duplicate ACTIVE session — two `planned` ones are perfectly
   * legal, and would cost a second API call and leave the TV showing whichever
   * the tie-break picked. Returning the open session is both cheaper and the
   * only answer that can't surprise anyone.
   */
  const open = await findOpenSession(userId);
  if (open) return json({ session_id: open.id, status: open.status, reused: true });

  await saveStickyPreferences(userId, {
    equipment_on_hand: submitted.equipment_on_hand,
    emphasis: submitted.emphasis,
    format_preference: submitted.format_preference,
    floor_tolerance: submitted.floor_tolerance,
  });

  await setStageScreen(userId, 'centering');

  try {
    const [stored, recent, catalog] = await Promise.all([
      fetchPreferences(userId),
      fetchRecency(userId),
      fetchCatalog(),
    ]);

    const checkin = resolveCheckin(submitted, {
      // The include/exclude lists come from `user_movement_preferences`, never
      // from the request body — see the note in console/checkin.ts.
      include_exercise_ids: stored ? stored.include_exercise_ids : [],
      exclude_exercise_ids: stored ? stored.exclude_exercise_ids : [],
      recent_exercise_ids: recent,
    });

    // `buildSession` never throws and always returns a plan: a refusal, a
    // malformed response, or a pool too thin to work with all land on a fitted
    // template. Spec §7: "there is no path where the check-in ends in an error
    // message."
    const result = await buildSession({
      checkin,
      catalog,
      generate: makeGenerator(EFFORT),
      promptVersion: PLANNER_PROMPT_VERSION,
    });

    const sessionId = await insertSession(userId, checkin, result.plan);

    return json({
      session_id: sessionId,
      status: 'planned',
      reused: false,
      source: result.source,
      findings: result.findings,
      generation_error: result.generationError,
    });
  } catch (error) {
    // Only infrastructure gets here — the database being unreachable, or the
    // service key being absent. The planner's own failures are already plans.
    return json(
      { error: 'generate_failed', detail: error instanceof Error ? error.message : String(error) },
      500,
    );
  } finally {
    await setStageScreen(userId, 'idle');
  }
}
