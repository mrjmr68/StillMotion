/**
 * The one Anthropic call: draft a batch of catalog entries.
 *
 * Uses structured outputs (zod → JSON Schema) so entries come back schema-valid
 * rather than needing to be parsed out of prose. Cross-field rules still run in
 * TypeScript afterwards — see src/lib/catalog/schema.ts for why they cannot live
 * in the zod schema handed to the model.
 */

import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { BatchSchema, type DraftEntry } from '../../../src/lib/catalog/schema';
import type { Category } from '../categories';
import { anthropicApiKey, anthropicModel } from './env';
import { buildSystemPrompt, buildUserPrompt } from './prompt';

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export type GenerateResult = {
  entries: DraftEntry[];
  usage: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
  };
};

export async function generateBatch(options: {
  category: Category;
  count: number;
  digest: string[];
  effort: Effort;
}): Promise<GenerateResult> {
  const { category, count, digest, effort } = options;
  const client = new Anthropic({ apiKey: anthropicApiKey() });

  const response = await client.messages.parse({
    model: anthropicModel(),
    max_tokens: 16000,
    // Adaptive thinking: budget_tokens is removed on Opus 5 and returns a 400.
    thinking: { type: 'adaptive' },
    output_config: {
      effort,
      format: zodOutputFormat(BatchSchema),
    },
    system: [
      {
        type: 'text',
        text: buildSystemPrompt(),
        // The stable prefix. Everything volatile is in the user message below.
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [
      {
        role: 'user',
        content: buildUserPrompt({ category, count, digest }),
      },
    ],
  });

  if (response.stop_reason === 'refusal') {
    throw new Error(
      `The model declined this request (${response.stop_details?.category ?? 'unknown'}). ` +
        'Nothing was generated.',
    );
  }

  if (response.stop_reason === 'max_tokens') {
    throw new Error(
      `Hit the output cap before finishing ${count} entries. Retry with a smaller --count.`,
    );
  }

  if (!response.parsed_output) {
    throw new Error('The response did not parse against the entry schema. Nothing was written.');
  }

  return {
    entries: response.parsed_output.entries,
    usage: {
      input: response.usage.input_tokens,
      output: response.usage.output_tokens,
      cacheRead: response.usage.cache_read_input_tokens ?? 0,
      cacheWrite: response.usage.cache_creation_input_tokens ?? 0,
    },
  };
}
