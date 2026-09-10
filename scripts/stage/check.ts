/**
 * stage:check — the stage's health checks. No network, no API key, no browser.
 *
 * Two jobs, mirroring `scripts/planner/check.ts` in structure and output:
 *
 *   1. Timeline invariants across the same template matrix `plan:check` uses.
 *      The load-bearing one is `sum(phase.seconds) === totals.total_seconds` —
 *      that is what keeps the planner's ±10% duration guarantee true at
 *      RUNTIME. If the TV counts down differently from what the validator
 *      budgeted, the guarantee is silently false and nothing would tell you.
 *
 *   2. State-machine behaviour, driven by a fake clock. Everything spec §8
 *      promises about pause, skip, +30s and the reps soft cap is asserted here
 *      rather than discovered on a television with no devtools.
 */

import { buildSession } from '../../src/lib/planner';
import type { Checkin } from '../../src/lib/planner/schema';
import { DURATIONS, type Duration } from '../../src/lib/planner/vocab';
import { fromCursor, toCursor } from '../../src/lib/stage/cursor';
import {
  ADD_SECONDS,
  advance,
  apply,
  currentPhase,
  initial,
  isPaused,
  remainingSeconds,
} from '../../src/lib/stage/machine';
import { buildTimeline, timelineSeconds, type Phase } from '../../src/lib/stage/timeline';
import { bold, dim, green, red } from '../catalog/lib/render';
import { fetchCatalog } from '../planner/lib/db';

type EquipmentList = Checkin['equipment_on_hand'];
type RegionList = Checkin['avoid_regions'];

const EQUIPMENT_SCENARIOS: { label: string; equipment: EquipmentList }[] = [
  { label: 'bodyweight', equipment: [] },
  { label: 'mat', equipment: ['mat'] },
  { label: 'mat+wall+chair', equipment: ['mat', 'wall', 'chair'] },
  { label: 'full kit', equipment: ['mat', 'wall', 'chair', 'band', 'kettlebell', 'dumbbell'] },
];

const AVOID_SCENARIOS: { label: string; avoid: RegionList }[] = [
  { label: 'nothing', avoid: [] },
  { label: 'hip', avoid: ['hip'] },
  { label: 'shoulder', avoid: ['shoulder'] },
  { label: 'knee', avoid: ['knee'] },
];

function checkinFor(duration: Duration, equipment: EquipmentList, avoid: RegionList): Checkin {
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

type Failure = { scenario: string; problem: string };

async function checkTimelines(
  catalog: Awaited<ReturnType<typeof fetchCatalog>>,
): Promise<Failure[]> {
  console.log(bold('\nTimeline invariants'));
  const failures: Failure[] = [];
  let checked = 0;

  for (const duration of DURATIONS) {
    for (const equipmentScenario of EQUIPMENT_SCENARIOS) {
      for (const avoidScenario of AVOID_SCENARIOS) {
        const label = `${String(duration).padStart(2)}min · ${equipmentScenario.label} · avoid ${avoidScenario.label}`;
        const checkin = checkinFor(duration, equipmentScenario.equipment, avoidScenario.avoid);

        // Template path — the same deliberately-failing generator plan:check
        // uses, so this costs nothing and is deterministic.
        const result = await buildSession({
          checkin,
          catalog,
          generate: async () => {
            throw new Error('stage check — generation deliberately skipped');
          },
        });

        const plan = result.plan;
        const timeline = buildTimeline(plan);
        const problems: string[] = [];

        // THE assertion. Everything else is secondary to this one.
        const timelineTotal = timelineSeconds(timeline);
        if (timelineTotal !== plan.totals.total_seconds) {
          problems.push(
            `timeline is ${timelineTotal}s but plan totals say ${plan.totals.total_seconds}s`,
          );
        }

        for (const phase of timeline) {
          if (phase.seconds <= 0) {
            problems.push(`phase ${phase.index} (${phase.kind}) has ${phase.seconds}s`);
            break;
          }
        }

        // Every reps work phase soft-caps; nothing else does.
        for (const phase of timeline) {
          if (phase.kind !== 'work') continue;
          const item = plan.blocks[phase.blockIndex].items.find((i) => i.index === phase.itemIndex);
          if (!item) {
            problems.push(`phase ${phase.index} references a missing item`);
            break;
          }
          const shouldSoftCap = item.timing_type === 'reps';
          if (phase.softCap !== shouldSoftCap) {
            problems.push(
              `phase ${phase.index} softCap=${phase.softCap} but timing_type=${item.timing_type}`,
            );
            break;
          }
        }

        // Unilateral items must produce work(L) → side_switch → work(R).
        for (const block of plan.blocks) {
          for (const item of block.items) {
            if (item.sides.length !== 2) continue;
            const mine = timeline.filter(
              (p) => p.blockIndex === block.index && p.itemIndex === item.index,
            );
            const shape = mine.filter((p) => p.kind !== 'transition' && p.kind !== 'rest');
            const ok =
              shape.length === 3 &&
              shape[0].kind === 'work' &&
              shape[0].side === 'left' &&
              shape[1].kind === 'side_switch' &&
              shape[2].kind === 'work' &&
              shape[2].side === 'right';
            if (!ok) {
              problems.push(
                `unilateral item ${block.index}/${item.index} expanded to [${shape.map((p) => `${p.kind}:${p.side}`).join(', ')}]`,
              );
              break;
            }
          }
          if (problems.length > 0) break;
        }

        // The cursor must round-trip, or a mid-session reload resumes in the
        // wrong place — silently.
        for (const phase of timeline) {
          const recovered = fromCursor(timeline, toCursor(phase));
          if (recovered !== phase.index) {
            problems.push(`cursor round-trip failed: phase ${phase.index} came back as ${recovered}`);
            break;
          }
        }

        checked += 1;
        if (problems.length > 0) {
          failures.push({ scenario: label, problem: problems[0] });
          console.log(`  ${red('FAIL')} ${label}`);
          for (const problem of problems) console.log(`         ${red(problem)}`);
        }
      }
    }
  }

  if (failures.length === 0) {
    console.log(`  ${green('ok')}   ${checked} scenarios · timelines sum to plan totals`);
  }
  return failures;
}

/* ------------------------------------------------------------------ *
 * State machine, on a fake clock
 * ------------------------------------------------------------------ */

function fakeTimeline(): Phase[] {
  const make = (
    index: number,
    kind: Phase['kind'],
    seconds: number,
    itemIndex: number,
    side: Phase['side'],
    softCap: boolean,
  ): Phase => ({
    index,
    kind,
    blockIndex: 0,
    itemIndex,
    exerciseId: `ex_${itemIndex}`,
    seconds,
    side,
    softCap,
    dose: 10,
    intensity: 3,
    round: 1,
  });

  return [
    make(0, 'work', 30, 0, 'both', false), // pure timer
    make(1, 'rest', 20, 0, 'both', false),
    make(2, 'work', 40, 1, 'both', true), // reps, soft cap
    make(3, 'rest', 20, 1, 'both', false),
    make(4, 'work', 25, 2, 'left', false), // unilateral
    make(5, 'side_switch', 5, 2, 'right', false),
    make(6, 'work', 25, 2, 'right', false),
    make(7, 'rest', 15, 2, 'both', false),
  ];
}

function checkMachine(): Failure[] {
  console.log(bold('\nState machine'));
  const timeline = fakeTimeline();
  const failures: Failure[] = [];

  const expect = (name: string, condition: boolean, detail: string) => {
    if (condition) {
      console.log(`  ${green('ok')}   ${name}`);
    } else {
      failures.push({ scenario: name, problem: detail });
      console.log(`  ${red('FAIL')} ${name} ${dim('— ' + detail)}`);
    }
  };

  // A pure timer auto-advances at zero.
  {
    let s = initial(timeline, 0, 0);
    s = advance(s, timeline, 29_000);
    const stillFirst = s.phaseIndex === 0;
    s = advance(s, timeline, 30_000);
    expect(
      'a duration phase advances itself at zero',
      stillFirst && s.phaseIndex === 1,
      `landed on ${s.phaseIndex}`,
    );
  }

  // Pause freezes; resume does not re-anchor (the classic bug: resetting
  // phaseStartedAt on resume silently gives back the whole phase).
  {
    let s = initial(timeline, 0, 0);
    s = apply(s, timeline, 'pause', 10_000).state;
    const frozen = remainingSeconds(s, 25_000);
    s = apply(s, timeline, 'resume', 25_000).state;
    const afterResume = remainingSeconds(s, 25_000);
    expect(
      'pause freezes the clock and resume does not re-anchor',
      isPaused(initial(timeline, 0, 0)) === false && frozen === 20 && afterResume === 20,
      `frozen=${frozen}s afterResume=${afterResume}s (expected 20 and 20)`,
    );
  }

  // A paused phase must not advance even when wall time passes it.
  {
    let s = initial(timeline, 0, 0);
    s = apply(s, timeline, 'pause', 5_000).state;
    s = advance(s, timeline, 120_000);
    expect('a paused phase never advances', s.phaseIndex === 0, `advanced to ${s.phaseIndex}`);
  }

  // +30s extends only the current phase.
  {
    let s = initial(timeline, 0, 0);
    s = apply(s, timeline, 'add_30s', 5_000).state;
    const extended = remainingSeconds(s, 5_000);
    s = advance(s, timeline, 60_001);
    const nextRemaining = remainingSeconds(s, 60_001);
    expect(
      '+30s extends only the current phase',
      extended === 30 + ADD_SECONDS - 5 && s.phaseIndex === 1 && nextRemaining === 20,
      `extended=${extended}s next=${nextRemaining}s at phase ${s.phaseIndex}`,
    );
  }

  // Done advances a reps phase and is ignored on a timer phase.
  {
    let s = initial(timeline, 2, 0);
    const onReps = apply(s, timeline, 'done', 1_000);
    s = initial(timeline, 0, 0);
    const onTimer = apply(s, timeline, 'done', 1_000);
    expect(
      'done advances reps, is ignored on a pure timer',
      onReps.handled && onReps.state.phaseIndex === 3 && !onTimer.handled && onTimer.state.phaseIndex === 0,
      `reps handled=${onReps.handled}→${onReps.state.phaseIndex}, timer handled=${onTimer.handled}`,
    );
  }

  // A reps phase still advances at the cap — "never stranded holding a
  // kettlebell waiting for permission to continue."
  {
    let s = initial(timeline, 2, 0);
    s = advance(s, timeline, 40_000);
    expect(
      'a reps phase advances at the soft cap without Done',
      s.phaseIndex === 3,
      `landed on ${s.phaseIndex}`,
    );
  }

  // Skip from work lands on that item's own rest — you keep the recovery.
  {
    const s = initial(timeline, 0, 0);
    const result = apply(s, timeline, 'skip', 5_000);
    expect(
      'skip from work lands on that item’s rest',
      result.state.phaseIndex === 1 && result.state.skipped.indexOf(0) >= 0,
      `landed on ${result.state.phaseIndex}, skipped=[${result.state.skipped.join(',')}]`,
    );
  }

  // Skip from rest moves to the next item.
  {
    const s = initial(timeline, 1, 0);
    const result = apply(s, timeline, 'skip', 5_000);
    expect('skip from rest moves to the next item', result.state.phaseIndex === 2, `landed on ${result.state.phaseIndex}`);
  }

  // A redelivered command must not fire twice.
  {
    const s = initial(timeline, 0, 0);
    const first = apply(s, timeline, 'add_30s', 1_000, 'cmd-1');
    const again = apply(first.state, timeline, 'add_30s', 2_000, 'cmd-1');
    expect(
      'a redelivered command is ignored',
      first.handled && !again.handled && again.state.addedMs === first.state.addedMs,
      `added ${again.state.addedMs}ms vs ${first.state.addedMs}ms`,
    );
  }

  // Restoring mid-session resumes in place.
  {
    const restored = initial(timeline, 6, 500_000);
    const phase = currentPhase(restored, timeline);
    expect(
      'a mid-session restore resumes on the right phase',
      phase !== null && phase.kind === 'work' && phase.side === 'right',
      `restored to ${phase ? phase.kind + '/' + phase.side : 'nothing'}`,
    );
  }

  // Running off the end finishes rather than throwing.
  {
    let s = initial(timeline, timeline.length - 1, 0);
    s = advance(s, timeline, 999_000);
    expect('running past the last phase finishes cleanly', s.finished, 'did not finish');
  }

  return failures;
}

async function main() {
  const catalog = await fetchCatalog();
  console.log(dim(`${catalog.length} catalog entries`));

  const failures = [...(await checkTimelines(catalog)), ...checkMachine()];

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
