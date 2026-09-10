/**
 * PlanDraft -> SessionPlan.
 *
 * The `derive.ts` analogue from the catalog harness: the model owns the
 * judgments (which movement, what dose, how much rest), the harness owns every
 * field where exactly one value is correct given the others.
 *
 * Two structural decisions live here, and both are forced by the schema rather
 * than chosen for taste:
 *
 * 1. ROUNDS ARE FLATTENED. `session_live_state` carries only
 *    `current_block_index` / `current_item_index` — there is no round cursor —
 *    and `exercise_logs`' unique key is `(session_id, block_index, item_index,
 *    side)`. Flattening keeps both working with no migration. It also makes the
 *    sequencing rules checkable at all, since "no more than two consecutive
 *    items sharing a primary region" and "hardest work not in the final 15%"
 *    both need the flat running order, across round and block boundaries.
 *
 * 2. A UNILATERAL MOVEMENT IS ONE ITEM WITH TWO SIDES, not two items —
 *    `exercise_logs.side` is a column *in* that unique key, not part of
 *    `item_index`. So one item logs two rows, and spec §7's "unilateral work
 *    always schedules both sides, same dose" becomes unconstructible-if-violated
 *    rather than a rule to check.
 */

import type { CatalogRow } from '../catalog/schema';
import { itemWorkSeconds, planTiming, transitionSeconds } from './budget';
import type { Checkin, PlanBlock, PlanDraft, PlanItem, PlanSource, SessionPlan } from './schema';
import { PLAN_VERSION } from './vocab';

export type ExpandContext = {
  checkin: Checkin;
  catalog: Map<string, CatalogRow>;
  source: PlanSource;
  model?: string | null;
  promptVersion?: number;
  templateId?: string | null;
};

/**
 * Items whose `exercise_id` isn't in the catalog are kept, not dropped — the
 * validator needs to see them to report `unknown_exercise`, and silently
 * discarding them would turn a loud repairable error into a quietly short
 * session. They carry placeholder timings until repair substitutes them.
 */
const UNKNOWN_PLACEHOLDER = {
  timing_type: 'duration' as const,
  work_seconds: 30,
  intensity: 3,
};

export function expand(draft: PlanDraft, context: ExpandContext): SessionPlan {
  const blocks: PlanBlock[] = [];
  let previousRow: CatalogRow | null = null;

  draft.blocks.forEach((draftBlock, blockIndex) => {
    const items: PlanItem[] = [];
    let flatIndex = 0;

    for (let round = 1; round <= draftBlock.rounds; round += 1) {
      draftBlock.items.forEach((draftItem, positionInRound) => {
        const row = context.catalog.get(draftItem.exercise_id) ?? null;
        const startsBlock = flatIndex === 0;

        const transition = row
          ? transitionSeconds(previousRow, row, startsBlock)
          : startsBlock
            ? 20
            : 0;

        const item: PlanItem = {
          index: flatIndex,
          round,
          exercise_id: draftItem.exercise_id,
          timing_type: row ? row.timing_type : UNKNOWN_PLACEHOLDER.timing_type,
          dose: draftItem.dose,
          sides: row?.unilateral ? ['left', 'right'] : ['both'],
          work_seconds: row
            ? itemWorkSeconds(row, draftItem.dose)
            : UNKNOWN_PLACEHOLDER.work_seconds,
          rest_seconds: draftItem.rest_seconds,
          transition_seconds: transition,
          intensity: row ? row.intensity : UNKNOWN_PLACEHOLDER.intensity,
        };

        items.push(item);
        flatIndex += 1;
        if (row) previousRow = row;
        // positionInRound is intentionally unused — kept for readability of the
        // nesting, since `index` is flat and `round` is explicit.
        void positionInRound;
      });
    }

    blocks.push({
      index: blockIndex,
      kind: draftBlock.kind,
      label: draftBlock.label,
      format: draftBlock.format,
      rounds: draftBlock.rounds,
      items,
    });
  });

  return {
    version: PLAN_VERSION,
    source: context.source,
    template_id: context.templateId ?? null,
    generated_at: new Date().toISOString(),
    model: context.model ?? null,
    prompt_version: context.promptVersion ?? 0,
    checkin: context.checkin,
    intent: draft.intent,
    totals: planTiming(blocks, context.checkin.duration_min),
    findings: [],
    repairs: [],
    blocks,
  };
}

/**
 * Recompute every derived field after repair has changed doses, substituted
 * exercises, or reordered items. Cheaper and far less error-prone than trying to
 * patch timings incrementally at each mutation site.
 */
export function rederive(plan: SessionPlan, catalog: Map<string, CatalogRow>): SessionPlan {
  let previousRow: CatalogRow | null = null;

  const blocks = plan.blocks.map((block, blockIndex) => {
    const items = block.items.map((item, position) => {
      const row = catalog.get(item.exercise_id) ?? null;
      const startsBlock = position === 0;

      const transition = row
        ? transitionSeconds(previousRow, row, startsBlock)
        : startsBlock
          ? 20
          : 0;

      const next: PlanItem = {
        ...item,
        index: position,
        timing_type: row ? row.timing_type : item.timing_type,
        sides: row?.unilateral ? ['left', 'right'] : ['both'],
        work_seconds: row ? itemWorkSeconds(row, item.dose) : item.work_seconds,
        transition_seconds: transition,
        intensity: row ? row.intensity : item.intensity,
      };

      if (row) previousRow = row;
      return next;
    });

    return { ...block, index: blockIndex, items };
  });

  return { ...plan, blocks, totals: planTiming(blocks, plan.checkin.duration_min) };
}
