/**
 * The wire contract between the television and the server.
 *
 * Shared by the route handlers and the stage client so the two cannot drift.
 * Types only — no runtime code, so the ES2015 fence over this directory costs
 * nothing here.
 */

import type { SessionPlan } from '../planner/schema';
import type { StageCommand } from './machine';

/** What the TV should be showing. Derived server-side from pairing + session. */
export type StageScreen =
  | 'pairing'
  | 'idle'
  | 'centering'
  | 'shape'
  | 'running'
  | 'complete';

export type CueLevel = 'off' | 'key' | 'full';

/* ---------------------------------------------------------------- *
 * POST /api/stage/pair — the TV asks for a code
 * ---------------------------------------------------------------- */

export type PairResponse = {
  code: string;
  expires_at: string;
  /**
   * The real credential. The 4-digit code is a display artefact for a human;
   * this is what authorises every later request. Also set as an HttpOnly
   * cookie — the client keeps a copy only as a fallback for TV browsers that
   * drop cookies, which is a failure we would otherwise have no way to
   * diagnose remotely.
   */
  stage_token: string;
};

/* ---------------------------------------------------------------- *
 * POST /api/stage/sync — the workhorse, every 750ms
 * ---------------------------------------------------------------- */

export type SyncCursor = {
  session_id: string;
  phase_index: number;
  phase: string;
  block_index: number;
  item_index: number;
  side: 'left' | 'right' | null;
  seconds_remaining: number;
  is_paused: boolean;
};

export type SyncRequest = {
  /** Present only on write beats (every 3rd sync ≈ 2.25s, per spec §4's ~2s). */
  state: SyncCursor | null;
  /** Acknowledges the command delivered on a previous sync, so it can be cleared. */
  claimed_command_id: string | null;
};

export type DeliveredCommand = {
  id: string;
  name: StageCommand;
  payload: Record<string, unknown> | null;
};

export type SyncResponse = {
  screen: StageScreen;
  /**
   * The pairing code, present only while unclaimed.
   *
   * Returned on every sync rather than only from /pair so the television never
   * has to REMEMBER it. A remount, a hot reload, or a set that reboots mid-pair
   * would otherwise strand the screen showing a placeholder with nothing to
   * type — which is exactly what happened the first time this was built.
   */
  code: string | null;
  session_id: string | null;
  session_status: string | null;
  cue_level: CueLevel;
  command: DeliveredCommand | null;
  /** For a rough clock-skew read in the debug HUD. */
  server_time: number;
};

/* ---------------------------------------------------------------- *
 * GET /api/stage/bundle — fetched once per session
 * ---------------------------------------------------------------- */

/**
 * Everything about one movement the stage needs to render it.
 *
 * This exists because the TV is unauthenticated and `exercise_catalog` is
 * `select ... to authenticated` — it cannot read a single catalog row directly,
 * so the server hands over exactly the fields the screen uses and nothing else.
 */
export type StageMovement = {
  id: string;
  name: string;
  cues: string[];
  setup_note: string | null;
  timing_type: string;
  unilateral: boolean;
  body_position: string;
  intensity: number;
  /** Null until artwork exists. The renderer branches on this, never on tier. */
  asset_url: string | null;
  asset_kind: 'image' | 'video' | null;
};

export type BundleResponse = {
  session: { id: string; requested_duration_min: number; status: string };
  plan: SessionPlan;
  movements: Record<string, StageMovement>;
  cue_level: CueLevel;
};

/* ---------------------------------------------------------------- *
 * Session lifecycle
 * ---------------------------------------------------------------- */

export type BeginRequest = { session_id: string };

export type PerformedItem = {
  block_index: number;
  item_index: number;
  side: 'left' | 'right' | null;
  exercise_id: string;
  prescribed_dose: number;
  completed_dose: number | null;
  rest_seconds: number;
  was_skipped: boolean;
};

export type CompleteRequest = {
  session_id: string;
  outcome: 'completed' | 'abandoned';
  performed: PerformedItem[];
};

/* ---------------------------------------------------------------- *
 * Console side
 * ---------------------------------------------------------------- */

export type ClaimRequest = { code: string };
export type CommandRequest = {
  session_id: string;
  command: StageCommand;
  payload?: Record<string, unknown>;
};

export const STAGE_TOKEN_COOKIE = 'sm_stage';
export const STAGE_TOKEN_HEADER = 'x-stage-token';
