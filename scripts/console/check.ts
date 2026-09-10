/**
 * console:check — the phone's health checks. No network for the pure half, no
 * API key, no browser.
 *
 * Third in the same family as `plan:check` and `stage:check`, and pointed at the
 * two places the console can be wrong in ways a glance at the screen would not
 * reveal:
 *
 *   1. The check-in contract. The console builds the object the planner
 *      consumes and the object that gets stored as the permanent record of why
 *      a plan looks the way it does. If it can produce one the planner rejects,
 *      the failure lands two minutes into generation, after the user has already
 *      answered everything.
 *
 *   2. The mirror. The phone locates itself in the session by replaying the
 *      SAME timeline the television runs and indexing into it with
 *      `phase_index`. A mirror that lands on the wrong phase does not look
 *      broken — it looks like a confident, wrong label on the movement you are
 *      in the middle of, which is worse.
 */

import {
  CheckinRequestSchema,
  DEFAULT_CHECKIN,
  resolveCheckin,
  toRequest,
  type CheckinRequest,
} from '../../src/lib/console/checkin';
import { mirrorView, tickedSeconds } from '../../src/lib/console/mirror';
import { magicLinkOrigin } from '../../src/lib/console/origin';
import { buildSession } from '../../src/lib/planner';
import { CheckinSchema, type Checkin } from '../../src/lib/planner/schema';
import {
  DURATIONS,
  ENERGY_LEVELS,
  FOCUSES,
  type Duration,
} from '../../src/lib/planner/vocab';
import { toCursor } from '../../src/lib/stage/cursor';
import { buildTimeline } from '../../src/lib/stage/timeline';
import { bold, dim, green, red } from '../catalog/lib/render';
import { fetchCatalog } from '../planner/lib/db';

type Failure = { scenario: string; problem: string };

const failures: Failure[] = [];

function expect(scenario: string, condition: boolean, problem: string): void {
  if (condition) return;
  failures.push({ scenario, problem });
  console.log(`  ${red('fail')} ${scenario}`);
  console.log(`         ${dim(problem)}`);
}

/** Key order is an implementation detail; value equality is not. */
function stable(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'undefined';
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  return `{${entries.map(([key, held]) => `${JSON.stringify(key)}:${stable(held)}`).join(',')}}`;
}

/* ------------------------------------------------------------------ *
 * 1. The check-in contract
 * ------------------------------------------------------------------ */

function checkCheckin(): void {
  console.log(bold('\nCheck-in contract'));
  let checked = 0;

  expect(
    'the default check-in is valid',
    CheckinRequestSchema.safeParse(DEFAULT_CHECKIN).success,
    'DEFAULT_CHECKIN does not satisfy its own schema',
  );

  const avoidSets: CheckinRequest['avoid_regions'][] = [
    [],
    ['knee'],
    ['shoulder', 'wrist'],
    ['ankle', 'knee', 'hip', 'spine', 'shoulder', 'elbow', 'wrist', 'neck', 'core'],
  ];

  for (const duration of DURATIONS) {
    for (const energy of ENERGY_LEVELS) {
      for (const focus of FOCUSES) {
        for (const avoid of avoidSets) {
          const request: CheckinRequest = {
            ...DEFAULT_CHECKIN,
            duration_min: duration,
            energy,
            focus,
            avoid_regions: avoid,
          };
          const label = `${duration}min · ${energy} · ${focus} · avoid ${avoid.length}`;

          expect(
            `${label} — the form's own schema accepts it`,
            CheckinRequestSchema.safeParse(request).success,
            'a value the UI can produce failed its schema',
          );

          // The one that matters: whatever the phone can submit must be
          // something the planner will accept.
          const resolved = resolveCheckin(request, {
            include_exercise_ids: ['squat_goblet_squat'],
            exclude_exercise_ids: ['gait_bear_crawl'],
            recent_exercise_ids: ['hinge_single_leg_glute_bridge'],
          });
          const planner = CheckinSchema.safeParse(resolved);
          expect(
            `${label} — the planner accepts the resolved check-in`,
            planner.success,
            planner.success ? '' : JSON.stringify(planner.error.issues[0]),
          );

          // "Same again" has to be a true round trip, or re-opening yesterday's
          // check-in would quietly answer a question differently than you did.
          expect(
            `${label} — reopening the stored check-in round-trips`,
            stable(toRequest(resolved)) === stable(request),
            `${stable(toRequest(resolved))} !== ${stable(request)}`,
          );

          checked += 1;
        }
      }
    }
  }

  /*
   * The security half of the two-shape split.
   *
   * `recent_exercise_ids` and the include/exclude lists are the record of WHY a
   * plan looks the way it does. They are resolved on the server, and a phone
   * that could post them could rewrite that record — so the schema has to
   * reject them rather than ignore them.
   */
  for (const smuggled of [
    'recent_exercise_ids',
    'include_exercise_ids',
    'exclude_exercise_ids',
  ]) {
    const body = { ...DEFAULT_CHECKIN, [smuggled]: ['squat_goblet_squat'] };
    expect(
      `a submitted ${smuggled} is rejected, not ignored`,
      !CheckinRequestSchema.safeParse(body).success,
      'the request schema accepted a server-resolved field from the client',
    );
  }

  expect(
    'an unknown duration is rejected',
    !CheckinRequestSchema.safeParse({ ...DEFAULT_CHECKIN, duration_min: 30 }).success,
    'a duration with no template was accepted',
  );

  console.log(`  ${green('ok')}   ${checked} check-in combinations · resolve · round trip`);
}

/* ------------------------------------------------------------------ *
 * 2. The mirror
 * ------------------------------------------------------------------ */

type EquipmentList = Checkin['equipment_on_hand'];

const EQUIPMENT_SCENARIOS: { label: string; equipment: EquipmentList }[] = [
  { label: 'bodyweight', equipment: [] },
  { label: 'mat', equipment: ['mat'] },
  { label: 'mat+wall+chair', equipment: ['mat', 'wall', 'chair'] },
  { label: 'full kit', equipment: ['mat', 'wall', 'chair', 'band', 'kettlebell', 'dumbbell'] },
];

const AVOID_SCENARIOS: { label: string; avoid: Checkin['avoid_regions'] }[] = [
  { label: 'nothing', avoid: [] },
  { label: 'hip', avoid: ['hip'] },
  { label: 'shoulder', avoid: ['shoulder'] },
  { label: 'knee', avoid: ['knee'] },
];

function checkinFor(
  duration: Duration,
  equipment: EquipmentList,
  avoid: Checkin['avoid_regions'],
): Checkin {
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

async function checkMirror(
  catalog: Awaited<ReturnType<typeof fetchCatalog>>,
): Promise<void> {
  console.log(bold('\nMirror'));
  let checked = 0;

  for (const duration of DURATIONS) {
    for (const equipmentScenario of EQUIPMENT_SCENARIOS) {
      for (const avoidScenario of AVOID_SCENARIOS) {
        const label = `${String(duration).padStart(2)}min · ${equipmentScenario.label} · avoid ${avoidScenario.label}`;
        const checkin = checkinFor(
          duration,
          equipmentScenario.equipment,
          avoidScenario.avoid,
        );

        // The template path — a deliberately-failing generator, the same trick
        // plan:check and stage:check use. Free, instant, deterministic.
        const { plan } = await buildSession({
          checkin,
          catalog,
          generate: async () => {
            throw new Error('console:check uses the template path — no API call');
          },
        });

        const timeline = buildTimeline(plan);
        let previousProgress = -1;
        let mislocated = 0;
        let wrongKind = 0;
        let wrongDone = 0;
        let unnamed = 0;
        let regressed = 0;

        for (const phase of timeline) {
          const cursor = toCursor(phase);
          const view = mirrorView(plan, timeline, {
            phase_index: cursor.phase_index,
            phase: cursor.phase,
            current_block_index: cursor.block_index,
            current_item_index: cursor.item_index,
            side: cursor.side,
            seconds_remaining: phase.seconds,
            is_paused: false,
          });

          if (!view.phase || view.phase.index !== phase.index) mislocated += 1;
          if (view.resting !== (phase.kind === 'rest' || phase.kind === 'transition')) {
            wrongKind += 1;
          }
          if (view.canDone !== (phase.kind === 'work' && phase.softCap)) wrongDone += 1;
          if (!view.movementId) unnamed += 1;
          if (view.progress < previousProgress) regressed += 1;
          previousProgress = view.progress;
        }

        expect(`${label} — every phase is located exactly`, mislocated === 0, `${mislocated} phases resolved to the wrong index`);
        expect(`${label} — rest and work are told apart`, wrongKind === 0, `${wrongKind} phases mislabelled`);
        expect(`${label} — Done is offered only on reps work`, wrongDone === 0, `${wrongDone} phases disagreed with the soft cap`);
        expect(`${label} — every phase names a movement`, unnamed === 0, `${unnamed} phases had nothing to show`);
        expect(`${label} — progress never goes backwards`, regressed === 0, `${regressed} phases regressed`);

        /*
         * At the very start, with the first phase untouched, the time left has
         * to be the whole session. This is the mirror's half of the identity
         * stage:check asserts on the timeline: if the phone says "38 minutes
         * left" on a 40-minute session, one of the two is lying about the
         * budget the planner promised.
         */
        const first = timeline[0];
        const atStart = mirrorView(plan, timeline, {
          phase_index: 0,
          phase: first.kind,
          current_block_index: first.blockIndex,
          current_item_index: first.itemIndex,
          side: null,
          seconds_remaining: first.seconds,
          is_paused: false,
        });
        expect(
          `${label} — time left at the start is the whole session`,
          atStart.sessionSecondsLeft === plan.totals.total_seconds,
          `${atStart.sessionSecondsLeft}s vs ${plan.totals.total_seconds}s`,
        );

        checked += 1;
      }
    }
  }

  console.log(`  ${green('ok')}   ${checked} scenarios · every phase located, labelled and counted`);
}

/* ------------------------------------------------------------------ *
 * 3. The interpolated countdown
 * ------------------------------------------------------------------ */

function checkTicking(): void {
  console.log(bold('\nCountdown interpolation'));

  const running = { secondsRemaining: 30, paused: false } as ReturnType<typeof mirrorView>;
  const paused = { secondsRemaining: 30, paused: true } as ReturnType<typeof mirrorView>;

  expect('a fresh read shows what the TV said', tickedSeconds(running, 0) === 30, 'drifted at zero');
  expect(
    'the mirror carries the clock forward between reads',
    tickedSeconds(running, 8_400) === 22,
    `got ${tickedSeconds(running, 8_400)}`,
  );
  expect(
    'a paused clock does not move',
    tickedSeconds(paused, 60_000) === 30,
    `a paused mirror slid to ${tickedSeconds(paused, 60_000)}`,
  );
  expect(
    'a stale read floors at zero rather than going negative',
    tickedSeconds(running, 600_000) === 0,
    `got ${tickedSeconds(running, 600_000)}`,
  );
  expect(
    'a clock that went backwards is ignored',
    tickedSeconds(running, -5_000) === 30,
    `got ${tickedSeconds(running, -5_000)}`,
  );

  console.log(`  ${green('ok')}   5 interpolation fixtures`);
}

/* ------------------------------------------------------------------ *
 * 4. The magic-link origin
 * ------------------------------------------------------------------ */

function checkOrigin(): void {
  console.log(bold('\nMagic-link origin'));
  const configured = 'http://localhost:3000';

  const cases: { host: string | null; proto: string | null; expect: string; why: string }[] = [
    {
      host: '192.168.0.13:3000',
      proto: null,
      expect: 'http://192.168.0.13:3000',
      why: 'a link asked for on the phone must come back to this machine, not the phone',
    },
    { host: 'localhost:3000', proto: null, expect: 'http://localhost:3000', why: 'loopback is itself' },
    { host: '127.0.0.1:3000', proto: null, expect: 'http://127.0.0.1:3000', why: 'loopback by address' },
    { host: '10.0.0.7:3000', proto: null, expect: 'http://10.0.0.7:3000', why: '10/8 is private' },
    { host: '172.16.4.2:3000', proto: null, expect: 'http://172.16.4.2:3000', why: '172.16/12 is private' },
    { host: '172.31.4.2:3000', proto: null, expect: 'http://172.31.4.2:3000', why: 'top of the 172 range' },
    {
      host: '172.32.4.2:3000',
      proto: null,
      expect: configured,
      why: '172.32 is PUBLIC — a lazy prefix match would trust it',
    },
    {
      host: 'evil.example.com',
      proto: null,
      expect: configured,
      why: 'a forged Host must not steer where the sign-in link points',
    },
    {
      host: '192.168.0.13.evil.com',
      proto: null,
      expect: configured,
      why: 'a private address as a subdomain prefix is not a private address',
    },
    { host: null, proto: null, expect: configured, why: 'no Host at all falls back' },
    {
      host: '192.168.0.13:3000',
      proto: 'https',
      expect: 'https://192.168.0.13:3000',
      why: 'a proxied https origin is preserved',
    },
  ];

  for (const testCase of cases) {
    const actual = magicLinkOrigin(testCase.host, testCase.proto, configured);
    expect(
      `${testCase.host ?? '(no host)'} — ${testCase.why}`,
      actual === testCase.expect,
      `got ${actual}, wanted ${testCase.expect}`,
    );
  }

  console.log(`  ${green('ok')}   ${cases.length} host cases · private trusted, public refused`);
}

async function main() {
  checkCheckin();
  checkOrigin();
  checkTicking();

  const catalog = await fetchCatalog();
  console.log(dim(`\n${catalog.length} catalog entries`));
  await checkMirror(catalog);

  if (failures.length > 0) {
    console.log(red(bold(`\n${failures.length} check${failures.length === 1 ? '' : 's'} failed`)));
    process.exit(1);
  }
  console.log(green(bold('\nall checks passed')));
}

main().catch((error: unknown) => {
  console.error(`\n${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
