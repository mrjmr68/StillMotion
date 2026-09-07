begin;

create table pairings (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid references auth.users(id) on delete cascade,  -- null until claimed
  code         text not null check (code ~ '^[0-9]{4}$'),
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null default (now() + interval '15 minutes'),
  claimed_at   timestamptz
);

create index idx_pairings_expires_at on pairings (expires_at);

create unique index uq_pairings_active_code on pairings (code) where claimed_at is null;

alter table pairings enable row level security;

create policy "select own claimed pairings" on pairings for select
  to authenticated using (auth.uid() = user_id);
-- No insert/update/delete policies: the TV (creating a code) has no
-- auth.uid(), and claiming-by-code also can't rely on the claimer already
-- being the row's owner. Both writes go through service-role Route
-- Handlers built in the pairing feature slice, not here.


create table session_live_state (
  session_id              uuid primary key references sessions(id) on delete cascade,
  user_id                 uuid not null references auth.users(id) on delete cascade,

  current_block_index     integer not null default 0,
  current_item_index      integer not null default 0,
  seconds_remaining       integer not null default 0,
  is_paused               boolean not null default false,

  pending_command         text
    check (pending_command in ('pause','resume','skip','add_30s','swap','done','end')),
  pending_command_payload jsonb,
  cue_level               text not null default 'key'
    check (cue_level in ('off','key','full')),

  updated_at              timestamptz not null default now(),
  created_at              timestamptz not null default now()
);

alter table session_live_state enable row level security;

create policy "select own live state" on session_live_state for select
  to authenticated using (auth.uid() = user_id);
-- No insert/update/delete policies here either: TV ticks (~2s) go through
-- a service-role Route Handler. The phone's 750ms poll reads this table
-- *directly* via its own authenticated client though (select policy above
-- covers that) — no server hop needed for the higher-frequency reader.

commit;
