/**
 * POST /api/console/pair/revoke — forget the television.
 *
 * This exists because of a hole found the first time a second account signed in:
 * a paired TV only asks for a new code in response to a 401, so while it holds a
 * valid token it will never show one. A set paired to the wrong account was
 * therefore unmovable from either screen — the only fix was editing
 * `pairings.revoked_at` with a service key, which is not a thing you can do from
 * a sofa.
 *
 * Revoking is scoped to the caller's own pairings, which is also why it cannot
 * fully solve the cross-account case: account B must not be able to unpair
 * account A's television. What it does solve is the case that actually happens —
 * the owner wanting their own set back, or moving it somewhere else.
 */

import { createClient } from '@/lib/supabase/server';
import { serviceClient } from '@/lib/supabase/service';
import { json } from '@/lib/stage/server';

export async function POST() {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims && claims.claims ? (claims.claims.sub as string | undefined) : undefined;
  if (!userId) return json({ error: 'unauthenticated' }, 401);

  const { data, error } = await serviceClient()
    .from('pairings')
    .update({ revoked_at: new Date().toISOString() })
    .eq('user_id', userId)
    .is('revoked_at', null)
    .select('id');

  if (error) return json({ error: 'revoke_failed', detail: error.message }, 500);

  // The TV is not told. It finds out on its next sync, which 401s and sends it
  // back to the pairing screen with a fresh code — the same path a brand new
  // set takes, rather than a second mechanism that could rot.
  return json({ revoked: (data ?? []).length });
}
