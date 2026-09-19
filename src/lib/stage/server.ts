/**
 * Server-side helpers for the stage endpoints.
 *
 * Runs in Node, never in the browser — so unlike the rest of `src/lib/stage`
 * this file is not in the ES2015 fence's blast radius conceptually, though the
 * lint rule still covers it and costs nothing to satisfy.
 */

import { createHash, randomInt, randomUUID } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { serviceClient } from '../supabase/service';
import type { CueLevel, StageMovement } from './contract';
import { STAGE_TOKEN_COOKIE, STAGE_TOKEN_HEADER } from './contract';

/** Only the hash is ever stored, so a database leak is not a paired television. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function newStageToken(): string {
  return randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '');
}

/** Cryptographic, not sequential — a predictable code is not a code. */
export function newPairingCode(): string {
  return String(randomInt(0, 10000)).padStart(4, '0');
}

export type StagePairing = {
  id: string;
  user_id: string | null;
  code: string;
  claimed_at: string | null;
  stage_screen: string;
};

/**
 * Resolve the caller's pairing from its token.
 *
 * Cookie first, header as a fallback. Some TV browsers drop cookies and there
 * would be no way to find that out remotely — spec §3 says there are no reliable
 * devtools — so ten lines of redundancy buys a failure mode we could otherwise
 * only guess at.
 */
export async function requireStagePairing(request: NextRequest): Promise<StagePairing | null> {
  const cookie = request.cookies.get(STAGE_TOKEN_COOKIE);
  const header = request.headers.get(STAGE_TOKEN_HEADER);
  const token = cookie ? cookie.value : header;
  if (!token) return null;

  const { data, error } = await serviceClient()
    .from('pairings')
    .select('id, user_id, code, claimed_at, stage_screen, revoked_at')
    .eq('stage_token_hash', hashToken(token))
    .maybeSingle();

  if (error || !data) return null;
  if (data.revoked_at) return null;

  return {
    id: data.id,
    user_id: data.user_id,
    code: data.code,
    claimed_at: data.claimed_at,
    stage_screen: data.stage_screen,
  };
}

/** Note the pairing is alive, for debugging a set that has silently stopped. */
export async function touchPairing(pairingId: string): Promise<void> {
  await serviceClient()
    .from('pairings')
    .update({ last_seen_at: new Date().toISOString() })
    .eq('id', pairingId);
}

/**
 * The session this pairing should be showing, if any.
 *
 * An active session wins over a merely planned one — a TV that reloads
 * mid-workout must land back in the workout, not on the shape screen.
 */
export async function currentSessionFor(userId: string) {
  const supabase = serviceClient();

  const { data: active } = await supabase
    .from('sessions')
    .select('id, status, requested_duration_min')
    .eq('user_id', userId)
    .eq('status', 'active')
    .maybeSingle();
  if (active) return active;

  const { data: planned } = await supabase
    .from('sessions')
    .select('id, status, requested_duration_min')
    .eq('user_id', userId)
    .eq('status', 'planned')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  return planned;
}

/**
 * Resolve a catalog row's artwork.
 *
 * Branches on `asset_ready`, which is set by `assets:upload` only after a
 * storage write returned ok. It deliberately does NOT branch on `asset_path`
 * (populated for all 91 rows at import time, pointing at files that never
 * existed) or on `asset_tier` (which describes the ambition, not the bytes).
 *
 * This used to return null unconditionally, which was right while the bucket was
 * empty — a URL that 404s gives the renderer a broken image instead of a
 * deliberate placeholder — but it also meant no artwork could ever appear,
 * however much of it we made.
 */
export function resolveAsset(row: {
  asset_path: string | null;
  asset_ready?: boolean | null;
  asset_kind?: string | null;
}): {
  asset_url: string | null;
  asset_kind: 'image' | 'video' | null;
} {
  if (!row.asset_ready || !row.asset_path) return { asset_url: null, asset_kind: null };

  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) return { asset_url: null, asset_kind: null };

  const kind =
    row.asset_kind === 'video' || row.asset_kind === 'image'
      ? row.asset_kind
      : /\.(mp4|webm|m4v)$/i.test(row.asset_path)
        ? 'video'
        : 'image';

  // The bucket is public, so this needs no signing round-trip — which is the
  // whole reason it is public: the television has no session to sign with.
  return {
    asset_url: `${base}/storage/v1/object/public/assets/${row.asset_path}`,
    asset_kind: kind,
  };
}

export type CatalogRowForStage = {
  id: string;
  name: string;
  cues: string[];
  setup_note: string | null;
  timing_type: string;
  unilateral: boolean;
  body_position: string;
  intensity: number;
  asset_path: string | null;
  asset_ready?: boolean | null;
  asset_kind?: string | null;
};

export function toStageMovement(row: CatalogRowForStage): StageMovement {
  const asset = resolveAsset(row);
  return {
    id: row.id,
    name: row.name,
    cues: row.cues,
    setup_note: row.setup_note,
    timing_type: row.timing_type,
    unilateral: row.unilateral,
    body_position: row.body_position,
    intensity: row.intensity,
    asset_url: asset.asset_url,
    asset_kind: asset.asset_kind,
  };
}

export function cueLevelOf(value: unknown): CueLevel {
  if (value === 'off' || value === 'key' || value === 'full') return value;
  return 'key';
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      // A polled endpoint must never be cached by anything in the path.
      'cache-control': 'no-store',
    },
  });
}
