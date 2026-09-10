/**
 * The planner's database access.
 *
 * Shared by the `plan` CLI and the console's generate route — every one of these
 * reads needs `service_role`, and for the same reason the stage needs it: the
 * select policy on `exercise_catalog` is `to authenticated`, so a
 * publishable-key read returns zero rows rather than an error. Silent emptiness
 * is the worst possible failure for a table the planner is choosing from.
 *
 * Server-only. See the warning in `src/lib/supabase/service.ts`.
 */

import type { CatalogRow } from '../catalog/schema';
import type { Checkin, SessionPlan } from './schema';
import { serviceClient } from '../supabase/service';

/** The whole catalog, typed. Ordered by id so a prompt is byte-stable. */
export async function fetchCatalog(): Promise<CatalogRow[]> {
  const { data, error } = await serviceClient().from('exercise_catalog').select('*').order('id');
  if (error) throw new Error(`Could not read exercise_catalog: ${error.message}`);
  return (data ?? []) as unknown as CatalogRow[];
}

/**
 * Build 1's entire variety mechanism: what was prescribed in the last 3
 * sessions. The coverage ledger is Build 3 (see docs/DECISIONS.md) — this is
 * deliberately the simpler thing.
 */
export async function fetchRecency(userId: string, sessions = 3): Promise<string[]> {
  const supabase = serviceClient();

  const { data: recent, error: sessionError } = await supabase
    .from('sessions')
    .select('id')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(sessions);
  if (sessionError) throw new Error(`Could not read sessions: ${sessionError.message}`);
  if (!recent || recent.length === 0) return [];

  const { data: logs, error: logError } = await supabase
    .from('exercise_logs')
    .select('exercise_id')
    .in(
      'session_id',
      recent.map((row) => row.id),
    );
  if (logError) throw new Error(`Could not read exercise_logs: ${logError.message}`);

  return [...new Set((logs ?? []).map((row) => row.exercise_id as string))];
}

export type StoredPreferences = Pick<
  Checkin,
  'equipment_on_hand' | 'emphasis' | 'format_preference' | 'floor_tolerance'
> & { include_exercise_ids: string[]; exclude_exercise_ids: string[] };

export async function fetchPreferences(userId: string): Promise<StoredPreferences | null> {
  const supabase = serviceClient();

  const { data, error } = await supabase
    .from('user_preferences')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw new Error(`Could not read user_preferences: ${error.message}`);
  if (!data) return null;

  const { data: movements, error: movementError } = await supabase
    .from('user_movement_preferences')
    .select('exercise_id, preference')
    .eq('user_id', userId);
  if (movementError) {
    throw new Error(`Could not read user_movement_preferences: ${movementError.message}`);
  }

  return {
    equipment_on_hand: data.equipment_on_hand as StoredPreferences['equipment_on_hand'],
    emphasis: data.emphasis as StoredPreferences['emphasis'],
    format_preference: data.format_preference as StoredPreferences['format_preference'],
    floor_tolerance: data.floor_tolerance as StoredPreferences['floor_tolerance'],
    include_exercise_ids: (movements ?? [])
      .filter((row) => row.preference === 'include')
      .map((row) => row.exercise_id as string),
    exclude_exercise_ids: (movements ?? [])
      .filter((row) => row.preference === 'exclude')
      .map((row) => row.exercise_id as string),
  };
}

/**
 * Insert the planned session. `plan_generated` is NOT NULL and a partial unique
 * index allows only one active session per user, so there is no "create the row
 * then fill in the plan" path — the plan must be complete before the insert,
 * template fallback included. That matches the guarantee: closing the phone
 * during the 20-30 second generation orphans nothing.
 */
export async function insertSession(
  userId: string,
  checkin: Checkin,
  plan: SessionPlan,
): Promise<string> {
  const { data, error } = await serviceClient()
    .from('sessions')
    .insert({
      user_id: userId,
      status: 'planned',
      requested_duration_min: checkin.duration_min,
      checkin_input: checkin as unknown as never,
      plan_generated: plan as unknown as never,
    })
    .select('id')
    .single();

  if (error) throw new Error(`Could not insert session: ${error.message}`);
  return data.id as string;
}

/**
 * Persist the sticky half of the check-in.
 *
 * Spec §6 splits the check-in in two: four controls you answer every time
 * (duration, energy, focus, avoid) and a set that stays put until you change it.
 * Only the second half is written here — writing today's energy would make
 * tomorrow's default a lie.
 *
 * An upsert rather than an update because `user_preferences` has no row until
 * something creates one, and the alternative — a trigger on `auth.users` — puts
 * app defaults in a place no one thinks to look.
 */
export async function saveStickyPreferences(
  userId: string,
  sticky: Pick<
    Checkin,
    'equipment_on_hand' | 'emphasis' | 'format_preference' | 'floor_tolerance'
  >,
): Promise<void> {
  const { error } = await serviceClient()
    .from('user_preferences')
    .upsert(
      {
        user_id: userId,
        equipment_on_hand: sticky.equipment_on_hand,
        emphasis: sticky.emphasis,
        format_preference: sticky.format_preference,
        floor_tolerance: sticky.floor_tolerance,
      },
      { onConflict: 'user_id' },
    );

  if (error) throw new Error(`Could not save preferences: ${error.message}`);
}

/**
 * The session the console should currently be showing, if any.
 *
 * Deliberately the same active-beats-planned rule as `currentSessionFor` on the
 * stage side, so the two screens can never disagree about which session is in
 * play. Used to make generation idempotent: pressing Generate twice returns the
 * session already sitting there rather than spending two minutes and a second
 * API call producing a duplicate.
 */
export async function findOpenSession(
  userId: string,
): Promise<{ id: string; status: string } | null> {
  const supabase = serviceClient();

  const { data: active } = await supabase
    .from('sessions')
    .select('id, status')
    .eq('user_id', userId)
    .eq('status', 'active')
    .maybeSingle();
  if (active) return active;

  const { data: planned } = await supabase
    .from('sessions')
    .select('id, status')
    .eq('user_id', userId)
    .eq('status', 'planned')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  return planned;
}
