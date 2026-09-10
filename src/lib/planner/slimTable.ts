/**
 * The catalog as a compact table for the prompt.
 *
 * Measured on the live 91 rows: 12 tab-separated columns without `name` is
 * ~8,400 characters (~2,600 tokens); including `name` pushes it to ~3,350.
 *
 * `name` is omitted deliberately. Ids are derived from names
 * (`squat_goblet_squat`), so the name is already legible inside the id —
 * including both duplicates ~750 tokens and adds a hallucination surface, since
 * a model given both will eventually emit a name where an id belongs.
 *
 * Also omitted: cues, setup_note, aka, asset_path, and the relation columns. The
 * TV looks those up at render time and none of them inform block sequencing.
 */

import type { CatalogRow } from '../catalog/schema';

const MODALITY_ABBREV: Record<string, string> = {
  mobility: 'mob',
  yoga: 'yog',
  strength: 'str',
  capacity: 'cap',
  balance: 'bal',
  breath: 'brt',
};

export const SLIM_TABLE_COLUMNS =
  'id\tmodality\tpattern\tprimary\tsecondary\tequipment\tposition\tuni\ttiming\tdose\tcap\tintensity';

function cell(values: readonly string[]): string {
  return values.length > 0 ? values.join('/') : '-';
}

export function catalogTable(rows: CatalogRow[]): string {
  const lines = rows.map((row) =>
    [
      row.id,
      MODALITY_ABBREV[row.modality] ?? row.modality,
      row.movement_pattern,
      cell(row.primary_regions),
      cell(row.secondary_regions),
      cell(row.equipment),
      row.body_position,
      row.unilateral ? 'U' : '-',
      row.timing_type,
      String(row.default_dose),
      row.rep_cap_seconds === null ? '-' : String(row.rep_cap_seconds),
      String(row.intensity),
    ].join('\t'),
  );

  return [SLIM_TABLE_COLUMNS, ...lines].join('\n');
}
