-- SEED + Scout foundation for Vault Verified
-- Persistent consultant intelligence without altering immutable record tables.

create extension if not exists pgcrypto;

create table if not exists public.seed_consultants (
  id uuid primary key default gen_random_uuid(),
  seed_key text not null unique,
  display_name text,
  primary_handle text not null,
  primary_platform text not null,
  profile_url text,
  follower_count integer,
  public_picks_detected boolean not null default false,
  vault_profile_id uuid,
  lifecycle_state text not null default 'discovered'
    check (lifecycle_state in ('discovered','qualified','outreach_ready','contacted','replied','enrolled','declined','paused')),
  opportunity_score integer not null default 0 check (opportunity_score between 0 and 100),
  score_reasons jsonb not null default '[]'::jsonb,
  source_type text not null default 'manual',
  source_ref text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  last_public_activity_at timestamptz,
  next_action_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists seed_consultants_queue_idx
  on public.seed_consultants (lifecycle_state, opportunity_score desc, next_action_at nulls first);
create index if not exists seed_consultants_platform_idx
  on public.seed_consultants (primary_platform, last_seen_at desc);

create table if not exists public.seed_observations (
  id uuid primary key default gen_random_uuid(),
  seed_id uuid not null references public.seed_consultants(id) on delete cascade,
  observation_type text not null,
  observed_at timestamptz not null default now(),
  source_url text,
  source_fingerprint text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(seed_id, source_fingerprint)
);

create index if not exists seed_observations_seed_time_idx
  on public.seed_observations (seed_id, observed_at desc);

create table if not exists public.seed_actions (
  id uuid primary key default gen_random_uuid(),
  seed_id uuid not null references public.seed_consultants(id) on delete cascade,
  action_type text not null,
  action_state text not null default 'pending'
    check (action_state in ('pending','approved','executed','failed','cancelled')),
  priority integer not null default 50 check (priority between 0 and 100),
  scheduled_for timestamptz,
  payload jsonb not null default '{}'::jsonb,
  result jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists seed_actions_queue_idx
  on public.seed_actions (action_state, priority desc, scheduled_for nulls first);

create table if not exists public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  agent_name text not null,
  run_key text not null unique,
  status text not null default 'running'
    check (status in ('running','completed','partial','failed')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  input_count integer not null default 0,
  output_count integer not null default 0,
  error_count integer not null default 0,
  summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.seed_consultants enable row level security;
alter table public.seed_observations enable row level security;
alter table public.seed_actions enable row level security;
alter table public.agent_runs enable row level security;

comment on table public.seed_consultants is 'Persistent intelligence layer for consultant discovery, qualification, outreach, and enrollment.';
comment on table public.seed_observations is 'Append-only public observations associated with a consultant seed.';
comment on table public.seed_actions is 'Human-governed action queue produced by agents.';
comment on table public.agent_runs is 'Idempotent execution ledger for autonomous workers.';
