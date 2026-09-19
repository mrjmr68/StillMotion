begin;

-- ---------------------------------------------------------------------------
-- Tell "where the file would live" apart from "a file is actually there".
--
-- `asset_path` was populated for all 91 rows when the catalog was imported,
-- pointing at 'catalog/{id}/still.svg' — files that have never existed. So the
-- column cannot answer the only question the renderer has, which is whether
-- there is something to show. `resolveAsset` worked around that by returning
-- null unconditionally, which was correct but meant no artwork could ever
-- appear, however much of it we made.
--
-- Additive rather than clearing `asset_path`, because the paths are the
-- convention and are worth keeping. This column is set by `assets:upload` after
-- the storage write succeeds, so it can only be true if a PUT returned ok.
-- ---------------------------------------------------------------------------
alter table exercise_catalog
  add column asset_ready boolean not null default false;

-- What kind of file is actually up there. `asset_tier` describes the ambition
-- ('still', 'pose_cycle', 'animated'); this describes the bytes, and the
-- renderer must branch on THIS — the two disagree for as long as a movement is
-- waiting for better art, which is most of the time.
alter table exercise_catalog
  add column asset_kind text
  check (asset_kind is null or asset_kind in ('image', 'video'));

comment on column exercise_catalog.asset_ready is
  'True only after assets:upload confirmed a storage write. The renderer branches on this, never on asset_tier.';

commit;
