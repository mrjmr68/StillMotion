/**
 * POST /api/stage/pair — the television asks for a pairing code.
 *
 * Unauthenticated by necessity: spec §3 says you never type on the TV, so it
 * has no way to sign in. What it gets back is a 4-digit code to DISPLAY and a
 * 32-byte token that is the actual credential for everything afterwards.
 *
 * No caching config here or in any stage route: Next 16 leaves route handlers
 * uncached by default and Cache Components is off, so adding `dynamic` or
 * `revalidate` would be a bug rather than an optimisation.
 */

import type { NextRequest } from 'next/server';
import { serviceClient } from '@/lib/supabase/service';
import { STAGE_TOKEN_COOKIE } from '@/lib/stage/contract';
import { hashToken, json, newPairingCode, newStageToken } from '@/lib/stage/server';

const CODE_TTL_MINUTES = 15;
const MAX_CODE_ATTEMPTS = 12;

export async function POST(request: NextRequest) {
  const supabase = serviceClient();
  const token = newStageToken();
  const expiresAt = new Date(Date.now() + CODE_TTL_MINUTES * 60_000).toISOString();

  // A set that reboots twice shouldn't leave live codes behind it.
  const existing = request.cookies.get(STAGE_TOKEN_COOKIE);
  if (existing) {
    await supabase
      .from('pairings')
      .update({ revoked_at: new Date().toISOString() })
      .eq('stage_token_hash', hashToken(existing.value))
      .is('claimed_at', null);
  }

  // `uq_pairings_active_code` makes a collision a unique violation rather than
  // two televisions sharing a code, so retry rather than trusting randomness.
  let inserted: { id: string; code: string } | null = null;
  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS && !inserted; attempt += 1) {
    const code = newPairingCode();
    const { data, error } = await supabase
      .from('pairings')
      .insert({
        code,
        expires_at: expiresAt,
        stage_token_hash: hashToken(token),
      })
      .select('id, code')
      .single();

    if (!error && data) inserted = data;
    else if (error && error.code !== '23505') {
      return json({ error: 'could_not_create_pairing', detail: error.message }, 500);
    }
  }

  if (!inserted) return json({ error: 'no_code_available' }, 503);

  const response = json({ code: inserted.code, expires_at: expiresAt, stage_token: token });
  response.headers.append(
    'set-cookie',
    `${STAGE_TOKEN_COOKIE}=${token}; Path=/api/stage; HttpOnly; SameSite=Lax; Max-Age=31536000`,
  );
  return response;
}
