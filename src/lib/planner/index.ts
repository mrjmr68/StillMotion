/**
 * The planner pipeline.
 *
 * Spec §7 closes with: "You always get a workout. There is no path where the
 * check-in ends in an error message." That is enforced structurally here —
 * `buildSession` never throws, and its return type always carries a plan. A
 * generation failure, a refusal, a malformed response, an impossible pool: every
 * one of them lands on a fitted template rather than an error.
 *
 * `generate` is an injected port so the CLI can pass a fixture loader and the
 * future route handler can pass the real Anthropic call — same pipeline, no
 * test-only branches.
 */

import type { CatalogRow, Finding } from '../catalog/schema';
import { expand } from './expand';
import { applyHardConstraints, feasibility, type Feasibility } from './pools';
import { repairPlan } from './repair';
import type { Checkin, PlanDraft, PlanSource, RepairRecord, SessionPlan } from './schema';
import { templateFor, templateId } from './templates';
import { planWarnings, type Catalog } from './validate';
import type { Duration } from './vocab';

export type GenerateArgs = {
  checkin: Checkin;
  catalog: CatalogRow[];
  /** Findings from the previous attempt — present only on the single re-prompt. */
  priorFindings?: Finding[];
};

export type GeneratePort = (args: GenerateArgs) => Promise<{ draft: PlanDraft; model: string }>;

export type BuildSessionInput = {
  checkin: Checkin;
  catalog: CatalogRow[];
  generate: GeneratePort;
  promptVersion?: number;
  /** Set false to see exactly what the model produced. Diagnostics only. */
  repair?: boolean;
};

export type BuildSessionResult = {
  plan: SessionPlan;
  source: PlanSource;
  findings: Finding[];
  repairs: RepairRecord[];
  feasibility: Feasibility;
  /** Populated when generation was attempted and failed, for the CLI to show. */
  generationError: string | null;
};

function toCatalogMap(rows: CatalogRow[]): Catalog {
  return new Map(rows.map((row) => [row.id, row]));
}

/** Build and repair a plan from a draft, whatever its provenance. */
function realize(
  draft: PlanDraft,
  checkin: Checkin,
  catalog: Catalog,
  options: {
    source: PlanSource;
    model: string | null;
    promptVersion: number;
    templateId?: string | null;
    repair: boolean;
  },
): { plan: SessionPlan; needsReprompt: boolean } {
  const expanded = expand(draft, {
    checkin,
    catalog,
    source: options.source,
    model: options.model,
    promptVersion: options.promptVersion,
    templateId: options.templateId ?? null,
  });

  if (!options.repair) {
    expanded.findings = planWarnings(expanded, catalog);
    return { plan: expanded, needsReprompt: false };
  }

  const repaired = repairPlan(expanded, catalog);
  const plan = repaired.plan;

  // Remaining hard errors are reported alongside the warnings rather than
  // thrown — the caller decides whether to escalate, and the last-resort path
  // serves the plan with them recorded.
  plan.findings = [...plan.findings, ...repaired.remaining, ...planWarnings(plan, catalog)];
  plan.repairs = repaired.repairs;

  return { plan, needsReprompt: repaired.needsReprompt };
}

export async function buildSession(input: BuildSessionInput): Promise<BuildSessionResult> {
  const { checkin, catalog: allRows, generate } = input;
  const promptVersion = input.promptVersion ?? 0;
  const shouldRepair = input.repair ?? true;
  const catalog = toCatalogMap(allRows);

  const constrained = applyHardConstraints(allRows, checkin);
  const viability = feasibility(constrained, checkin.duration_min as Duration);

  const serveTemplate = (
    source: PlanSource,
    extraFindings: Finding[],
    generationError: string | null,
  ): BuildSessionResult => {
    const { plan } = realize(templateFor(checkin.duration_min as Duration), checkin, catalog, {
      source,
      model: null,
      promptVersion,
      templateId: templateId(checkin.duration_min as Duration),
      repair: shouldRepair,
    });
    plan.findings = [...extraFindings, ...plan.findings];
    return {
      plan,
      source,
      findings: plan.findings,
      repairs: plan.repairs,
      feasibility: viability,
      generationError,
    };
  };

  // The pool is too thin for a session of this length to exist. Skip generation
  // entirely rather than spending 20-30 seconds on a call that cannot succeed.
  if (!viability.ok) {
    return serveTemplate(
      'template_degraded',
      [
        {
          code: 'pool_too_thin',
          message: `not enough movements for ${checkin.duration_min} min — ${viability.shortfalls.join('; ')}`,
        },
      ],
      null,
    );
  }

  let generationError: string | null = null;

  try {
    const first = await generate({ checkin, catalog: constrained });
    const attempt = realize(first.draft, checkin, catalog, {
      source: 'llm',
      model: first.model,
      promptVersion,
      repair: shouldRepair,
    });

    if (!attempt.needsReprompt) {
      const source: PlanSource = attempt.plan.repairs.length > 0 ? 'llm_repaired' : 'llm';
      attempt.plan.source = source;
      return {
        plan: attempt.plan,
        source,
        findings: attempt.plan.findings,
        repairs: attempt.plan.repairs,
        feasibility: viability,
        generationError: null,
      };
    }

    // Exactly one re-prompt, and only for structural failures — the counter is
    // this code path existing once, not a loop with a guard.
    try {
      const second = await generate({
        checkin,
        catalog: constrained,
        priorFindings: attempt.plan.findings,
      });
      const retry = realize(second.draft, checkin, catalog, {
        source: 'llm_reprompt',
        model: second.model,
        promptVersion,
        repair: shouldRepair,
      });

      if (!retry.needsReprompt) {
        return {
          plan: retry.plan,
          source: 'llm_reprompt',
          findings: retry.plan.findings,
          repairs: retry.plan.repairs,
          feasibility: viability,
          generationError: null,
        };
      }
    } catch (error) {
      generationError = error instanceof Error ? error.message : String(error);
    }

    return serveTemplate(
      'template',
      [{ code: 'structural_failure', message: 'the generated plan could not be repaired' }],
      generationError,
    );
  } catch (error) {
    generationError = error instanceof Error ? error.message : String(error);
    return serveTemplate(
      'template',
      [{ code: 'generation_failed', message: generationError }],
      generationError,
    );
  }
}

export { applyHardConstraints, feasibility } from './pools';
export { planErrors, planWarnings } from './validate';
export { expand, rederive } from './expand';
export { repairPlan } from './repair';
export { templateFor, templateId, TEMPLATES } from './templates';
export { catalogTable } from './slimTable';
export * from './budget';
