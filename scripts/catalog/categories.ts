/**
 * The batch plan. This file is DATA — edit the counts and briefs freely.
 *
 * Batching is by `movement_pattern` rather than `modality` because the planner
 * selects by pattern (so coverage targets are naturally per-pattern), the
 * slot-key dedupe is pattern-scoped, and a single pattern is a tight enough
 * brief that the model stays on task. The one exception is `breath_yoga`,
 * which is modality-driven since those movements spread across several
 * patterns.
 *
 * Order matters: low-intensity, foundational batches come first so that later
 * batches have real, already-drafted movements to name as regressions.
 *
 * Every brief asks for a spread of `body_position`. The planner's validator
 * penalizes standing-to-floor-to-standing churn, so a catalog where everything
 * is `standing` would starve it of options.
 */

import type { Equipment, Modality, MovementPattern } from '../../src/lib/catalog/vocab';

export type Category = {
  /** CLI name, and the review filename stem. */
  id: string;
  label: string;
  targetCount: number;
  /** Patterns entries in this batch may use. Usually one. */
  patterns: MovementPattern[];
  /** Modalities to favor, when the batch is modality-led rather than pattern-led. */
  modalities?: Modality[];
  allowedEquipment: Equipment[];
  brief: string;
};

export const CATEGORIES: Category[] = [
  {
    id: 'breath_yoga',
    label: 'Breath & yoga',
    targetCount: 8,
    patterns: ['hinge', 'ground_transition', 'anti_rotate', 'rotate'],
    modalities: ['breath', 'yoga', 'mobility'],
    allowedEquipment: ['mat', 'wall'],
    brief: [
      'Breathwork and yoga-derived shapes used to open a session (joint prep, down-regulation)',
      'or close it (parasympathetic). Include diaphragmatic and cadenced breathing done supine,',
      'seated, and quadruped, plus familiar yoga shapes (cat-cow, child pose, downward dog,',
      'low lunge). Favor timing_type "breaths" or "duration". Intensity should mostly be 1-2.',
      'Exclude anything loaded or explosive, and anything requiring a kettlebell or dumbbell.',
    ].join(' '),
  },
  {
    id: 'ground_transition',
    label: 'Ground transitions',
    targetCount: 6,
    patterns: ['ground_transition'],
    allowedEquipment: ['mat'],
    brief: [
      'Getting to and from the floor with control: rolling, rocking, kneeling-to-standing,',
      'get-up components, crawling entries. These are the movements that make floor work',
      'accessible rather than dreaded. Spread across supine, prone, quadruped, and kneeling.',
      'Prefer reps or duration. Exclude the full Turkish get-up (too multi-plane to render',
      'as a single still at Tier 0) — its individual segments are welcome.',
    ].join(' '),
  },
  {
    id: 'hinge',
    label: 'Hip hinge',
    targetCount: 8,
    patterns: ['hinge'],
    allowedEquipment: ['kettlebell', 'dumbbell', 'mat', 'wall', 'band'],
    brief: [
      'Hip-dominant flexion and extension with a neutral spine: deadlift variants, RDLs,',
      'good mornings, hip bridges, swings, and hinge-pattern teaching drills against a wall.',
      'Span the intensity range — include unloaded patterning drills at intensity 1-2 as well',
      'as loaded bilateral and single-leg work at 4-5. Include at least one supine bridge',
      'variant and one wall-assisted teaching drill so the batch is not all standing.',
    ].join(' '),
  },
  {
    id: 'squat',
    label: 'Squat',
    targetCount: 8,
    patterns: ['squat'],
    allowedEquipment: ['kettlebell', 'dumbbell', 'chair', 'wall', 'band'],
    brief: [
      'Knee-dominant bilateral flexion: bodyweight squats, goblet squats, box/chair squats,',
      'wall-supported squats, deep squat holds, and tempo variants. Include a chair-assisted',
      'regression and a deep-squat mobility hold. Vary depth and support rather than only load.',
      'Split-stance work belongs in the lunge batch, not here.',
    ].join(' '),
  },
  {
    id: 'lunge',
    label: 'Lunge & split stance',
    targetCount: 6,
    patterns: ['lunge'],
    allowedEquipment: ['kettlebell', 'dumbbell', 'chair', 'wall', 'mat'],
    brief: [
      'Split-stance and single-leg knee-dominant work: forward, reverse, and lateral lunges,',
      'split squats, step-ups, Cossack squats, and half-kneeling positions. Nearly all of these',
      'are unilateral — set unilateral true and give default_dose PER SIDE. Include at least one',
      'half-kneeling or kneeling-position entry.',
    ].join(' '),
  },
  {
    id: 'push_h',
    label: 'Horizontal push',
    targetCount: 6,
    patterns: ['push_h'],
    allowedEquipment: ['dumbbell', 'mat', 'wall', 'band'],
    brief: [
      'Pressing away from the torso in the transverse plane: push-ups and their regressions',
      '(wall, incline, knee), floor presses, band presses, and plank-to-push transitions.',
      'Include a wall or incline regression at intensity 1-2 and at least one prone entry.',
    ].join(' '),
  },
  {
    id: 'push_v',
    label: 'Vertical push',
    targetCount: 6,
    patterns: ['push_v'],
    allowedEquipment: ['kettlebell', 'dumbbell', 'wall', 'band', 'mat'],
    brief: [
      'Pressing overhead: strict presses, half-kneeling and tall-kneeling presses, wall slides,',
      'and overhead mobility prep. IMPORTANT — the spec forbids loading a joint overhead before',
      'it has been taken through range, so include at least two unloaded shoulder-prep entries',
      '(wall slides, overhead reaches) that a planner can schedule before the loaded work.',
    ].join(' '),
  },
  {
    id: 'pull_h',
    label: 'Horizontal pull',
    targetCount: 5,
    patterns: ['pull_h'],
    allowedEquipment: ['kettlebell', 'dumbbell', 'band', 'chair', 'mat'],
    brief: [
      'Drawing toward the torso in the transverse plane: rows in all their forms (bent-over,',
      'single-arm supported, band, prone), plus prone scapular retraction work. Include at least',
      'one prone floor entry and one chair-supported single-arm row.',
    ].join(' '),
  },
  {
    id: 'pull_v',
    label: 'Vertical pull',
    targetCount: 5,
    patterns: ['pull_v'],
    allowedEquipment: ['band', 'mat', 'wall', 'dumbbell'],
    brief: [
      'Drawing down from overhead: band pulldowns, prone lat activation, scapular work, and',
      'hanging variants. This pattern is the hardest to serve without a pull-up bar, so lean on',
      'band and prone-position work rather than assuming a bar exists.',
    ].join(' '),
  },
  {
    id: 'rotate',
    label: 'Rotation',
    targetCount: 6,
    patterns: ['rotate'],
    allowedEquipment: ['kettlebell', 'dumbbell', 'band', 'mat'],
    brief: [
      'Producing rotation through the trunk with control: chops, lifts, band rotations, thoracic',
      'rotations, windmills, and open-book style mobility. Distinguish thoracic mobility work',
      '(low intensity, mobility modality) from loaded power rotation (higher intensity, strength).',
      'Include at least one supine or side-lying thoracic entry.',
    ].join(' '),
  },
  {
    id: 'anti_rotate',
    label: 'Anti-rotation & bracing',
    targetCount: 6,
    patterns: ['anti_rotate'],
    allowedEquipment: ['kettlebell', 'dumbbell', 'band', 'mat'],
    brief: [
      'Resisting rotation and extension: Pallof presses, planks and side planks, bird dogs,',
      'dead bugs, suitcase holds, and renegade-row style stability work. Mostly duration or',
      'hold_per_side rather than reps. Spread across prone, supine, quadruped, and standing.',
    ].join(' '),
  },
  {
    id: 'carry',
    label: 'Loaded carry',
    targetCount: 4,
    patterns: ['carry'],
    allowedEquipment: ['kettlebell', 'dumbbell'],
    brief: [
      'Walking under load: farmer, suitcase, racked, and overhead carries. All standing, all',
      'duration-timed. Keep the batch small but distinct — the differences that matter are load',
      'position (which changes the bracing demand), not distance. Overhead carries assume the',
      'shoulder has already been prepared.',
    ].join(' '),
  },
  {
    id: 'gait',
    label: 'Gait & capacity',
    targetCount: 5,
    patterns: ['gait'],
    allowedEquipment: ['mat'],
    brief: [
      'Locomotion and conditioning done in place or over short distance: marching, skipping,',
      'step-outs, crawling, shuttle steps, and low-impact cardio intervals. Modality is usually',
      '"capacity". Duration-timed. Keep impact moderate — no plyometric depth jumps.',
    ].join(' '),
  },
];

export function findCategory(id: string): Category | undefined {
  return CATEGORIES.find((category) => category.id === id);
}

export const TOTAL_TARGET = CATEGORIES.reduce((sum, c) => sum + c.targetCount, 0);
