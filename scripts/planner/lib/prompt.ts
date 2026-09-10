/**
 * Planner prompt assembly, split on the caching boundary.
 *
 * System block = role, §7's rules verbatim, vocabulary, the output contract, and
 * the full catalog table. User message = today's check-in, plus (on the single
 * re-prompt only) the findings from the failed attempt.
 *
 * The catalog goes in the CACHED block deliberately. It only changes on a manual
 * `catalog:import` and it's by far the largest thing in the prompt, so it's the
 * only reason caching pays here at all. And the table is NOT pre-filtered by the
 * check-in's constraints: filtering would make the prefix vary per call, turning
 * every request into a cache write, and would trade a repairable error for a
 * permanent cache miss. Constraints are stated in words in the user message.
 *
 * Honest caveat: the ephemeral cache TTL is five minutes, so a real user
 * checking in once a day always misses. Caching buys fast CLI iteration, not
 * production savings — which is fine, since §7 says the 20-30s wait is a feature.
 */

import type { CatalogRow, Finding } from '../../../src/lib/catalog/schema';
import { catalogTable, SLIM_TABLE_COLUMNS } from '../../../src/lib/planner/slimTable';
import type { Checkin } from '../../../src/lib/planner/schema';
import {
  BALANCE_FOCUS_NOTE,
  BLOCK_FORMATS,
  BLOCK_KINDS,
  FOCUS_LABELS,
  MAIN_WORK_MIN_FRACTION,
  MAX_CONSECUTIVE_SHARED_REGION,
  SECONDS_PER_BREATH,
  TIME_TOLERANCE,
} from '../../../src/lib/planner/vocab';

export const PLANNER_PROMPT_VERSION = 1;

export function buildSystemPrompt(catalog: CatalogRow[]): string {
  return `You design one workout session at a time for a personal training system.

The session runs on a TV with no supervision: once it starts, nothing can be
changed except by the person moving. So the session has to be right when you
hand it over.

## Session architecture — non-negotiable

Every session runs ${BLOCK_KINDS.join(' → ')}. These rules are not style
preferences; a validator re-checks each one and will rewrite your plan if it
fails.

- Joint prep and breath come before load. Warm-up is specific to what is
  actually coming, not a generic routine.
- Nervous-system-demanding work — balance, complex patterns, power, anything
  unilateral — goes early while the body is fresh.
- Conditioning comes after strength, never before.
- Never load a joint overhead before it has been taken through range. If the
  session presses, carries, or holds anything overhead, an earlier item must
  have moved the shoulder through range unloaded.
- No more than ${MAX_CONSECUTIVE_SHARED_REGION} consecutive items may share a
  primary region.
- Within a circuit, alternate upper/lower or agonist/antagonist so local fatigue
  doesn't end the set before the timer does.
- The hardest work is not in the final 15% of the session.
- Main work must be at least ${Math.round(MAIN_WORK_MIN_FRACTION * 100)}% of the
  session. Mobility and breath items may bookend the session or fill rest — they
  never count as main work.
- Keep position changes down. Flipping standing→floor→standing repeatedly feels
  bad, and the validator scores it.
- Close parasympathetic: the last block down-regulates.

## Output contract

Blocks, each with items. Rules that are easy to get wrong:

- \`rounds\` multiplies the item list. A circuit of 4 items at 3 rounds is 12
  items of work — you do NOT repeat the items yourself.
- \`dose\` is PER SIDE for unilateral movements. The runtime schedules both
  sides automatically; never write an item twice for left and right.
- \`dose\` units follow the movement's \`timing\` column: seconds for duration
  and hold_per_side, a count for reps and breaths (a breath is about
  ${SECONDS_PER_BREATH} seconds).
- \`rest_seconds\` is rest AFTER that item.
- Total session time must land within ${Math.round(TIME_TOLERANCE * 100)}% of
  what was requested. Rest and transitions count toward it.
- \`label\` is what the TV shows on the block card — name it for what it does
  ("Legs and lungs"), not "Circuit 2".
- \`intent\` is one sentence about why this session is shaped the way it is.

Block kinds: ${BLOCK_KINDS.join(', ')}. Formats: ${BLOCK_FORMATS.join(', ')}.

## You may only use ids from this table

Every \`exercise_id\` must appear in the first column below. Do not invent
movements, do not use names where an id belongs, and do not use any movement not
listed — the catalog is the complete set of what this system can show on screen.

Columns: ${SLIM_TABLE_COLUMNS.split('\t').join(' · ')}
(\`uni\` = U for unilateral; \`cap\` = the soft-cap seconds for a reps item.)

${catalogTable(catalog)}`;
}

export function buildUserPrompt(checkin: Checkin, priorFindings?: Finding[]): string {
  const lines: string[] = [];

  lines.push(`Design a ${checkin.duration_min}-minute session.`);
  lines.push('');
  lines.push(`Energy today: ${checkin.energy}`);
  lines.push(`Focus: ${FOCUS_LABELS[checkin.focus]}`);
  if (checkin.focus === 'balance') lines.push(BALANCE_FOCUS_NOTE);

  if (checkin.avoid_regions.length > 0) {
    lines.push(
      `Avoid today: ${checkin.avoid_regions.join(', ')}. Do not use any movement whose PRIMARY regions include these. Secondary involvement is acceptable.`,
    );
  }

  lines.push(
    checkin.equipment_on_hand.length > 0
      ? `Equipment on hand: ${checkin.equipment_on_hand.join(', ')}. Anything needing equipment not on this list is unusable.`
      : 'No equipment at all — bodyweight only.',
  );

  lines.push(`Emphasis: ${checkin.emphasis.replace('_', ' ')}`);
  if (checkin.format_preference !== 'let_it_choose') {
    lines.push(`Preferred format: ${checkin.format_preference.replace('_', ' ')}`);
  }
  if (checkin.floor_tolerance === 'minimize_floor') {
    lines.push('Minimise getting up and down: prefer standing and seated work.');
  }

  if (checkin.include_exercise_ids.length > 0) {
    lines.push(`Include if it fits: ${checkin.include_exercise_ids.join(', ')}`);
  }
  if (checkin.exclude_exercise_ids.length > 0) {
    lines.push(`Never use: ${checkin.exclude_exercise_ids.join(', ')}`);
  }

  if (checkin.recent_exercise_ids.length > 0) {
    lines.push('');
    lines.push(
      `Used in the last 3 sessions — prefer something else unless it genuinely serves this session:\n${checkin.recent_exercise_ids.map((id) => `- ${id}`).join('\n')}`,
    );
  }

  if (priorFindings && priorFindings.length > 0) {
    lines.push('');
    lines.push('Your previous attempt failed these checks. Fix them:');
    for (const finding of priorFindings) lines.push(`- ${finding.code}: ${finding.message}`);
  }

  return lines.join('\n');
}
