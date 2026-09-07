begin;

create table exercise_catalog (
  id                 text primary key,
  name               text not null,
  aka                text[] not null default '{}',

  modality           text not null
    check (modality in ('mobility','yoga','strength','capacity','balance','breath')),

  movement_pattern   text not null
    check (movement_pattern in (
      'hinge','squat','lunge','push_h','push_v','pull_h','pull_v',
      'rotate','anti_rotate','carry','gait','ground_transition'
    )),

  primary_regions    text[] not null default '{}'
    check (primary_regions <@ array[
      'ankle','knee','hip','spine','shoulder','elbow','wrist','neck','core'
    ]::text[]),
  secondary_regions  text[] not null default '{}'
    check (secondary_regions <@ array[
      'ankle','knee','hip','spine','shoulder','elbow','wrist','neck','core'
    ]::text[]),

  equipment          text[] not null default '{}'
    check (equipment <@ array['kettlebell','dumbbell','mat','wall','chair','band']::text[]),

  body_position      text not null
    check (body_position in ('standing','kneeling','seated','prone','supine','quadruped')),

  unilateral         boolean not null default false,

  timing_type        text not null
    check (timing_type in ('duration','reps','breaths','hold_per_side')),

  default_dose       integer not null check (default_dose > 0),

  rep_cap_seconds    integer check (rep_cap_seconds is null or rep_cap_seconds > 0),
  constraint rep_cap_matches_timing check (
    (timing_type = 'reps'  and rep_cap_seconds is not null) or
    (timing_type <> 'reps' and rep_cap_seconds is null)
  ),

  intensity          smallint not null check (intensity between 1 and 5),

  progression_id     text references exercise_catalog(id),
  regression_id      text references exercise_catalog(id),
  constraint progression_not_self check (progression_id is null or progression_id <> id),
  constraint regression_not_self check (regression_id is null or regression_id <> id),

  pairs_well_with    text[] not null default '{}',
  avoid_after        text[] not null default '{}',

  cues               text[] not null default '{}'
    check (cardinality(cues) between 1 and 6),

  setup_note         text,

  asset_tier         text not null check (asset_tier in ('still','pose_cycle','animated')),
  asset_path         text not null,
  loop_seconds       numeric(5,2) check (loop_seconds is null or loop_seconds > 0),

  is_anchor          boolean not null default false,

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create trigger trg_exercise_catalog_updated_at
  before update on exercise_catalog
  for each row execute function set_updated_at();

alter table exercise_catalog enable row level security;

create policy "catalog readable by authenticated users"
  on exercise_catalog for select
  to authenticated
  using (true);
-- No insert/update/delete policy for authenticated/anon: only the
-- service-role key (used by the catalog harness) can write, and it
-- bypasses RLS entirely by design.

commit;
