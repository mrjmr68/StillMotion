/**
 * Service-role Supabase access for the catalog scripts.
 *
 * Note this deliberately does NOT reuse `src/lib/supabase/{client,server,proxy}.ts`.
 * All three are `@supabase/ssr` factories bound to Next's cookie store — there is
 * no cookie jar in a CLI script. This is a plain `@supabase/supabase-js` client
 * with the service-role key and session persistence turned off.
 */

import { createClient } from '@supabase/supabase-js';
import type { Database } from '../../../src/lib/supabase/types';
import { supabaseServiceRoleKey, supabaseUrl } from './env';

export type CatalogDigestRow = {
  id: string;
  name: string;
  aka: string[];
  modality: string;
  movement_pattern: string;
  body_position: string;
  equipment: string[];
  unilateral: boolean;
  intensity: number;
};

export function serviceClient() {
  return createClient<Database>(supabaseUrl(), supabaseServiceRoleKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Everything already in the catalog, in the slim shape dedupe and the prompt
 * digest need. Sorted for stable output so a regenerated prompt is byte-identical
 * when nothing changed — which matters for prompt caching.
 */
export async function fetchCatalogDigest(): Promise<CatalogDigestRow[]> {
  const supabase = serviceClient();
  const { data, error } = await supabase
    .from('exercise_catalog')
    .select(
      'id, name, aka, modality, movement_pattern, body_position, equipment, unilateral, intensity',
    )
    .order('id');

  if (error) {
    throw new Error(`Could not read exercise_catalog: ${error.message}`);
  }

  return (data ?? []) as CatalogDigestRow[];
}
