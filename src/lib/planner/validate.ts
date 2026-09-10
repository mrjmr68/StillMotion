/**
 * Spec §7's exercise-science rules, re-checked.
 *
 * The spec's own framing for why this file exists: the same rules are stated in
 * the generation prompt, "because a prompt is a suggestion and a validator is a
 * rule." Anything here that fails is either repaired deterministically or
 * escalated — never silently accepted.
 *
 * Errors mirror something real (a constraint the user gave, a session that would
 * run long, a sequence that would hurt). Warnings are advisory, never block, and
 * are how you learn whether the prompt is actually working — the same philosophy
 * as the catalog harness's warnings.
 */

import type { CatalogRow, Finding } from '../catalog/schema';
import { DOSE_BANDS, FLOOR_POSITIONS } from '../catalog/vocab';
import { flatItems, itemTotalSeconds } from './budget';
import type { SessionPlan } from './schema';
import {
  FINAL_STRETCH_FRACTION,
  LOWER_PATTERNS,
  MAIN_WORK_MIN_FRACTION,
  MAIN_WORK_WARN_FRACTION,
  MAX_CONSECUTIVE_SHARED_REGION,
  MAX_FLOOR_ROUND_TRIPS,
  MIN_MAIN_BLOCK_ITEMS,
  OVERHEAD_LOADED_MIN_INTENSITY,
  OVERHEAD_NAME_PATTERN,
  TIME_TOLERANCE,
  TRANSITION_CHURN_FLOOR_SECONDS,
  TRANSITION_CHURN_FRACTION,
  UPPER_PATTERNS,
  BLOCK_ORDER,
} from './vocab';

/** A finding that knows where it happened, so repair can act on it. */
export type PlanFinding = Finding & { block?: number; item?: number };

export type Catalog = Map<string, CatalogRow>;

/**
 * Does this movement load a joint overhead?
 *
 * `movement_pattern` alone misses it — an overhead carry is `carry`, a windmill
 * is `rotate`, a get-up is `ground_transition`. The intensity floor correctly
 * excludes the unloaded `push_v` mobility work (wall slides, overhead reaches)
 * that is exactly what the rule wants scheduled FIRST.
 *
 * This is the one rule the schema genuinely cannot express; see
 * OVERHEAD_NAME_PATTERN for why the honest fix is a column, and why it's
 * deferred rather than skipped.
 */
export function loadsOverhead(row: CatalogRow): boolean {
  if (row.movement_pattern === 'push_v' && row.intensity >= OVERHEAD_LOADED_MIN_INTENSITY) {
    return true;
  }
  return [row.name, ...row.aka].some((name) => OVERHEAD_NAME_PATTERN.test(name));
}

/** Has the shoulder been taken through range by this point in the session? */
function shoulderPrepared(row: CatalogRow): boolean {
  const touchesShoulder =
    row.primary_regions.includes('shoulder') || row.secondary_regions.includes('shoulder');
  if (!touchesShoulder) return false;
  return row.modality === 'mobility' || row.modality === 'yoga' || row.intensity <= 2;
}

function upperLower(row: CatalogRow): 'upper' | 'lower' | 'other' {
  if (UPPER_PATTERNS.includes(row.movement_pattern)) return 'upper';
  if (LOWER_PATTERNS.includes(row.movement_pattern)) return 'lower';
  return 'other';
}

/* ------------------------------------------------------------------ *
 * Errors
 * ------------------------------------------------------------------ */

export function planErrors(plan: SessionPlan, catalog: Catalog): PlanFinding[] {
  const findings: PlanFinding[] = [];
  const { checkin } = plan;
  const owned = new Set(checkin.equipment_on_hand);
  const avoided = new Set(checkin.avoid_regions);
  const excluded = new Set(checkin.exclude_exercise_ids);

  // ---- per-item constraint checks --------------------------------------
  for (const block of plan.blocks) {
    if (block.items.length === 0) {
      findings.push({
        code: 'empty_block',
        message: `block "${block.label}" has no items`,
        block: block.index,
      });
      continue;
    }
    if (block.kind === 'main' && block.items.length / block.rounds < MIN_MAIN_BLOCK_ITEMS) {
      findings.push({
        code: 'too_few_items',
        message: `main block "${block.label}" has fewer than ${MIN_MAIN_BLOCK_ITEMS} distinct items`,
        block: block.index,
      });
    }

    for (const item of block.items) {
      const row = catalog.get(item.exercise_id);

      if (!row) {
        findings.push({
          code: 'unknown_exercise',
          message: `"${item.exercise_id}" is not in the catalog`,
          block: block.index,
          item: item.index,
        });
        continue;
      }

      if (!row.asset_path) {
        findings.push({
          code: 'missing_asset',
          message: `${row.name} has no asset`,
          block: block.index,
          item: item.index,
        });
      }
      if (!row.equipment.every((piece) => owned.has(piece))) {
        findings.push({
          code: 'equipment_unavailable',
          message: `${row.name} needs ${row.equipment.join('+')}`,
          block: block.index,
          item: item.index,
        });
      }
      if (row.primary_regions.some((region) => avoided.has(region))) {
        findings.push({
          code: 'avoided_region_primary',
          message: `${row.name} targets ${row.primary_regions.filter((r) => avoided.has(r)).join(', ')}`,
          block: block.index,
          item: item.index,
        });
      }
      if (excluded.has(row.id)) {
        findings.push({
          code: 'excluded_movement',
          message: `${row.name} is on the exclude list`,
          block: block.index,
          item: item.index,
        });
      }
      if (
        checkin.floor_tolerance === 'minimize_floor' &&
        FLOOR_POSITIONS.includes(row.body_position)
      ) {
        findings.push({
          code: 'floor_position_disallowed',
          message: `${row.name} is ${row.body_position} but floor work was minimised`,
          block: block.index,
          item: item.index,
        });
      }
      if (
        block.kind === 'main' &&
        (row.modality === 'mobility' || row.modality === 'breath' || row.modality === 'yoga') &&
        row.intensity <= 2
      ) {
        findings.push({
          code: 'mobility_in_main_block',
          message: `${row.name} (${row.modality}, intensity ${row.intensity}) is in a main block`,
          block: block.index,
          item: item.index,
        });
      }
    }
  }

  // ---- block ordering (spec §7 structure) ------------------------------
  const kinds = plan.blocks.map((block) => block.kind);
  const ranks = kinds.map((kind) => BLOCK_ORDER[kind]);
  const ordered = ranks.every((rank, i) => i === 0 || rank >= ranks[i - 1]);
  if (!ordered) {
    findings.push({
      code: 'block_order',
      message: `blocks run ${kinds.join(' → ')}; must be prepare → integrate? → main → down_regulate`,
    });
  }
  if (!kinds.includes('prepare')) {
    findings.push({ code: 'block_order', message: 'no prepare block' });
  }
  if (!kinds.includes('main')) {
    findings.push({ code: 'block_order', message: 'no main block' });
  }
  if (!kinds.includes('down_regulate')) {
    findings.push({ code: 'block_order', message: 'no down-regulate block' });
  }

  const flat = flatItems(plan.blocks);

  // ---- never load overhead before the shoulder has been through range ---
  let shoulderReady = false;
  for (const { block, item } of flat) {
    const row = catalog.get(item.exercise_id);
    if (!row) continue;
    if (shoulderPrepared(row)) shoulderReady = true;
    else if (loadsOverhead(row) && !shoulderReady) {
      findings.push({
        code: 'overhead_before_range',
        message: `${row.name} loads overhead before any shoulder range work`,
        block: block.index,
        item: item.index,
      });
      // Report once — repair inserts a single prep item that fixes all of them.
      break;
    }
  }

  // ---- no more than two consecutive items sharing a primary region ------
  for (let i = MAX_CONSECUTIVE_SHARED_REGION; i < flat.length; i += 1) {
    const window = flat.slice(i - MAX_CONSECUTIVE_SHARED_REGION, i + 1);
    const rows = window.map((entry) => catalog.get(entry.item.exercise_id)).filter(Boolean) as CatalogRow[];
    if (rows.length <= MAX_CONSECUTIVE_SHARED_REGION) continue;

    const shared = rows[0].primary_regions.filter((region) =>
      rows.every((row) => row.primary_regions.includes(region)),
    );
    if (shared.length > 0) {
      findings.push({
        code: 'consecutive_region',
        message: `${rows.length} consecutive items share ${shared.join(', ')}`,
        block: window[window.length - 1].block.index,
        item: window[window.length - 1].item.index,
      });
    }
  }

  // ---- time ------------------------------------------------------------
  if (Math.abs(plan.totals.drift_pct) > TIME_TOLERANCE) {
    const pct = (plan.totals.drift_pct * 100).toFixed(1);
    findings.push({
      code: 'duration_drift',
      message: `${pct}% off the requested ${plan.checkin.duration_min} min`,
    });
  }

  // ---- hardest work is not in the final 15% ----------------------------
  //
  // Compared against the session's own maximum rather than an absolute
  // threshold, so the rule stays meaningful for a flat-energy 15-minute session
  // whose hardest item is only intensity 3.
  //
  // Skipped entirely when the main work is all one intensity: there is then no
  // "hardest work" to misplace, and firing would be unfixable by construction —
  // no reordering can move an item to a position where it is easier than itself.
  const mainIntensities = flat
    .filter((entry) => entry.block.kind === 'main')
    .map((entry) => entry.item.intensity);
  const hasIntensityVariety =
    mainIntensities.length > 0 && Math.min(...mainIntensities) < Math.max(...mainIntensities);

  if (hasIntensityVariety) {
    const sessionMax = Math.max(...flat.map((entry) => entry.item.intensity), 0);
    const tailBudget = plan.totals.total_seconds * FINAL_STRETCH_FRACTION;
    let accumulated = 0;
    for (let i = flat.length - 1; i >= 0 && accumulated < tailBudget; i -= 1) {
      const { block, item } = flat[i];
      accumulated += itemTotalSeconds(item);
      if (item.intensity > sessionMax - 1) {
        findings.push({
          code: 'hard_work_late',
          message: `intensity ${item.intensity} lands in the final ${Math.round(FINAL_STRETCH_FRACTION * 100)}%`,
          block: block.index,
          item: item.index,
        });
        break;
      }
    }
  }

  // ---- mobility/breath never count as main work ------------------------
  const mainFraction =
    plan.totals.total_seconds > 0 ? plan.totals.main_work_seconds / plan.totals.total_seconds : 0;
  if (mainFraction < MAIN_WORK_MIN_FRACTION) {
    findings.push({
      code: 'main_work_fraction',
      message: `main work is ${Math.round(mainFraction * 100)}% of the session (needs ${Math.round(MAIN_WORK_MIN_FRACTION * 100)}%)`,
    });
  }

  return findings;
}

/* ------------------------------------------------------------------ *
 * Warnings
 * ------------------------------------------------------------------ */

export function planWarnings(plan: SessionPlan, catalog: Catalog): PlanFinding[] {
  const findings: PlanFinding[] = [];
  const avoided = new Set(plan.checkin.avoid_regions);
  const recent = new Set(plan.checkin.recent_exercise_ids);
  const flat = flatItems(plan.blocks);

  for (const { block, item } of flat) {
    const row = catalog.get(item.exercise_id);
    if (!row) continue;

    const secondaryHits = row.secondary_regions.filter((region) => avoided.has(region));
    if (secondaryHits.length > 0) {
      findings.push({
        code: 'avoided_region_secondary',
        message: `${row.name} involves ${secondaryHits.join(', ')} secondarily`,
        block: block.index,
        item: item.index,
      });
    }

    if (recent.has(row.id)) {
      findings.push({
        code: 'repeat_recency',
        message: `${row.name} appeared in the last 3 sessions`,
        block: block.index,
        item: item.index,
      });
    }

    const band = DOSE_BANDS[row.timing_type];
    if (item.dose < band.min || item.dose > band.max) {
      findings.push({
        code: 'dose_out_of_band',
        message: `${row.name}: ${item.dose} ${band.unit} (typical ${band.min}-${band.max})`,
        block: block.index,
        item: item.index,
      });
    }
  }

  // Same movement in two different blocks (rounds within a block don't count).
  const seenInBlock = new Map<string, number>();
  for (const { block, item } of flat) {
    const previous = seenInBlock.get(item.exercise_id);
    if (previous !== undefined && previous !== block.index) {
      const row = catalog.get(item.exercise_id);
      findings.push({
        code: 'duplicate_within_session',
        message: `${row?.name ?? item.exercise_id} appears in more than one block`,
        block: block.index,
        item: item.index,
      });
    }
    seenInBlock.set(item.exercise_id, block.index);
  }

  const mainFraction =
    plan.totals.total_seconds > 0 ? plan.totals.main_work_seconds / plan.totals.total_seconds : 0;
  if (mainFraction >= MAIN_WORK_MIN_FRACTION && mainFraction < MAIN_WORK_WARN_FRACTION) {
    findings.push({
      code: 'main_work_fraction',
      message: `main work is only ${Math.round(mainFraction * 100)}% of the session`,
    });
  }

  // Transition churn. The floor matters: a flat percentage trips on every
  // 15-minute plan no matter how well it's sequenced.
  const churnThreshold = Math.max(
    TRANSITION_CHURN_FLOOR_SECONDS,
    plan.totals.total_seconds * TRANSITION_CHURN_FRACTION,
  );
  if (plan.totals.transition_seconds > churnThreshold) {
    findings.push({
      code: 'transition_churn',
      message: `${Math.round(plan.totals.transition_seconds)}s of transitions (threshold ${Math.round(churnThreshold)}s)`,
    });
  }

  // Standing → floor → standing round trips.
  let roundTrips = 0;
  let onFloor: boolean | null = null;
  for (const { item } of flat) {
    const row = catalog.get(item.exercise_id);
    if (!row) continue;
    const isFloor = FLOOR_POSITIONS.includes(row.body_position);
    if (onFloor !== null && onFloor && !isFloor) roundTrips += 1;
    onFloor = isFloor;
  }
  if (roundTrips > MAX_FLOOR_ROUND_TRIPS) {
    findings.push({
      code: 'floor_round_trips',
      message: `${roundTrips} trips up off the floor`,
    });
  }

  // Circuits should alternate upper/lower so local fatigue doesn't end the set
  // before the timer does.
  for (const block of plan.blocks) {
    if (block.format !== 'circuit' || block.items.length < 3) continue;
    let alternations = 0;
    let pairs = 0;
    for (let i = 1; i < block.items.length; i += 1) {
      const a = catalog.get(block.items[i - 1].exercise_id);
      const b = catalog.get(block.items[i].exercise_id);
      if (!a || !b) continue;
      pairs += 1;
      const groupA = upperLower(a);
      const groupB = upperLower(b);
      if (groupA !== groupB || groupA === 'other') alternations += 1;
    }
    if (pairs > 0 && alternations / pairs < 0.5) {
      findings.push({
        code: 'no_antagonist_alternation',
        message: `circuit "${block.label}" rarely alternates upper/lower`,
        block: block.index,
      });
    }
  }

  // Nervous-system-demanding work should be early while you're fresh.
  const mainBlocks = plan.blocks.filter((block) => block.kind === 'main');
  for (const block of mainBlocks) {
    const median = block.items.length / 2;
    for (const item of block.items) {
      const row = catalog.get(item.exercise_id);
      if (!row) continue;
      const demanding =
        row.movement_pattern === 'gait' ||
        row.movement_pattern === 'ground_transition' ||
        row.movement_pattern === 'carry' ||
        row.unilateral;
      if (demanding && item.index > median && item.round === 1) {
        findings.push({
          code: 'nervous_system_late',
          message: `${row.name} is scheduled late in "${block.label}"`,
          block: block.index,
          item: item.index,
        });
        break;
      }
    }
  }

  return findings;
}
