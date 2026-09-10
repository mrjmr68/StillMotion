import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  CheckinRequestSchema,
  DEFAULT_CHECKIN,
  toRequest,
  type CheckinRequest,
  type StickyCheckin,
} from "@/lib/console/checkin";
import type { Checkin, SessionPlan } from "@/lib/planner/schema";
import type { CueLevel } from "@/lib/stage/contract";
import ConsoleRoot, { type ConsoleBoot, type ConsoleSession } from "./ConsoleRoot";

/**
 * The console's first paint.
 *
 * Everything the phone needs to render the right screen is read here, on the
 * server, under the user's OWN key — no service role anywhere in this file.
 * That is not incidental: if any of these reads came back empty the RLS policies
 * would be wrong, so the console loading correctly is a standing check that the
 * phone can see its own data and nothing else.
 *
 * It also means the first frame is already the right screen. Deriving it on the
 * client would show the check-in form for a beat before flipping to a running
 * session, which on a phone you have just picked up mid-workout is the single
 * most confusing thing this app could do.
 */

/** A finished session stops asking to be rated after this long. */
const FEEDBACK_WINDOW_MS = 6 * 60 * 60 * 1000;

type SessionRow = {
  id: string;
  status: string;
  plan_generated: unknown;
  checkin_input: unknown;
  requested_duration_min: number;
  rating: string | null;
  note: string | null;
  completed_at: string | null;
};

export default async function AppHomePage() {
  const supabase = await createClient();

  /*
   * The proxy already redirects an unauthenticated /app, so this is a second
   * lock on the same door — but it is also what validates the JWT before the
   * reads below run under it. Without it, an expired session would produce five
   * empty result sets and a console that looks like a brand new account rather
   * than a signed-out one, which is the worst way to fail.
   */
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims || !claims.claims) redirect("/login");

  const [pairing, preferences, sessions, catalog] = await Promise.all([
    supabase
      .from("pairings")
      .select("id")
      .is("revoked_at", null)
      .not("claimed_at", "is", null)
      .limit(1)
      .maybeSingle(),
    supabase
      .from("user_preferences")
      .select("equipment_on_hand, emphasis, format_preference, floor_tolerance, cue_level")
      .maybeSingle(),
    supabase
      .from("sessions")
      .select(
        "id, status, plan_generated, checkin_input, requested_duration_min, rating, note, completed_at",
      )
      .order("created_at", { ascending: false })
      .limit(5),
    // 91 rows of id and name. The plan stores exercise ids, and a console that
    // showed `hinge_single_leg_glute_bridge` would be unusable.
    supabase.from("exercise_catalog").select("id, name"),
  ]);

  const rows = (sessions.data ?? []) as unknown as SessionRow[];
  const open =
    rows.find((row) => row.status === "active") ??
    rows.find((row) => row.status === "planned") ??
    null;

  const session: ConsoleSession | null = open
    ? {
        id: open.id,
        status: open.status,
        plan: open.plan_generated as SessionPlan,
        requested_duration_min: open.requested_duration_min,
      }
    : null;

  const newest = rows[0];
  const unrated = open ? null : unratedFeedback(newest);

  const sticky: StickyCheckin | null = preferences.data
    ? {
        equipment_on_hand: preferences.data
          .equipment_on_hand as StickyCheckin["equipment_on_hand"],
        emphasis: preferences.data.emphasis as StickyCheckin["emphasis"],
        format_preference: preferences.data
          .format_preference as StickyCheckin["format_preference"],
        floor_tolerance: preferences.data.floor_tolerance as StickyCheckin["floor_tolerance"],
      }
    : null;

  const boot: ConsoleBoot = {
    paired: pairing.data !== null,
    sticky,
    lastCheckin: lastCheckinOf(newest, sticky),
    session,
    feedback: unrated,
    cueLevel: (preferences.data?.cue_level as CueLevel) ?? "key",
    names: Object.fromEntries(
      ((catalog.data ?? []) as { id: string; name: string }[]).map((row) => [row.id, row.name]),
    ),
  };

  return <ConsoleRoot boot={boot} />;
}

/**
 * A session that ended and was never rated.
 *
 * Only the most recent one, and only within the window — a rating prompt for a
 * workout you did on Tuesday is not a prompt, it is an obstacle between you and
 * today's check-in.
 *
 * Reading the clock lives here rather than in the component body: a server
 * component renders once, so it is safe in fact, but "impure call during render"
 * is a rule worth keeping unbroken rather than exempted case by case.
 */
function unratedFeedback(
  newest: SessionRow | undefined,
): { id: string; outcome: string; minutes: number } | null {
  if (!newest) return null;
  if (newest.status !== "completed" && newest.status !== "abandoned") return null;
  if (newest.rating !== null || newest.note !== null) return null;
  if (newest.completed_at === null) return null;
  if (Date.now() - Date.parse(newest.completed_at) >= FEEDBACK_WINDOW_MS) return null;

  return {
    id: newest.id,
    outcome: newest.status,
    minutes: newest.requested_duration_min,
  };
}

/**
 * Re-open the last check-in as today's starting point.
 *
 * Validated rather than trusted: `checkin_input` is stored as jsonb and outlives
 * the code that wrote it, so a session from before a vocabulary change would
 * otherwise put an option in the form that no longer exists — and the failure
 * would land at Generate, after the user had already answered everything.
 */
function lastCheckinOf(
  newest: SessionRow | undefined,
  sticky: StickyCheckin | null,
): CheckinRequest | null {
  const fallback = sticky ? { ...DEFAULT_CHECKIN, ...sticky } : null;
  if (!newest) return fallback;

  const parsed = CheckinRequestSchema.safeParse(toRequest(newest.checkin_input as Checkin));
  return parsed.success ? parsed.data : fallback;
}
