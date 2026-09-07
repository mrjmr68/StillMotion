/**
 * Prompt assembly, split along the caching boundary.
 *
 * The render order is system → messages, so the system block is the cacheable
 * prefix. Everything stable (role, vocabulary, field semantics, style rules,
 * exemplars) lives there; everything that varies per call (the category brief,
 * the target count, the existing-entry digest) goes in the user message, after
 * the breakpoint.
 *
 * Bump PROMPT_VERSION whenever the system block changes materially — it is
 * recorded in each review file so you can tell which entries came from which
 * instructions.
 */

import {
  BODY_POSITIONS,
  CUES_MAX,
  CUES_MIN,
  CUE_MAX_WORDS,
  DOSE_BANDS,
  EQUIPMENT,
  INTENSITY_MAX,
  INTENSITY_MIN,
  MODALITIES,
  MOVEMENT_PATTERNS,
  REGIONS,
  TIMING_TYPES,
} from '../../../src/lib/catalog/vocab';
import type { Category } from '../categories';

export const PROMPT_VERSION = 1;

const list = (values: readonly string[]) => values.join(', ');

export function buildSystemPrompt(): string {
  return `You are drafting entries for the movement catalog of a personal training system.

Entries are generated from established exercise-science and movement taxonomy, then
reviewed by hand before anything is used. Your drafts should be good enough that the
reviewer is editing, not rewriting.

Two hard rules:
1. You select from the fixed vocabulary below. You never invent a vocabulary value.
2. You draft real, well-established movements. You do not invent exercises.

## Vocabulary

modality: ${list(MODALITIES)}
movement_pattern: ${list(MOVEMENT_PATTERNS)}
primary_regions / secondary_regions: ${list(REGIONS)}
equipment: ${list(EQUIPMENT)} (empty array means bodyweight — there is no "none" value)
body_position: ${list(BODY_POSITIONS)}
timing_type: ${list(TIMING_TYPES)}

## Field semantics

- name — the common, recognizable name. Title case. No brand or gym-slang names.
- aka — other names the same movement genuinely goes by. Empty array if none.
  Be thorough here: aliases are how the system detects that two drafts are the
  same movement, so a missing alias creates a duplicate nobody catches.
- primary_regions — the joints/areas doing the work. At least one, rarely more
  than three. secondary_regions — meaningfully involved but not the target. A
  region must not appear in both.
- equipment — everything genuinely required. If a movement is done lying or
  kneeling on the floor, include "mat".
- body_position — the position the movement is performed IN, not the position it
  passes through. A get-up that starts supine and ends standing is a
  ground_transition; pick the position that dominates.
- unilateral — true when the movement trains one side at a time and the other
  side must be scheduled separately. The runtime schedules both sides itself.
- timing_type and default_dose:
    duration       → default_dose is SECONDS the movement is held or repeated for
    reps           → default_dose is a REP COUNT
    breaths        → default_dose is a BREATH COUNT
    hold_per_side  → default_dose is SECONDS held on EACH side
  **For any unilateral movement, default_dose is PER SIDE.** 8 reps unilateral
  means 8 on each side. Do not halve it to express a total.
  Typical bands (stay inside these unless the movement genuinely warrants otherwise):
${TIMING_TYPES.map((t) => `    ${t.padEnd(14)} ${DOSE_BANDS[t].min}-${DOSE_BANDS[t].max} ${DOSE_BANDS[t].unit}`).join('\n')}
- rep_cap_seconds — ONLY for timing_type "reps"; null otherwise. It is the
  wall-clock ceiling for the WHOLE set, not the time for one rep. The screen
  advances automatically at this cap if the user has not tapped Done. Roughly
  four seconds per rep is a sane starting point.
- intensity — ${INTENSITY_MIN} to ${INTENSITY_MAX}. ${INTENSITY_MIN} is restorative breathing or gentle mobility;
  ${INTENSITY_MAX} is genuinely hard loaded or high-output work. Spread the batch across the
  range rather than clustering in the middle.
- setup_note — what to have ready or arrange before the clip starts, one short
  sentence. Null when nothing is needed.
- progression_hint / regression_hint — the NAME of a harder / easier movement,
  as a plain string, or null. Do not invent ids. Naming a movement that is not
  in this batch is fine and expected.
- pairs_well_with_hints / avoid_after_hints — NAMES of movements that sequence
  well after this one, or that this one should not directly follow (usually
  because they fatigue the same tissue). Empty arrays are fine.

## Coaching cues

${CUES_MIN}-${CUES_MAX} cues per movement. These are displayed on a TV read from ten feet away
while the user is moving, so they must be instantly parseable:

- Under ${CUE_MAX_WORDS} words. Imperative. Exactly one idea per cue.
- Say what to DO, not what to avoid, wherever possible.
- No anatomy lecture, no rep counting, no motivational filler.

Good:  "Ribs down." / "Push the floor away." / "Slow on the way back."
Bad:   "Keep your ribs down and brace your core." (two ideas)
Bad:   "Maintain a neutral lumbar spine throughout the movement." (jargon, too long)
Bad:   "You've got this!" (says nothing)

## Two worked examples

{
  "name": "Kettlebell Romanian Deadlift",
  "aka": ["KB RDL", "Romanian Deadlift"],
  "modality": "strength",
  "movement_pattern": "hinge",
  "primary_regions": ["hip", "spine"],
  "secondary_regions": ["knee", "shoulder"],
  "equipment": ["kettlebell"],
  "body_position": "standing",
  "unilateral": false,
  "timing_type": "reps",
  "default_dose": 8,
  "rep_cap_seconds": 40,
  "intensity": 3,
  "cues": ["Push your hips back.", "Ribs down.", "Slow on the way down."],
  "setup_note": "One kettlebell within reach.",
  "progression_hint": "Single-Leg Romanian Deadlift",
  "regression_hint": "Hip Hinge to Wall",
  "pairs_well_with_hints": ["Goblet Squat"],
  "avoid_after_hints": ["Kettlebell Swing"]
}

{
  "name": "Cat-Cow",
  "aka": ["Cat-Camel", "Marjaryasana-Bitilasana"],
  "modality": "mobility",
  "movement_pattern": "rotate",
  "primary_regions": ["spine"],
  "secondary_regions": ["shoulder", "hip"],
  "equipment": ["mat"],
  "body_position": "quadruped",
  "unilateral": false,
  "timing_type": "breaths",
  "default_dose": 6,
  "rep_cap_seconds": null,
  "intensity": 1,
  "cues": ["Move with your breath.", "Start from your tailbone."],
  "setup_note": null,
  "progression_hint": null,
  "regression_hint": null,
  "pairs_well_with_hints": ["Child Pose", "Bird Dog"],
  "avoid_after_hints": []
}`;
}

export function buildUserPrompt(options: {
  category: Category;
  count: number;
  digest: string[];
}): string {
  const { category, count, digest } = options;

  const patterns =
    category.patterns.length === 1
      ? `Use movement_pattern "${category.patterns[0]}" for every entry.`
      : `Use one of these movement_pattern values for each entry: ${list(category.patterns)}.`;

  const modalities = category.modalities
    ? `Favor these modalities: ${list(category.modalities)}.`
    : '';

  const equipment =
    category.allowedEquipment.length > 0
      ? `Equipment available for this batch: ${list(category.allowedEquipment)} (bodyweight is always available).`
      : 'This batch is bodyweight only.';

  const avoid =
    digest.length > 0
      ? `\n## Already in the catalog — do NOT draft these or any synonym of them\n\n${digest.map((line) => `- ${line}`).join('\n')}\n`
      : '';

  return `Draft ${count} entries for the "${category.label}" batch.

${category.brief}

${patterns}
${modalities}
${equipment}

Spread the batch across body positions and across the intensity range. Entries
should be meaningfully different from each other — two movements that share a
pattern, body position, equipment, and intensity are the same slot, and the
planner will experience them as the same movement.
${avoid}`;
}
