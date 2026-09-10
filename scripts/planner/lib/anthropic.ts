/**
 * The planner's Anthropic call — structurally the same as the catalog harness's,
 * with a different schema and a much larger cached prefix.
 */

import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { PlanDraftSchema } from '../../../src/lib/planner/schema';
import type { GenerateArgs } from '../../../src/lib/planner';
import type { PlanDraft } from '../../../src/lib/planner/schema';
import { anthropicApiKey, anthropicModel } from '../../catalog/lib/env';
import { buildSystemPrompt, buildUserPrompt } from './prompt';

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
