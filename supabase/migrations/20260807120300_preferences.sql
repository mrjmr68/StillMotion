begin;

create table user_preferences (
  user_id             uuid primary key references auth.users(id) on delete cascade,

  equipment_on_hand   text[] not null default '{}'
    check (equipment_on_hand <@ array['kettlebell','dumbbell','mat','wall','chair','band']::text[]),

  emphasis            text not null default 'full'
    check (emphasis in ('upper','lower','full','posterior_chain','core')),

  format_preference   text not null default 'let_it_choose'
    check (format_preference in ('let_it_choose','circuits','flow','straight_sets')),

  floor_tolerance     text not null default 'fine'
    check (floor_tolerance in ('fine','minimize_floor')),

  cue_level           text not null default 'key'
    check (cue_level in ('off','key','full')),

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create trigger trg_user_preferences_updated_at
  before update on user_preferences
  for each row execute function set_updated_at();

alter table user_preferences enable row level security;

create policy "select own preferences" on user_preferences for select
  to authenticated using (auth.uid() = user_id);
create policy "insert own preferences" on user_preferences for insert
  to authenticated with check (auth.uid() = user_id);
create policy "update own preferences" on user_preferences for update
  to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "delete own preferences" on user_preferences for delete
  to authenticated using (auth.uid() = user_id);


create table user_movement_preferences (
  user_id      uuid not null references auth.users(id) on delete cascade,
  exercise_id  text not null references exercise_catalog(id) on delete cascade,
  preference   text not null check (preference in ('include','exclude')),
  created_at   timestamptz not null default now(),
  primary key (user_id, exercise_id)
);

alter table user_movement_preferences enable row level security;

create policy "select own movement preferences" on user_movement_preferences for select
  to authenticated using (auth.uid() = user_id);
create policy "insert own movement preferences" on user_movement_preferences for insert
  to authenticated with check (auth.uid() = user_id);
create policy "update own movement preferences" on user_movement_preferences for update
  to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "delete own movement preferences" on user_movement_preferences for delete
  to authenticated using (auth.uid() = user_id);

commit;
