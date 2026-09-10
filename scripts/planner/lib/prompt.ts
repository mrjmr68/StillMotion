/**
 * Moved to `src/lib/planner/prompt.ts` — the console generates from the same
 * prompt, so `plan --dry-run` printing something the console doesn't send would
 * make the CLI's whole diagnostic value a fiction.
 */

export {
  PLANNER_PROMPT_VERSION,
  buildSystemPrompt,
  buildUserPrompt,
} from '../../../src/lib/planner/prompt';
