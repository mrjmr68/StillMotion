/**
 * Stored fallback sessions (spec §7: "If that fails, serve a stored template
 * session for the requested duration").
 *
 * Stored as `PlanDraft`, not `SessionPlan`, on purpose: a template then runs the
 * *identical* expand → validate → repair path as a generated plan, so it gets
 * FITTED to the check-in — equipment substitutions, dose trims for a flat day —
 * rather than served rigidly. Costs nothing extra and turns "a canned workout"
 * into "a canned skeleton, adapted."
 *
 * Composition is bodyweight + mat only. Bodyweight alone is 12 catalog entries,
 * too thin to build from; bodyweight-or-mat is 46 entries with 14 main-work,
 * which is enough. `mat` is the closest thing to universally available.
 *
 * These reference real `exercise_id`s, so a catalog change can silently break
 * them. `npm run plan:check` validates every template against the LIVE catalog
 * across a matrix of durations and constraints — run it after every
 * `catalog:import`.
 */

import type { PlanDraft } from './schema';
import type { Duration } from './vocab';

const PREPARE_CORE = {
  kind: 'prepare' as const,
  label: 'Wake the joints',
  format: 'flow' as const,
  rounds: 1,
};

const DOWN_REGULATE_CORE = {
  kind: 'down_regulate' as const,
  label: 'Settle',
  format: 'flow' as const,
  rounds: 1,
};

export const TEMPLATES: Record<Duration, PlanDraft> = {
  15: {
    intent: 'A short, floor-friendly session that still earns its keep.',
    blocks: [
      {
        ...PREPARE_CORE,
        items: [
          { exercise_id: 'rotate_cat_cow', dose: 8, rest_seconds: 0 },
          { exercise_id: 'ground_transition_quadruped_rock_back', dose: 10, rest_seconds: 0 },
        ],
      },
      {
        kind: 'main',
        label: 'Push, hinge, move',
        format: 'circuit',
        rounds: 3,
        items: [
          { exercise_id: 'push_h_push_up', dose: 8, rest_seconds: 20 },
          { exercise_id: 'hinge_single_leg_glute_bridge', dose: 8, rest_seconds: 20 },
          { exercise_id: 'gait_lateral_step_out', dose: 40, rest_seconds: 25 },
        ],
      },
      {
        ...DOWN_REGULATE_CORE,
        items: [
          { exercise_id: 'hinge_child_s_pose', dose: 45, rest_seconds: 0 },
          { exercise_id: 'anti_rotate_diaphragmatic_breathing', dose: 8, rest_seconds: 0 },
        ],
      },
    ],
  },

  25: {
    intent: 'Full-body strength with a proper open and close.',
    blocks: [
      {
        ...PREPARE_CORE,
        items: [
          { exercise_id: 'rotate_cat_cow', dose: 8, rest_seconds: 0 },
          { exercise_id: 'ground_transition_quadruped_rock_back', dose: 10, rest_seconds: 0 },
          { exercise_id: 'hinge_tall_kneeling_hip_hinge', dose: 10, rest_seconds: 0 },
        ],
      },
      {
        kind: 'main',
        label: 'Strength circuit',
        format: 'circuit',
        rounds: 3,
        items: [
          { exercise_id: 'push_h_push_up', dose: 10, rest_seconds: 25 },
          { exercise_id: 'hinge_single_leg_glute_bridge', dose: 10, rest_seconds: 25 },
          { exercise_id: 'pull_v_prone_superman_hold', dose: 30, rest_seconds: 25 },
          { exercise_id: 'anti_rotate_side_plank', dose: 25, rest_seconds: 30 },
        ],
      },
      {
        ...DOWN_REGULATE_CORE,
        items: [
          { exercise_id: 'rotate_supine_spinal_twist', dose: 30, rest_seconds: 0 },
          { exercise_id: 'hinge_child_s_pose', dose: 45, rest_seconds: 0 },
          { exercise_id: 'anti_rotate_diaphragmatic_breathing', dose: 8, rest_seconds: 0 },
        ],
      },
    ],
  },

  40: {
    intent: 'Strength first while fresh, conditioning after, then a long close.',
    blocks: [
      {
        ...PREPARE_CORE,
        items: [
          { exercise_id: 'anti_rotate_diaphragmatic_breathing', dose: 8, rest_seconds: 0 },
          { exercise_id: 'rotate_cat_cow', dose: 8, rest_seconds: 0 },
          { exercise_id: 'ground_transition_quadruped_rock_back', dose: 10, rest_seconds: 0 },
          { exercise_id: 'hinge_tall_kneeling_hip_hinge', dose: 10, rest_seconds: 0 },
        ],
      },
      {
        kind: 'main',
        label: 'Strength circuit',
        format: 'circuit',
        rounds: 3,
        items: [
          { exercise_id: 'push_h_push_up', dose: 10, rest_seconds: 30 },
          { exercise_id: 'hinge_single_leg_glute_bridge', dose: 10, rest_seconds: 30 },
          { exercise_id: 'pull_v_prone_superman_hold', dose: 30, rest_seconds: 30 },
          { exercise_id: 'anti_rotate_side_plank', dose: 25, rest_seconds: 30 },
        ],
      },
      {
        kind: 'main',
        label: 'Move and breathe hard',
        format: 'circuit',
        // Hardest item first within the block. Spec §7 wants conditioning after
        // strength AND the hardest work out of the final 15% — with a
        // conditioning block closing the session those collide, and ordering the
        // block so it ENDS on the easier movement satisfies both.
        rounds: 2,
        items: [
          { exercise_id: 'ground_transition_bear_crawl', dose: 40, rest_seconds: 30 },
          { exercise_id: 'gait_lateral_shuffle', dose: 40, rest_seconds: 40 },
        ],
      },
      {
        ...DOWN_REGULATE_CORE,
        items: [
          { exercise_id: 'rotate_supine_spinal_twist', dose: 40, rest_seconds: 0 },
          { exercise_id: 'hinge_low_lunge', dose: 30, rest_seconds: 0 },
          { exercise_id: 'hinge_child_s_pose', dose: 60, rest_seconds: 0 },
          { exercise_id: 'anti_rotate_diaphragmatic_breathing', dose: 8, rest_seconds: 0 },
        ],
      },
    ],
  },

  60: {
    intent: 'A full hour: unhurried prep, two work blocks, a long down-regulate.',
    blocks: [
      {
        ...PREPARE_CORE,
        items: [
          { exercise_id: 'anti_rotate_diaphragmatic_breathing', dose: 8, rest_seconds: 0 },
          { exercise_id: 'rotate_cat_cow', dose: 8, rest_seconds: 0 },
          { exercise_id: 'ground_transition_quadruped_rock_back', dose: 10, rest_seconds: 0 },
          { exercise_id: 'rotate_thread_the_needle', dose: 30, rest_seconds: 0 },
          { exercise_id: 'hinge_tall_kneeling_hip_hinge', dose: 10, rest_seconds: 0 },
        ],
      },
      {
        kind: 'main',
        label: 'Strength circuit',
        format: 'circuit',
        rounds: 4,
        items: [
          { exercise_id: 'push_h_push_up', dose: 10, rest_seconds: 30 },
          { exercise_id: 'hinge_single_leg_glute_bridge', dose: 10, rest_seconds: 30 },
          { exercise_id: 'pull_v_prone_superman_hold', dose: 30, rest_seconds: 30 },
          { exercise_id: 'anti_rotate_side_plank', dose: 25, rest_seconds: 35 },
        ],
      },
      {
        kind: 'main',
        label: 'Move and breathe hard',
        format: 'circuit',
        rounds: 3,
        items: [
          { exercise_id: 'gait_lateral_shuffle', dose: 40, rest_seconds: 30 },
          { exercise_id: 'ground_transition_bear_crawl', dose: 40, rest_seconds: 30 },
          { exercise_id: 'gait_crab_walk', dose: 40, rest_seconds: 40 },
        ],
      },
      {
        ...DOWN_REGULATE_CORE,
        items: [
          { exercise_id: 'rotate_supine_spinal_twist', dose: 40, rest_seconds: 0 },
          { exercise_id: 'hinge_low_lunge', dose: 30, rest_seconds: 0 },
          { exercise_id: 'rotate_sphinx_pose', dose: 45, rest_seconds: 0 },
          { exercise_id: 'hinge_child_s_pose', dose: 60, rest_seconds: 0 },
          { exercise_id: 'anti_rotate_box_breathing', dose: 8, rest_seconds: 0 },
        ],
      },
    ],
  },
};

export function templateFor(duration: Duration): PlanDraft {
  return structuredClone(TEMPLATES[duration]);
}

export function templateId(duration: Duration): string {
  return `template_${duration}`;
}
