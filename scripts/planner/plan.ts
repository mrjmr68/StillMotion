/**
 * plan — generate a session and show it.
 *
 *   npm run plan -- --dry-run                       # assemble the prompt, no API call
 *   npm run plan -- --duration 40 --focus strength
 *   npm run plan -- --from-file fixtures/x.draft.json   # no API call, exercise the validator
 *   npm run plan -- --duration 25 --commit --user <uuid>
 *
 * Dry of the database by default; `--commit` is required to insert a session,
 * mirroring `catalog:import`.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { EQUIPMENT, REGIONS } from '../../src/lib/catalog/vocab';
import { buildSession } from '../../src/lib/planner';
import { PlanDraftSchema, type Checkin, type PlanDraft } from '../../src/lib/planner/schema';
import {
  DURATIONS,
  EMPHASES,
  ENERGY_LEVELS,
  FLOOR_TOLERANCES,
  FOCUSES,
  FORMAT_PREFERENCES,
  type Duration,
} from '../../src/lib/planner/vocab';
import { bold, dim, red, yellow } from '../catalog/lib/render';
import { lastUsage, makeGenerator, type Effort } from './lib/anthropic';
import { fetchCatalog, fetchPreferences, fetchRecency, insertSession } from './lib/db';
import { buildSystemPrompt, buildUserPrompt, PLANNER_PROMPT_VERSION } from './lib/prompt';
import { renderPlan } from './lib/render';

const EFFORTS: Effort[] = ['low', 'medium', 'high', 'xhigh', 'max'];

function parse() {
  const { values } = parseArgs({
    options: {
      duration: { type: 'string', default: '40' },
      energy: { type: 'string', default: 'normal' },
      focus: { type: 'string', default: 'surprise' },
      avoid: { type: 'string', multiple: true, default: [] },
      equipment: { type: 'string', multiple: true, default: [] },
      emphasis: { type: 'string', default: 'full' },
      format: { type: 'string', default: 'let_it_choose' },
      'floor-tolerance': { type: 'string', default: 'fine' },
      user: { type: 'string' },
      recent: { type: 'string' },
      effort: { type: 'string', default: 'high' },
      'dry-run': { type: 'boolean', default: false },
      'from-file': { type: 'string' },
      'save-draft': { type: 'string' },
      'no-repair': { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
      commit: { type: 'boolean', default: false },
    },
  });

  const duration = Number(values.duration) as Duration;
  if (!DURATIONS.includes(duration)) {
    throw new Error(`--duration must be one of: ${DURATIONS.join(', ')}`);
  }
  const oneOf = <T extends string>(value: string, allowed: readonly T[], flag: string): T => {
    if (!allowed.includes(value as T)) {
      throw new Error(`--${flag} must be one of: ${allowed.join(', ')}`);
    }
    return value as T;
  };
  for (const region of values.avoid) {
    if (!REGIONS.includes(region as (typeof REGIONS)[number])) {
      throw new Error(`--avoid must be one of: ${REGIONS.join(', ')}`);
    }
  }
  for (const piece of values.equipment) {
    if (!EQUIPMENT.includes(piece as (typeof EQUIPMENT)[number])) {
      throw new Error(`--equipment must be one of: ${EQUIPMENT.join(', ')}`);
    }
  }
  if (!EFFORTS.includes(values.effort as Effort)) {
    throw new Error(`--effort must be one of: ${EFFORTS.join(', ')}`);
  }
  if (values.commit && !values.user) {
    throw new Error('--commit needs --user <uuid> to own the session');
  }

  return {
    duration,
    energy: oneOf(values.energy, ENERGY_LEVELS, 'energy'),
    focus: oneOf(values.focus, FOCUSES, 'focus'),
    avoid: values.avoid as (typeof REGIONS)[number][],
    // Default kit: what almost any room has.
    equipment:
      values.equipment.length > 0
        ? (values.equipment as (typeof EQUIPMENT)[number][])
        : (['mat', 'wall', 'chair'] as (typeof EQUIPMENT)[number][]),
    emphasis: oneOf(values.emphasis, EMPHASES, 'emphasis'),
    format: oneOf(values.format, FORMAT_PREFERENCES, 'format'),
    floorTolerance: oneOf(values['floor-tolerance'], FLOOR_TOLERANCES, 'floor-tolerance'),
    user: values.user ?? null,
    recent: values.recent ? values.recent.split(',').map((s) => s.trim()) : null,
    effort: values.effort as Effort,
    dryRun: values['dry-run'],
    fromFile: values['from-file'] ?? null,
    saveDraft: values['save-draft'] ?? null,
    repair: !values['no-repair'],
    json: values.json,
    commit: values.commit,
  };
}

async function main() {
  const args = parse();
  const catalog = await fetchCatalog();

  // Preferences from the DB when a user is named; CLI flags otherwise.
  const stored = args.user ? await fetchPreferences(args.user) : null;
  const recent = args.recent ?? (args.user ? await fetchRecency(args.user) : []);

  const checkin: Checkin = {
    duration_min: args.duration,
    energy: args.energy,
    focus: args.focus,
    avoid_regions: args.avoid,
    equipment_on_hand: stored?.equipment_on_hand ?? args.equipment,
    emphasis: stored?.emphasis ?? args.emphasis,
    format_preference: stored?.format_preference ?? args.format,
    floor_tolerance: stored?.floor_tolerance ?? args.floorTolerance,
    include_exercise_ids: stored?.include_exercise_ids ?? [],
    exclude_exercise_ids: stored?.exclude_exercise_ids ?? [],
    recent_exercise_ids: recent,
  };

  if (args.dryRun) {
    const system = buildSystemPrompt(catalog);
    const user = buildUserPrompt(checkin);
    console.log('───────── SYSTEM (cached prefix) ─────────');
    console.log(system);
    console.log('\n───────── USER (volatile) ─────────');
    console.log(user);
    console.log(
      `\n  ~${Math.ceil((system.length + user.length) / 4)} input tokens (rough char/4 estimate)`,
    );
    console.log('  dry run — no API call made, nothing written');
    return;
  }

  // --from-file replays a committed draft so the validator and repairer can be
  // exercised without paying for generation.
  let savedDraft: PlanDraft | null = null;
  const generate = args.fromFile
    ? async () => {
        const parsed = PlanDraftSchema.parse(
          JSON.parse(readFileSync(args.fromFile as string, 'utf8')),
        );
        return { draft: parsed, model: `fixture:${args.fromFile}` };
      }
    : (() => {
        const real = makeGenerator(args.effort);
        return async (a: Parameters<ReturnType<typeof makeGenerator>>[0]) => {
          const result = await real(a);
          savedDraft = result.draft;
          return result;
        };
      })();

  const result = await buildSession({
    checkin,
    catalog,
    generate,
    promptVersion: PLANNER_PROMPT_VERSION,
    repair: args.repair,
  });

  if (args.saveDraft && savedDraft) {
    writeFileSync(args.saveDraft, `${JSON.stringify(savedDraft, null, 2)}\n`, 'utf8');
    console.log(dim(`draft written to ${args.saveDraft}`));
  }

  if (args.json) {
    console.log(JSON.stringify(result.plan, null, 2));
    return;
  }

  console.log();
  console.log(renderPlan(result.plan, new Map(catalog.map((row) => [row.id, row]))));

  if (lastUsage) {
    console.log(
      dim(
        `\n  ${lastUsage.seconds.toFixed(1)}s · ${lastUsage.input} in / ${lastUsage.output} out · ` +
          `cache ${lastUsage.cacheRead} read, ${lastUsage.cacheWrite} written`,
      ),
    );
  }
  if (result.generationError) {
    console.log(red(`\n  generation failed: ${result.generationError}`));
  }
  if (!result.feasibility.ok) {
    console.log(
      yellow(
        `\n  pool too thin: ${result.feasibility.shortfalls.join('; ')} — served a template instead`,
      ),
    );
  }

  if (args.commit && args.user) {
    const id = await insertSession(args.user, checkin, result.plan);
    console.log(bold(`\n  session ${id} inserted (status: planned)`));
  } else {
    console.log(dim('\n  nothing written — add --commit --user <uuid> to save this session'));
  }
}

main().catch((error: unknown) => {
  console.error(`\n${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
