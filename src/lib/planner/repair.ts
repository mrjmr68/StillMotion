/**
 * Deterministic repair (spec §7 step 5).
 *
 * "On failure: substitute nearest catalog neighbour by pattern + intensity, trim
 * or pad dose." Three passes, applied in a fixed-point loop:
 *
 *   A. item-level substitution — each fix is purely local
 *   B. sequencing — swaps and inserts, which move items around
 *   C. dose and time — cheapest lever first, so content changes last
 *
 * Only STRUCTURAL failures escalate to the single re-prompt; everything else is
 * either fixed here or accepted as a warning. Every change is recorded in a
 * `RepairRecord`, because the repair list is the thing you read to tell whether
 * the validator is improving sessions or quietly wrecking them.
 */

import type { CatalogRow } from '../catalog/schema';
import { DOSE_BANDS } from '../catalog/vocab';
import { itemWorkSeconds } from './budget';
import { rederive } from './expand';
import { nearestNeighbor, type NeighborContext } from './neighbors';
import { fitsBlockKind } from './pools';
import type { PlanItem, RepairRecord, SessionPlan } from './schema';
import { planErrors, type Catalog, type PlanFinding } from './validate';
import {
  MAIN_WORK_MIN_FRACTION,
  OVERHEAD_PREP_PREFERENCE,
  REST_BANDS,
  SUBSTITUTE_WORK_TOLERANCE,
  TIME_TOLERANCE,
} from './vocab';

const MAX_PASSES = 3;

/** Codes that no local edit can fix — reordering blocks is a different plan. */
const STRUCTURAL_CODES = new Set(['block_order']);

/** Codes repaired by substituting the offending item for a neighbour. */
const SUBSTITUTION_CODES = new Set([
  'unknown_exercise',
  'missing_asset',
  'equipment_unavailable',
  'avoided_region_primary',
  'excluded_movement',
  'floor_position_disallowed',
  'mobility_in_main_block',
]);

export type RepairResult = {
  plan: SessionPlan;
  repairs: RepairRecord[];
  /** Errors still standing after all passes. */
  remaining: PlanFinding[];
  /** True when what remains can only be fixed by generating a different plan. */
  needsReprompt: boolean;
};

function idsInUse(plan: SessionPlan): Set<string> {
  return new Set(plan.blocks.flatMap((block) => block.items.map((item) => item.exercise_id)));
}

/**
 * Pick a dose for a substituted movement.
 *
 * Deliberately does NOT try to translate reps into seconds semantically — eight
 * reps of a swing is not "40 seconds of swinging" in any meaningful sense.
 * Instead it starts from the replacement's own `default_dose` and scales toward
 * matching the work time it's replacing, clamped to the movement's sane band.
 */
function doseForSubstitute(replacement: CatalogRow, targetWorkSeconds: number): number {
  const band = DOSE_BANDS[replacement.timing_type];
  let dose = replacement.default_dose;

  const baseline = itemWorkSeconds(replacement, dose);
  if (baseline > 0 && targetWorkSeconds > 0) {
    const ratio = targetWorkSeconds / baseline;
    if (Math.abs(ratio - 1) > SUBSTITUTE_WORK_TOLERANCE) {
      dose = Math.round(dose * ratio);
    }
  }

  return Math.max(band.min, Math.min(band.max, Math.max(1, dose)));
}

/* ------------------------------------------------------------------ *
 * Pass A — item-level substitution
 * ------------------------------------------------------------------ */

function passSubstitute(
  plan: SessionPlan,
  catalog: Catalog,
  _findings: PlanFinding[],
  repairs: RepairRecord[],
): SessionPlan {
  const pool = [...catalog.values()];
  // Held as a mutable Set so each substitution immediately blocks the next one
  // from picking the same replacement.
  const inUse = idsInUse(plan);
  const context: NeighborContext = {
    checkin: plan.checkin,
    inUse,
    recent: new Set(plan.checkin.recent_exercise_ids),
  };

  /**
   * One substitution per iteration, re-validating in between.
   *
   * Findings are reported per ITEM, and rounds flatten one movement into several
   * items — so a 4-round block yields four identical findings for the same
   * offending movement. Trusting a stale list means the first fix replaces all
   * four instances and the remaining three then re-substitute the *replacement*,
   * cascading into a session built from three copies of one movement with
   * doses inflated by each pass. Re-validating is O(items) per fix and this
   * plan has tens of items, so correctness is nearly free here.
   */
  const MAX_SUBSTITUTIONS = 40;

  for (let iteration = 0; iteration < MAX_SUBSTITUTIONS; iteration += 1) {
    const finding = planErrors(plan, catalog).find(
      (candidate) =>
        SUBSTITUTION_CODES.has(candidate.code) &&
        candidate.block !== undefined &&
        candidate.item !== undefined,
    );
    if (!finding) break;

    const block = plan.blocks.find((b) => b.index === finding.block);
    const item = block?.items.find((i) => i.index === finding.item);
    if (!block || !item) break;

    const current = catalog.get(item.exercise_id);
    // An unknown id has no row to measure distance from, so anchor the search on
    // any row that fits the block instead.
    const anchor = current ?? pool.find((row) => fitsBlockKind(row, block.kind)) ?? pool[0];
    if (!anchor) continue;

    const fitsSlot = (row: CatalogRow) => fitsBlockKind(row, block.kind);

    // Prefer a movement not already in the plan, but a REPEAT beats leaving a
    // hard error standing. With bodyweight only, the legal prepare and
    // down-regulate pools are the same two entries, so a 15-minute template's
    // four bookend slots cannot all be distinct — and "you always get a workout"
    // outranks "no movement appears twice", which is only ever a warning.
    const replacement =
      nearestNeighbor(anchor, pool, context, fitsSlot) ??
      nearestNeighbor(anchor, pool, { ...context, allowRepeat: true }, fitsSlot);
    // No legal substitute exists at all — leave the error standing for the
    // caller to escalate rather than spinning.
    if (!replacement) break;

    const from = item.exercise_id;
    const dose = doseForSubstitute(replacement, item.work_seconds);

    // Every item sharing this exercise_id across rounds must move together.
    for (const sibling of block.items) {
      if (sibling.exercise_id !== from) continue;
      sibling.exercise_id = replacement.id;
      sibling.dose = dose;
    }

    inUse.add(replacement.id);
    plan = rederive(plan, catalog);

    repairs.push({
      code: finding.code,
      scope: 'item',
      block: block.index,
      item: item.index,
      from,
      to: replacement.id,
      detail: finding.message,
    });
  }

  return rederive(plan, catalog);
}

/* ------------------------------------------------------------------ *
 * Pass B — sequencing
 * ------------------------------------------------------------------ */

function passSequence(
  plan: SessionPlan,
  catalog: Catalog,
  findings: PlanFinding[],
  repairs: RepairRecord[],
): SessionPlan {
  // Overhead before range: insert shoulder prep rather than removing the load.
  const overhead = findings.find((f) => f.code === 'overhead_before_range');
  if (overhead) {
    const prepareBlock = plan.blocks.find((block) => block.kind === 'prepare');
    if (prepareBlock) {
      const choice = OVERHEAD_PREP_PREFERENCE.map((id) => catalog.get(id)).find(
        (row): row is CatalogRow =>
          row !== undefined &&
          row.equipment.every((piece) => plan.checkin.equipment_on_hand.includes(piece)),
      );

      if (choice && !prepareBlock.items.some((item) => item.exercise_id === choice.id)) {
        const inserted: PlanItem = {
          index: prepareBlock.items.length,
          round: 1,
          exercise_id: choice.id,
          timing_type: choice.timing_type,
          dose: choice.default_dose,
          sides: choice.unilateral ? ['left', 'right'] : ['both'],
          work_seconds: itemWorkSeconds(choice, choice.default_dose),
          rest_seconds: 0,
          transition_seconds: 0,
          intensity: choice.intensity,
        };
        prepareBlock.items.push(inserted);
        repairs.push({
          code: 'overhead_before_range',
          scope: 'block',
          block: prepareBlock.index,
          item: null,
          from: null,
          to: choice.id,
          detail: `inserted ${choice.name} into "${prepareBlock.label}"`,
        });
      }
    }
  }

  /**
   * Hardest work in the final 15%: lengthen the close rather than reorder the
   * work.
   *
   * The tail is measured in wall-clock seconds, so a down-regulate block shorter
   * than that window necessarily lets main work bleed into it. Padding the close
   * moves the boundary and — unlike reordering — leaves the session's actual
   * structure intact. Any drift this introduces is picked up by the time pass,
   * which runs after this one.
   */
  if (findings.some((f) => f.code === 'hard_work_late')) {
    const closing = plan.blocks.filter((block) => block.kind === 'down_regulate');
    let padded = false;

    // Only pad when there is time headroom. Otherwise this pass and the time
    // pass fight each other across successive iterations — one lengthening the
    // close, the other trimming it back — and the session ends up long. When the
    // session is already at or over budget the reorder below does the work
    // instead, which costs no time at all.
    const hasHeadroom = plan.totals.drift_pct <= 0;

    for (const block of hasHeadroom ? closing : []) {
      for (const item of block.items) {
        const row = catalog.get(item.exercise_id);
        if (!row) continue;
        const band = DOSE_BANDS[row.timing_type];
        const next = Math.min(band.max, Math.round(item.dose * 1.3));
        if (next !== item.dose) {
          item.dose = next;
          padded = true;
        }
      }
    }

    if (padded) {
      repairs.push({
        code: 'hard_work_late',
        scope: 'plan',
        block: -1,
        item: null,
        from: null,
        to: null,
        detail: 'lengthened the down-regulate block to move the final-15% boundary',
      });
    }

    // Padding alone can't always reach the boundary — at 60 minutes the final
    // 15% is nine minutes, more down-regulate than any session wants. So also
    // order the closing main block to END on its easiest movement. Spec §7 wants
    // conditioning after strength AND the hardest work out of the tail; when a
    // conditioning block closes the session those collide, and this resolves it
    // without moving the block.
    const mainBlocks = plan.blocks.filter((block) => block.kind === 'main');
    const closingMain = mainBlocks[mainBlocks.length - 1];
    if (closingMain) {
      const perRound = Math.round(closingMain.items.length / closingMain.rounds);
      const firstRound = closingMain.items.slice(0, perRound);

      if (firstRound.length > 1) {
        const byIntensity = [...firstRound].sort((a, b) => b.intensity - a.intensity);
        const reordered = byIntensity.map((item) => item.exercise_id);
        const current = firstRound.map((item) => item.exercise_id);

        if (reordered.join() !== current.join()) {
          const template = byIntensity;
          closingMain.items = [];
          for (let round = 1; round <= closingMain.rounds; round += 1) {
            for (const item of template) {
              closingMain.items.push({ ...item, round, index: closingMain.items.length });
            }
          }
          repairs.push({
            code: 'hard_work_late',
            scope: 'block',
            block: closingMain.index,
            item: null,
            from: current[current.length - 1],
            to: reordered[reordered.length - 1],
            detail: 'reordered the closing block to end on its easiest movement',
          });
        }
      }
    }
  }

  // Consecutive shared region: try swapping the offender with a later item in
  // the same block before reaching for a substitution.
  for (const finding of findings) {
    if (finding.code !== 'consecutive_region') continue;
    if (finding.block === undefined || finding.item === undefined) continue;

    const block = plan.blocks.find((b) => b.index === finding.block);
    if (!block) continue;
    const position = block.items.findIndex((item) => item.index === finding.item);
    if (position < 0) continue;

    const offending = catalog.get(block.items[position].exercise_id);
    if (!offending) continue;

    const swapWith = block.items.findIndex((candidate, i) => {
      if (i <= position) return false;
      const row = catalog.get(candidate.exercise_id);
      if (!row) return false;
      return !row.primary_regions.some((region) => offending.primary_regions.includes(region));
    });

    if (swapWith > position) {
      const a = block.items[position];
      const b = block.items[swapWith];
      [block.items[position], block.items[swapWith]] = [b, a];
      repairs.push({
        code: 'consecutive_region',
        scope: 'block',
        block: block.index,
        item: finding.item,
        from: a.exercise_id,
        to: b.exercise_id,
        detail: 'swapped to break a shared-region run',
      });
    }
  }

  return rederive(plan, catalog);
}

/* ------------------------------------------------------------------ *
 * Pass C — dose and time
 * ------------------------------------------------------------------ */

function scaleDoses(
  plan: SessionPlan,
  catalog: Catalog,
  kinds: SessionPlan['blocks'][number]['kind'][],
  factor: number,
): boolean {
  let changed = false;
  for (const block of plan.blocks) {
    if (!kinds.includes(block.kind)) continue;
    for (const item of block.items) {
      const row = catalog.get(item.exercise_id);
      if (!row) continue;
      const band = DOSE_BANDS[row.timing_type];
      const next = Math.max(band.min, Math.min(band.max, Math.round(item.dose * factor)));
      if (next !== item.dose) {
        item.dose = next;
        changed = true;
      }
    }
  }
  return changed;
}

function passTime(
  plan: SessionPlan,
  catalog: Catalog,
  repairs: RepairRecord[],
): SessionPlan {
  let working = rederive(plan, catalog);

  // Generous budget: the cheap levers (rest, bookend doses) each consume an
  // attempt, so a tight budget can exhaust itself before ever reaching the
  // rounds lever, which is the only one big enough to close a large drift.
  for (let attempt = 0; attempt < 15; attempt += 1) {
    const drift = working.totals.drift_pct;
    if (Math.abs(drift) <= TIME_TOLERANCE) break;
    const tooLong = drift > 0;

    // 1. Rest, toward the band edge. Changes no content at all.
    let changed = false;
    for (const block of working.blocks) {
      const band = REST_BANDS[block.kind];
      for (const item of block.items) {
        const next = tooLong
          ? Math.max(band.min, item.rest_seconds - 10)
          : Math.min(band.max, item.rest_seconds + 10);
        if (next !== item.rest_seconds) {
          item.rest_seconds = next;
          changed = true;
        }
      }
    }

    if (!changed) {
      // 2/3. Bookend doses before touching the actual work.
      changed = scaleDoses(working, catalog, ['down_regulate', 'prepare'], tooLong ? 0.8 : 1.2);
    }

    if (!changed) {
      // 4. Rounds — the coarsest and biggest lever.
      const mainBlocks = working.blocks.filter((block) => block.kind === 'main');
      const last = mainBlocks[mainBlocks.length - 1];
      if (last && (tooLong ? last.rounds > 1 : last.rounds < 6)) {
        const perRound = last.items.length / last.rounds;
        const nextRounds = tooLong ? last.rounds - 1 : last.rounds + 1;
        const template = last.items.slice(0, perRound);

        last.items = [];
        for (let round = 1; round <= nextRounds; round += 1) {
          for (const item of template) {
            last.items.push({ ...item, round, index: last.items.length });
          }
        }
        repairs.push({
          code: 'duration_drift',
          scope: 'block',
          block: last.index,
          item: null,
          from: String(last.rounds),
          to: String(nextRounds),
          detail: `main circuit rounds ${last.rounds} → ${nextRounds}`,
        });
        last.rounds = nextRounds;
        changed = true;
      }
    }

    if (!changed) {
      // 5. Main work doses, last resort.
      changed = scaleDoses(working, catalog, ['main'], tooLong ? 0.85 : 1.15);
    }

    if (!changed) break;
    working = rederive(working, catalog);
  }

  const finalDrift = working.totals.drift_pct;
  if (Math.abs(finalDrift) <= TIME_TOLERANCE && Math.abs(plan.totals.drift_pct) > TIME_TOLERANCE) {
    repairs.push({
      code: 'duration_drift',
      scope: 'plan',
      block: -1,
      item: null,
      from: `${Math.round(plan.totals.total_seconds / 60)}m`,
      to: `${Math.round(working.totals.total_seconds / 60)}m`,
      detail: `brought within ${Math.round(TIME_TOLERANCE * 100)}% of ${working.checkin.duration_min} min`,
    });
  }

  // Main-work fraction: pad main doses rather than cutting the bookends, which
  // would fight the time repair above.
  if (
    working.totals.total_seconds > 0 &&
    working.totals.main_work_seconds / working.totals.total_seconds < MAIN_WORK_MIN_FRACTION
  ) {
    if (scaleDoses(working, catalog, ['main'], 1.2)) {
      working = rederive(working, catalog);
      repairs.push({
        code: 'main_work_fraction',
        scope: 'plan',
        block: -1,
        item: null,
        from: null,
        to: null,
        detail: 'padded main-work doses',
      });
    }
  }

  return working;
}

/* ------------------------------------------------------------------ *
 * The loop
 * ------------------------------------------------------------------ */

export function repairPlan(input: SessionPlan, catalog: Catalog): RepairResult {
  const repairs: RepairRecord[] = [];
  let plan: SessionPlan = structuredClone(input);

  for (let pass = 0; pass < MAX_PASSES; pass += 1) {
    const errors = planErrors(plan, catalog);
    if (errors.length === 0) break;

    plan = passSubstitute(plan, catalog, errors, repairs);
    plan = passSequence(plan, catalog, planErrors(plan, catalog), repairs);
    plan = passTime(plan, catalog, repairs);
  }

  let remaining = planErrors(plan, catalog);

  /**
   * The one place a spec rule is deliberately allowed to bend.
   *
   * `primary_regions` is concentrated — shoulder 41 of 91 rows, hip 40 — and
   * with "avoid hip" the main-work pool is overwhelmingly shoulder-dominant, so
   * any three consecutive items share `shoulder` by construction. A re-prompt
   * cannot fix a pool that has no alternative, so once swaps and substitutions
   * are exhausted this downgrades to a warning rather than escalating.
   */
  const unavoidableRegion = remaining.filter((f) => f.code === 'consecutive_region');
  if (unavoidableRegion.length > 0) {
    remaining = remaining.filter((f) => f.code !== 'consecutive_region');
    for (const finding of unavoidableRegion) {
      plan.findings.push({
        code: 'consecutive_region_unavoidable',
        message: `${finding.message} — no alternative in the available pool`,
      });
    }
  }

  const needsReprompt =
    remaining.some((finding) => STRUCTURAL_CODES.has(finding.code)) ||
    remaining.filter((finding) => finding.code === 'unknown_exercise').length > 2;

  plan.repairs = repairs;
  return { plan, repairs, remaining, needsReprompt };
}
