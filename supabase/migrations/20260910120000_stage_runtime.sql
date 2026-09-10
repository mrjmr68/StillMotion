begin;

-- ---------------------------------------------------------------------------
-- The TV's credential.
--
-- The 4-digit pairing code is a display artefact for a human — 10,000 guesses
-- is not a credential. The real proof is a 32-byte token minted at the same
-- instant and held by the TV. Only its SHA-256 is stored, so a database leak is
-- not a paired television. Lookup is an index probe on the hash, which also
-- means our code has no string-comparison timing surface.
-- ---------------------------------------------------------------------------
alter table pairings add column stage_token_hash text;
create unique index uq_pairings_stage_token on pairings (stage_token_hash)
  where stage_token_hash is not null;

alter table pairings add column last_seen_at timestamptz;
alter table pairings add column revoked_at timestamptz;

-- ---------------------------------------------------------------------------
-- The centering screen (spec §7) has no database representation.
--
-- `sessions` is deliberately not inserted until the plan is complete — see the
-- decision on plan_generated being NOT NULL, which is what keeps a phone closed
-- mid-generation from orphaning anything. And `sessions.status` has no
-- 'generating' value. So at the moment Generate is pressed there is literally
-- nothing in the schema for the TV to observe.
--
-- One column on the pairing closes that without reintroducing orphan sessions:
-- the console sets it when Generate is pressed and clears it when the insert
-- lands.
-- ---------------------------------------------------------------------------
alter table pairings add column stage_screen text not null default 'idle'
  check (stage_screen in ('idle', 'centering'));

-- ---------------------------------------------------------------------------
-- `begin` was missing from the command vocabulary.
-- ---------------------------------------------------------------------------
alter table session_live_state drop constraint session_live_state_pending_command_check;
alter table session_live_state add constraint session_live_state_pending_command_check
  check (pending_command in ('begin','pause','resume','skip','add_30s','swap','done','end'));

-- ---------------------------------------------------------------------------
-- Rest vs work.
--
-- `{block_index, item_index, seconds_remaining}` cannot distinguish "30 seconds
-- of goblet squat" from "30 seconds of rest before goblet squat", so the phone
-- cannot mirror the stage accurately and a mid-session TV reload cannot resume
-- in place — it would have to restart the item.
--
-- `phase_index` is the authoritative cursor (the console derives the same
-- timeline from the same plan with the same pure function). `phase` and `side`
-- are denormalised purely so the row is readable by eye in the Supabase table
-- editor, which matters a great deal when spec §3 says there are no reliable
-- devtools on the target device.
-- ---------------------------------------------------------------------------
alter table session_live_state add column phase_index integer not null default 0;
alter table session_live_state add column phase text
  check (phase is null or phase in ('transition','work','side_switch','rest','complete'));
alter table session_live_state add column side text
  check (side is null or side in ('left','right'));

-- ---------------------------------------------------------------------------
-- Somewhere for the artwork to live.
--
-- `exercise_catalog.asset_path` is 'catalog/{id}/still.svg' and names no bucket
-- anywhere in the project. Public because these are line drawings of a squat,
-- not secrets — and because a public bucket means the unauthenticated TV needs
-- no signing round-trip to show a picture.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('assets', 'assets', true)
on conflict (id) do nothing;

commit;
