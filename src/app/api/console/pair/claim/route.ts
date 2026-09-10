/**
 * POST /api/console/pair/claim — the phone claims the code shown on the TV.
 *
 * Auth is checked HERE rather than by the proxy. The proxy only gates
 * `PROTECTED_PATHS = ["/app"]`; adding `/api/console` to that list would make an
 * unauthenticated fetch receive a 307 to the `/login` HTML page instead of a
 * 401, which is useless to a caller expecting JSON.
 */

import type { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { serviceClient } from '@/lib/supabase/service';
import type { ClaimRequest } from '@/lib/stage/contract';
import { json } from '@/lib/stage/server';

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims && claims.claims ? (claims.claims.sub as string | undefined) : undefined;
  if (!userId) return json({ error: 'unauthenticated' }, 401);

  const body = (await request.json()) as ClaimRequest;
  const code = body && typeof body.code === 'string' ? body.code.trim() : '';
  if (!/^[0-9]{4}$/.test(code)) return json({ error: 'invalid_code' }, 400);

  const service = serviceClient();
  const now = new Date().toISOString();

  // Only an unclaimed, unexpired, unrevoked code can be claimed. `expires_at`
  // deliberately gates ONLY this step — once claimed the pairing is durable, so
  // a bookmarked television doesn't un-pair itself fifteen minutes later.
  const { data, error } = await service
    .from('pairings')
    .update({ user_id: userId, claimed_at: now })
    .eq('code', code)
    .is('claimed_at', null)
    .is('revoked_at', null)
    .gt('expires_at', now)
    .select('id')
    .maybeSingle();

  if (error) return json({ error: 'claim_failed', detail: error.message }, 500);
  if (!data) return json({ error: 'code_not_found_or_expired' }, 404);

  return json({ paired: true });
}
