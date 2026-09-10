/**
 * Service-role Supabase client for the app's server code.
 *
 * The app-side twin of `scripts/catalog/lib/db.ts`. It exists for one reason:
 * the television is never authenticated, so every row it needs — the catalog,
 * the plan, the live cursor — has to be read and written by something that
 * bypasses RLS. See `docs/DECISIONS.md`.
 *
 * NEVER import this from a client component. It carries a key that grants
 * unrestricted access to every user's data, and the absence of a
 * `NEXT_PUBLIC_` prefix is the only thing keeping it out of the browser bundle.
 */

import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';

let cached: ReturnType<typeof createClient<Database>> | null = null;

export function serviceClient() {
  if (cached) return cached;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key || key.startsWith('your-')) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY is not set. The stage endpoints need it because ' +
        'the TV is unauthenticated and cannot read past RLS. Copy .env.example to ' +
        '.env.local and fill it in.',
    );
  }

  cached = createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}
