/**
 * plan:check — health checks that need no API call.
 *
 * Two jobs:
 *   1. Every stored template still validates against the LIVE catalog, across a
 *      matrix of durations and constraints. Templates reference real
 *      `exercise_id`s, so a catalog change can silently break the one path that
 *      exists to guarantee "you always get a workout" — run this after every
 *      `catalog:import`.
 *   2. Every committed fixture reproduces the error it was built to trigger
 *      before repair, and has none left after. That's the validator's test
 *      suite, with no test-runner dependency, matching the house style.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import type { EQUIPMENT, REGIONS } from '../../src/lib/catalog/vocab';
import { buildSession } from '../../src/lib/planner';
import { expand } from '../../src/lib/planner/expand';
import { repairPlan } from '../../src/lib/planner/repair';
import { PlanDraftSchema, type Checkin } from '../../src/lib/planner/schema';
import { planErrors } from '../../src/lib/planner/validate';
import { DURATIONS, type Duration } from '../../src/lib/planner/vocab';
import { bold, dim, green, red, yellow } from '../catalog/lib/render';
import { fetchCatalog } from './lib/db';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const FIXTURE_DIR = join(HERE, 'fixtures');

type Equipment = (typeof EQUIPMENT)[number];
type Region = (typeof REGIONS)[number];

const EQUIPMENT_SCENARIOS: { label: string; equipment: Equipment[] }[] = [
  { label: 'bodyweight', equipment: [] },
  { label: 'mat', equipment: ['mat'] },
  { label: 'mat+wall+chair', equipment: ['mat', 'wall', 'chair'] },
  { label: 'full kit', equipment: ['mat', 'wall', 'chair', 'band', 'kettlebell', 'dumbbell'] },
];

const AVOID_SCENARIOS: { label: string; avoid: Region[] }[] = [
  { label: 'nothing', avoid: [] },
  { label: 'hip', avoid: ['hip'] },
  { label: 'shoulder', avoid: ['shoulder'] },
  { label: 'knee', avoid: ['knee'] },
];

function checkinFor(duration: Duration, equipment: Equipment[], avoid: Region[]): Checkin {
  return {
    duration_min: duration,
    energy: 'normal',
    focus: 'surprise',
    avoid_regions: avoid,
    equipment_on_hand: equipment,
    emphasis: 'full',
    format_preference: 'let_it_choose',
    floor_tolerance: 'fine',
    include_exercise_ids: [],
    exclude_exercise_ids: [],
    recent_exercise_ids: [],
  };
}

async function checkTemplates(catalog: Awaited<ReturnType<typeof fetchCatalog>>): Promise<number> {
  console.log(bold('\nTemplates against the live catalog'));
  let failures = 0;

  for (const duration of DURATIONS) {
    for (const equipmentScenario of EQUIPMENT_SCENARIOS) {
      for (const avoidScenario of AVOID_SCENARIOS) {
        const checkin = checkinFor(duration, equipmentScenario.equipment, avoidScenario.avoid);

        // Force the template path by handing buildSession a generator that fails.
        const result = await buildSession({
          checkin,
          catalog,
          generate: async () => {
            throw new Error('template check — generation deliberately skipped');
          },
        });

        const errors = result.findings.filter(
          (finding) => finding.code !== 'generation_failed' && !isAdvisory(finding.code),
        );
        const label = `${String(duration).padStart(2)}min · ${equipmentScenario.label.padEnd(15)} · avoid ${avoidScenario.label.padEnd(9)}`;
        const drift = (result.plan.totals.drift_pct * 100).toFixed(0);

        if (errors.length === 0) {
          console.log(`  ${green('ok  ')} ${label} ${dim(`${drift}% drift · ${result.source}`)}`);
        } else if (!result.feasibility.ok) {
          // The pool was already declared too thin, so the template is being
          // served with its findings recorded — the documented last resort, not
          // a broken template. Shown, but not a failure: asserting the
          // impossible is possible would make this check useless.
          console.log(
            `  ${yellow('thin')} ${label} ${dim(`pool too thin — ${errors.length} finding${errors.length === 1 ? '' : 's'} recorded`)}`,
          );
        } else {
          failures += 1;
          console.log(`  ${red('FAIL')} ${label} ${dim(result.source)}`);
          for (const error of errors) console.log(`         ${red(error.code)} ${error.message}`);
        }
      }
    }
  }

  return failures;
}

/**
 * Codes that are advisory by design. A template tripping one of these is
 * information, not a failure — the whole point of the warning tier.
 */
const ADVISORY = new Set([
  'avoided_region_secondary',
  'repeat_recency',
  'dose_out_of_band',
  'duplicate_within_session',
  'main_work_fraction',
  'transition_churn',
  'floor_round_trips',
  'no_antagonist_alternation',
  'nervous_system_late',
  'intensity_ramp',
  'consecutive_region_unavoidable',
  'pool_too_thin',
  'structural_failure',
]);

function isAdvisory(code: string): boolean {
  return ADVISORY.has(code);
}

/**
 * Fixtures are named `<expected_error_code>.draft.json`, so the filename is the
 * assertion — a fixture that stops reproducing its error is as much a
 * regression as one that stops being repairable.
 */
async function checkFixtures(catalog: Awaited<ReturnType<typeof fetchCatalog>>): Promise<number> {
  if (!existsSync(FIXTURE_DIR)) {
    console.log(dim('\nNo fixtures directory yet — skipping rule self-test.'));
    return 0;
  }

  const files = readdirSync(FIXTURE_DIR).filter((name) => name.endsWith('.draft.json'));
  if (files.length === 0) {
    console.log(dim('\nNo fixtures yet — skipping rule self-test.'));
    return 0;
  }

  console.log(bold('\nFixtures'));
  const catalogMap = new Map(catalog.map((row) => [row.id, row]));
  let failures = 0;

  for (const file of files) {
    const expected = file.replace('.draft.json', '');
    const raw = JSON.parse(readFileSync(join(FIXTURE_DIR, file), 'utf8'));
    const checkin: Checkin = raw.checkin ?? checkinFor(40, ['mat', 'wall', 'chair'], []);
    const draft = PlanDraftSchema.parse(raw.draft ?? raw);

    const before = expand(draft, {
      checkin,
      catalog: catalogMap,
      source: 'llm',
      model: null,
      promptVersion: 0,
    });
    const beforeErrors = planErrors(before, catalogMap);
    const reproduced = beforeErrors.some((finding) => finding.code === expected);

    const after = repairPlan(before, catalogMap);
    const afterErrors = after.remaining;

    if (!reproduced) {
      failures += 1;
      console.log(
        `  ${red('FAIL')} ${file} ${dim(`— expected "${expected}" before repair, saw: ${beforeErrors.map((f) => f.code).join(', ') || 'nothing'}`)}`,
      );
    } else if (afterErrors.length > 0 && !after.needsReprompt) {
      failures += 1;
      console.log(
        `  ${red('FAIL')} ${file} ${dim(`— still broken after repair: ${afterErrors.map((f) => f.code).join(', ')}`)}`,
      );
    } else {
      const outcome = after.needsReprompt ? 'escalates to re-prompt' : `${after.repairs.length} repairs`;
      console.log(`  ${green('ok  ')} ${file} ${dim(`— reproduced, then ${outcome}`)}`);
    }
  }

  return failures;
}

async function main() {
  const { values } = parseArgs({
    options: {
      templates: { type: 'boolean', default: false },
      fixtures: { type: 'boolean', default: false },
    },
  });
  const runAll = !values.templates && !values.fixtures;

  const catalog = await fetchCatalog();
  console.log(dim(`${catalog.length} catalog entries`));

  let failures = 0;
  if (runAll || values.templates) failures += await checkTemplates(catalog);
  if (runAll || values.fixtures) failures += await checkFixtures(catalog);

  if (failures > 0) {
    console.log(red(bold(`\n${failures} check${failures === 1 ? '' : 's'} failed`)));
    process.exit(1);
  }
  console.log(green(bold('\nall checks passed')));
}

main().catch((error: unknown) => {
  console.error(`\n${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
