/**
 * The check-in the phone submits, and how it becomes the check-in the planner
 * consumes.
 *
 * Two shapes, deliberately:
 *
 *   CheckinRequest — the eight things a human can actually touch.
 *   Checkin        — that, plus the three fields the SERVER resolves: the
 *                    include/exclude lists and the recency list.
 *
 * The split is a security boundary as much as a modelling one. `Checkin` is
 * stored verbatim into `sessions.checkin_input` and is what the model is shown,
 * so if the phone could post `recent_exercise_ids` or `exclude_exercise_ids`
 * directly it could rewrite the record of why a plan looks the way it does. The
 * request schema is `strictObject` for the same reason — an unknown key is a
 * rejection, not something quietly carried into storage.
 */

import { z } from 'zod';
import { EQUIPMENT, REGIONS } from '../catalog/vocab';
import type { Checkin } from '../planner/schema';
import {
  DURATIONS,
  EMPHASES,
  ENERGY_LEVELS,
  FLOOR_TOLERANCES,
  FOCUSES,
  FORMAT_PREFERENCES,
} from '../planner/vocab';

export const CheckinRequestSchema = z.strictObject({
  /* ---- asked every time (spec §6's four visible controls) ---- */
  duration_min: z.union([z.literal(15), z.literal(25), z.literal(40), z.literal(60)]),
  energy: z.enum(ENERGY_LEVELS),
  focus: z.enum(FOCUSES),
  avoid_regions: z.array(z.enum(REGIONS)),

  /* ---- sticky: shown collapsed under "more options" ---- */
  equipment_on_hand: z.array(z.enum(EQUIPMENT)),
  emphasis: z.enum(EMPHASES),
  format_preference: z.enum(FORMAT_PREFERENCES),
  floor_tolerance: z.enum(FLOOR_TOLERANCES),
});

export type CheckinRequest = z.infer<typeof CheckinRequestSchema>;

/** The sticky half, which is exactly what `user_preferences` stores. */
export type StickyCheckin = Pick<
  CheckinRequest,
  'equipment_on_hand' | 'emphasis' | 'format_preference' | 'floor_tolerance'
>;

/**
 * What a first-time check-in looks like.
 *
 * `surprise` and `normal` are defaults you can submit without thinking, which is
 * the point: the fastest path through this screen is four taps and Generate.
 * Equipment defaults to empty — claiming a kettlebell the user doesn't own would
 * produce a plan they can't do, and the failure would look like a bad plan
 * rather than a bad default.
 */
export const DEFAULT_CHECKIN: CheckinRequest = {
  duration_min: 25,
  energy: 'normal',
  focus: 'surprise',
  avoid_regions: [],
  equipment_on_hand: [],
  emphasis: 'full',
  format_preference: 'let_it_choose',
  floor_tolerance: 'fine',
};

/**
 * Fold the server-resolved fields in.
 *
 * The result is what gets stored whole into `sessions.checkin_input`, so a plan
 * can be explained months later — storing only what was tapped would leave the
 * preferences and the recency window that shaped it implicit.
 */
export function resolveCheckin(
  request: CheckinRequest,
  resolved: {
    include_exercise_ids: string[];
    exclude_exercise_ids: string[];
    recent_exercise_ids: string[];
  },
): Checkin {
  return {
    duration_min: request.duration_min,
    energy: request.energy,
    focus: request.focus,
    avoid_regions: request.avoid_regions,

    equipment_on_hand: request.equipment_on_hand,
    emphasis: request.emphasis,
    format_preference: request.format_preference,
    floor_tolerance: request.floor_tolerance,

    include_exercise_ids: resolved.include_exercise_ids,
    exclude_exercise_ids: resolved.exclude_exercise_ids,
    recent_exercise_ids: resolved.recent_exercise_ids,
  };
}

/**
 * Re-open a finished check-in as a form state.
 *
 * "Same again" is the single most likely thing to want on the morning after a
 * session that went well, and it costs one function because `Checkin` is a
 * superset of `CheckinRequest`.
 */
export function toRequest(checkin: Checkin): CheckinRequest {
  return {
    duration_min: checkin.duration_min,
    energy: checkin.energy,
    focus: checkin.focus,
    avoid_regions: checkin.avoid_regions,
    equipment_on_hand: checkin.equipment_on_hand,
    emphasis: checkin.emphasis,
    format_preference: checkin.format_preference,
    floor_tolerance: checkin.floor_tolerance,
  };
}

export { DURATIONS, FOCUSES };
