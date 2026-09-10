/**
 * The planner's Anthropic call.
 *
 * Lives in `src/lib` rather than `scripts/` because it now has two callers: the
 * `plan` CLI and `POST /api/console/generate`. Two copies of the model call
 * would be two places for the prompt version, the effort, or the refusal
 * handling to drift — and the whole point of `plan --dry-run` is that what the
 * CLI prints is what the console sends.
 *
 * Server-only: it reads `ANTHROPIC_API_KEY`, which has no `NEXT_PUBLIC_` prefix
 * and must never reach the browser bundle.
 */

import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { PlanDraftSchema, type PlanDraft } from './schema';
import type { GenerateArgs } from './index';
import { buildSystemPrompt, buildUserPrompt } from './prompt';

/**
 * Reading the key here rather than importing `scripts/catalog/lib/env` keeps
 * `src` from depending on `scripts`, which would drag CLI-only code into the
 * Next build graph.
 */
function anthropicApiKey(): string {
  const value = process.env.ANTHROPIC_API_KEY;
  if (!value || value.startsWith('your-')) {
    throw new Error(
      'ANTHROPIC_API_KEY is not set. Needed for generating a session. Copy ' +
        '.env.example to .env.local and fill it in.',
    );
  }
  return value;
}

/** Defaults to Opus 5 when unset. */
function anthropicModel(): string {
  return process.env.ANTHROPIC_MODEL || 'claude-opus-5';
}

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export type Usage = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  seconds: number;
};

/** Populated by the most recent call, for the CLI to report. */
export let lastUsage: Usage | null = null;

export function makeGenerator(effort: Effort) {
  return async (args: GenerateArgs): Promise<{ draft: PlanDraft; model: string }> => {
    const client = new Anthropic({ apiKey: anthropicApiKey() });
    const model = anthropicModel();
    const startedAt = Date.now();

    const response = await client.messages.parse({
      model,
      max_tokens: 16000,
      // Adaptive thinking: budget_tokens is removed on Opus 5 and returns a 400.
      thinking: { type: 'adaptive' },
      output_config: {
        effort,
        format: zodOutputFormat(PlanDraftSchema),
      },
      system: [
        {
          type: 'text',
          // The catalog lives here, in the stable prefix — see prompt.ts.
          text: buildSystemPrompt(args.catalog),
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [
        { role: 'user', content: buildUserPrompt(args.checkin, args.priorFindings) },
      ],
    });

    lastUsage = {
      input: response.usage.input_tokens,
      output: response.usage.output_tokens,
      cacheRead: response.usage.cache_read_input_tokens ?? 0,
      cacheWrite: response.usage.cache_creation_input_tokens ?? 0,
      seconds: (Date.now() - startedAt) / 1000,
    };

    if (response.stop_reason === 'refusal') {
      throw new Error(
        `the model declined this request (${response.stop_details?.category ?? 'unknown'})`,
      );
    }
    if (response.stop_reason === 'max_tokens') {
      throw new Error('hit the output cap before finishing the plan');
    }
    if (!response.parsed_output) {
      throw new Error('the response did not parse against the plan schema');
    }

    return { draft: response.parsed_output, model };
  };
}
