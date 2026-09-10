/**
 * Moved to `src/lib/planner/store.ts`, which the console's generate route also
 * uses. Re-exported here so the CLI's import path stays honest about what it
 * needs, and so there is exactly one implementation of "insert the session".
 */

export {
  fetchCatalog,
  fetchRecency,
  fetchPreferences,
  saveStickyPreferences,
  findOpenSession,
  insertSession,
  type StoredPreferences,
} from '../../../src/lib/planner/store';
