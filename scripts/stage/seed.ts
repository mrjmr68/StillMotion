/**
 * stage:seed — insert a planned session for the stage to run against.
 *
 * Uses the template path (a deliberately-failing generator, the same trick
 * `plan:check` uses), so seeding is free, instant and deterministic. The
 * check-in console doesn't exist yet, so this is how a session gets onto the TV.
 *
 *   npm run stage:seed -- --user <uuid>
 *   npm run stage:seed -- --user <uuid> --duration 15 --equipment mat
 */

import { parseArgs } from 'node:util';
import { EQUIPMENT } from '../../src/lib/catalog/vocab';
import { buildSession } from '../../src/lib/planner';
import type { Checkin } from '../../src/lib/planner/schema';
import { DURATIONS, type Duration } from '../../src/lib/planner/vocab';
import { buildTimeline, timelineSeconds } from '../../src/lib/stage/timeline';
import { formatSeconds } from '../../src/lib/planner/budget';
import { bold, dim, green } from '../catalog/lib/render';
import { fetchCatalog, insertSession } from '../planner/lib/db';

async function main() {
  const { values } = parseArgs({
    options: {
      user: { type: 'string' },
      duration: { type: 'string', default: '40' },
      equipment: { type: 'string', multiple: true, default: [] },
    },
  });

  if (!values.user) throw new Error('--user <uuid> is required — the session needs an owner');

  const duration = Number(values.duration) as Duration;
  if (!DURATIONS.includes(duration)) {
    throw new Error(`--duration must be one of: ${DURATIONS.join(', ')}`);
  }
  for (const piece of values.equipment) {
    if (!EQUIPMENT.includes(piece as (typeof EQUIPMENT)[number])) {
      throw new Error(`--equipment must be one of: ${EQUIPMENT.join(', ')}`);
    }
  }

  const checkin: Checkin = {
    duration_min: duration,
    energy: 'normal',
    focus: 'surprise',
    avoid_regions: [],
    equipment_on_hand:
      values.equipment.length > 0
        ? (values.equipment as Checkin['equipment_on_hand'])
        : (['mat', 'wall', 'chair'] as Checkin['equipment_on_hand']),
    emphasis: 'full',
    format_preference: 'let_it_choose',
    floor_tolerance: 'fine',
    include_exercise_ids: [],
    exclude_exercise_ids: [],
    recent_exercise_ids: [],
  };

  const catalog = await fetchCatalog();
  const result = await buildSession({
    checkin,
    catalog,
    generate: async () => {
      throw new Error('stage:seed uses the template path — no API call');
    },
  });

  const id = await insertSession(values.user, checkin, result.plan);
  const timeline = buildTimeline(result.plan);

  console.log(green(bold(`\nseeded session ${id}`)));
  console.log(
    dim(
      `  ${result.source} · ${result.plan.blocks.length} blocks · ${timeline.length} phases · ` +
        `${formatSeconds(timelineSeconds(timeline))}`,
    ),
  );
  console.log(dim('  status: planned — the stage will show the session shape and wait for Begin'));
}

main().catch((error: unknown) => {
  console.error(`\n${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
