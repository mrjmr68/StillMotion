/**
 * Planner schemas.
 *
 * Same two-layer split as the catalog: `PlanDraftSchema` is what the LLM is
 * asked to produce and is deliberately structural only — no `.refine()`, because
 * refinements don't survive compilation to JSON Schema and would be a silent
 * no-op on the model side. Every cross-field rule runs in TypeScript afterwards,
 * in `planErrors()` / `planWarnings()`.
 */

import { z } from 'zod';
import type { Finding } from '../catalog/schema';
import { EQUIPMENT, REGIONS, type TIMING_TYPES } from '../catalog/vocab';
import {
  BLOCK_FORMATS,
  BLOCK_KINDS,
  EMPHASES,
  ENERGY_LEVELS,
  FLOOR_TOLERANCES,
  FOCUSES,
  FORMAT_PREFERENCES,
  PLAN_VERSION,
} from './vocab';

/* ------------------------------------------------------------------ *
 * Check-in — the planner's input
 * ------------------------------------------------------------------ */

/**
 * The RESOLVED check-in: the four visible controls (spec §6) plus a snapshot of
 * the sticky preferences and the recency list. Stored whole into
 * `sessions.checkin_input` so a plan can be reproduced months later — storing
 * only what the user tapped would leave the preferences that shaped it implicit.
 */
export const CheckinSchema = z.strictObject({
  duration_min: z.union([z.literal(15), z.literal(25), z.literal(40), z.literal(60)]),
  energy: z.enum(ENERGY_LEVELS),
  focus: z.enum(FOCUSES),
  avoid_regions: z.array(z.enum(REGIONS)),

  equipment_on_hand: z.array(z.enum(EQUIPMENT)),
  emphasis: z.enum(EMPHASES),
  format_preference: z.enum(FORMAT_PREFERENCES),
  floor_tolerance: z.enum(FLOOR_TOLERANCES),
  include_exercise_ids: z.array(z.string()),
  exclude_exercise_ids: z.array(z.string()),

  /** Ids from the last 3 sessions — Build 1's whole variety mechanism. */
  recent_exercise_ids: z.array(z.string()),
});

export type Checkin = z.infer<typeof CheckinSchema>;

/* ------------------------------------------------------------------ *
 * Draft — the LLM's output contract
 * ------------------------------------------------------------------ */

export const PlanDraftItemSchema = z.strictObject({
  exercise_id: z.string().min(1),
  /** Per SIDE when the movement is unilateral. Units implied by timing_type. */
  dose: z.number().int().positive(),
  /** Rest AFTER this item, in seconds. */
  rest_seconds: z.number().int().min(0),
});

export const PlanDraftBlockSchema = z.strictObject({
  kind: z.enum(BLOCK_KINDS),
  /** The TV's block card title. "Legs and lungs" beats "Circuit 2". */
  label: z.string().min(1),
  format: z.enum(BLOCK_FORMATS),
  /** How many times the item list repeats. 1 for prep and flow; 2-4 for circuits. */
  rounds: z.number().int().min(1).max(6),
  items: z.array(PlanDraftItemSchema).min(1),
});

export const PlanDraftSchema = z.strictObject({
  blocks: z.array(PlanDraftBlockSchema).min(2),
  /** One sentence of rationale. Metadata only — nothing branches on it. */
  intent: z.string().min(1),
});

export type PlanDraftItem = z.infer<typeof PlanDraftItemSchema>;
export type PlanDraftBlock = z.infer<typeof PlanDraftBlockSchema>;
export type PlanDraft = z.infer<typeof PlanDraftSchema>;

/* ------------------------------------------------------------------ *
 * Session plan — what gets stored and what the TV runs
 * ------------------------------------------------------------------ */

export const PLAN_SOURCES = [
  'llm',
  'llm_repaired',
  'llm_reprompt',
  'template',
  'template_degraded',
] as const;
export type PlanSource = (typeof PLAN_SOURCES)[number];

export type PlanItem = {
  /** Flat within the block, across rounds — matches `exercise_logs.item_index`. */
  index: number;
  /** 1-based; which repetition of the block's item list this is. */
  round: number;
  exercise_id: string;
  timing_type: (typeof TIMING_TYPES)[number];
  /** Per side. */
  dose: number;
  /**
   * One item covers both sides of a unilateral movement rather than being split
   * into two items — `exercise_logs.side` is a column in the unique key
   * `(session_id, block_index, item_index, side)`, not part of the index. This
   * makes "unilateral always schedules both sides, same dose" impossible to
   * violate rather than a rule to check.
   */
  sides: ['both'] | ['left', 'right'];
  /** Per side. What the countdown starts at. */
  work_seconds: number;
  rest_seconds: number;
  /** Computed lead-in before this item (position change, equipment, block card). */
  transition_seconds: number;
  intensity: number;
};

export type PlanBlock = {
  index: number;
  kind: (typeof BLOCK_KINDS)[number];
  label: string;
  format: (typeof BLOCK_FORMATS)[number];
  rounds: number;
  items: PlanItem[];
};

export type PlanTotals = {
  work_seconds: number;
  rest_seconds: number;
  transition_seconds: number;
  total_seconds: number;
  main_work_seconds: number;
  requested_seconds: number;
  /** (total - requested) / requested. Negative means short. */
  drift_pct: number;
};

export type RepairRecord = {
  code: string;
  scope: 'item' | 'block' | 'plan';
  block: number;
  item: number | null;
  from: string | null;
  to: string | null;
  detail: string;
};

export type SessionPlan = {
  version: number;
  source: PlanSource;
  template_id: string | null;
  generated_at: string;
  model: string | null;
  prompt_version: number;
  checkin: Checkin;
  intent: string;
  totals: PlanTotals;
  /** Warnings that survived repair. */
  findings: Finding[];
  repairs: RepairRecord[];
  blocks: PlanBlock[];
};

/** Re-exported so planner modules don't reach into the catalog for one type. */
export type { Finding };

export const CURRENT_PLAN_VERSION = PLAN_VERSION;
