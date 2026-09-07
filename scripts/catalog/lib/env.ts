/**
 * Environment access for the catalog scripts.
 *
 * Scripts are launched with `node --env-file-if-exists=.env.local`, so by the
 * time this runs the values are already on `process.env` if the file existed.
 * The `-if-exists` variant is deliberate: plain `--env-file` hard-fails with an
 * opaque error when the file is missing, and `.env.local` is gitignored and so
 * absent on a fresh clone. Producing a useful message is this module's job.
 */

const SETUP_HINT =
  'Copy .env.example to .env.local and fill it in (the file is gitignored, so a fresh clone will not have one).';

export function requireEnv(name: string, why: string): string {
  const value = process.env[name];
  if (!value || value.startsWith('your-')) {
    throw new Error(`${name} is not set.\n  Needed for: ${why}\n  ${SETUP_HINT}`);
  }
  return value;
}

export function anthropicApiKey(): string {
  return requireEnv('ANTHROPIC_API_KEY', 'calling the Anthropic API to draft entries');
}

/** Defaults to Opus 5 when unset. */
export function anthropicModel(): string {
  return process.env.ANTHROPIC_MODEL || 'claude-opus-5';
}

export function supabaseUrl(): string {
  return requireEnv('NEXT_PUBLIC_SUPABASE_URL', 'reading the existing catalog');
}

/**
 * The service-role key is required even to READ the catalog: the select policy
 * on `exercise_catalog` is `to authenticated`, and a script has no user session,
 * so a publishable-key read returns zero rows rather than an error — which would
 * silently defeat dedupe.
 */
export function supabaseServiceRoleKey(): string {
  return requireEnv(
    'SUPABASE_SERVICE_ROLE_KEY',
    'reading the catalog past RLS (the select policy is `to authenticated`, and a script has no session)',
  );
}
