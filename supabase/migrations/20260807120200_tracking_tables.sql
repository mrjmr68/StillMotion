begin;

create table sessions (
  id                      uuid primary key default gen_random_uuid(),
  user_id                 uuid not null references auth.users(id) on delete cascade,

  status                  text not null default 'planned'
    check (status in ('planned','active','completed','abandoned')),

  requested_duration_min  integer not null check (requested_duration_min > 0),

  checkin_input           jsonb not null,
  plan_generated          jsonb not null,
  plan_performed          jsonb,

  rating                  text check (rating in ('easy','right','hard')),
  note                    text,

  started_at              timestamptz,
  completed_at            timestamptz,

  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create trigger trg_sessions_updated_at
  before update on sessions
  for each row execute function set_updated_at();

create index idx_sessions_user_recency on sessions (user_id, created_at desc);

create unique index uq_sessions_one_active_per_user
  on sessions (user_id) where status = 'active';

alter table sessions enable row level security;

create policy "select own sessions" on sessions for select
  to authenticated using (auth.uid() = user_id);
create policy "insert own sessions" on sessions for insert
  to authenticated with check (auth.uid() = user_id);
create policy "update own sessions" on sessions for update
  to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "delete own sessions" on sessions for delete
  to authenticated using (auth.uid() = user_id);


create table exercise_logs (
  id                      uuid primary key default gen_random_uuid(),
  session_id              uuid not null references sessions(id) on delete cascade,
  user_id                 uuid not null references auth.users(id) on delete cascade,

  block_index             integer not null check (block_index >= 0),
  item_index              integer not null check (item_index >= 0),
  side                    text check (side in ('left','right')),

  exercise_id             text not null references exercise_catalog(id),
  swapped_to_exercise_id  text references exercise_catalog(id),
  was_swapped             boolean not null default false,
  was_skipped             boolean not null default false,

  prescribed_dose         numeric not null check (prescribed_dose > 0),
  completed_dose          numeric check (completed_dose is null or completed_dose >= 0),
  rest_seconds            integer check (rest_seconds is null or rest_seconds >= 0),

  load                    jsonb,

  created_at              timestamptz not null default now(),

  constraint uq_exercise_log_slot unique (session_id, block_index, item_index, side)
);

create index idx_exercise_logs_user on exercise_logs (user_id);
create index idx_exercise_logs_recency on exercise_logs (user_id, exercise_id, created_at desc);

alter table exercise_logs enable row level security;

create policy "select own exercise logs" on exercise_logs for select
  to authenticated using (auth.uid() = user_id);
create policy "insert own exercise logs" on exercise_logs for insert
  to authenticated with check (auth.uid() = user_id);
create policy "update own exercise logs" on exercise_logs for update
  to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "delete own exercise logs" on exercise_logs for delete
  to authenticated using (auth.uid() = user_id);


create table cardio_logs (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users(id) on delete cascade,
  session_id         uuid references sessions(id) on delete set null,

  type               text not null check (type in ('walk','run','bike','swim','hike','other')),

  duration_seconds   integer check (duration_seconds is null or duration_seconds > 0),
  distance_meters    integer check (distance_meters is null or distance_meters > 0),
  steps              integer check (steps is null or steps > 0),
  constraint at_least_one_metric check (
    num_nonnulls(duration_seconds, distance_meters, steps) >= 1
  ),

  performed_at       timestamptz not null default now(),
  note               text,
  created_at         timestamptz not null default now()
);

create index idx_cardio_logs_user_recency on cardio_logs (user_id, performed_at desc);

alter table cardio_logs enable row level security;

create policy "select own cardio logs" on cardio_logs for select
  to authenticated using (auth.uid() = user_id);
create policy "insert own cardio logs" on cardio_logs for insert
  to authenticated with check (auth.uid() = user_id);
create policy "update own cardio logs" on cardio_logs for update
  to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "delete own cardio logs" on cardio_logs for delete
  to authenticated using (auth.uid() = user_id);

commit;
