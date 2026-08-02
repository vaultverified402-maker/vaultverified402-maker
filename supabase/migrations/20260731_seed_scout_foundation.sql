-- SEED + Scout foundation for Vault Verified
-- Database-enforced evidence preservation and least-privilege agent access.

create extension if not exists pgcrypto;
create schema if not exists private;

-- Runtime role is NOLOGIN. Create a separate LOGIN role after migration and grant
-- membership in seed_scout_runtime; never use service_role for Scout.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'seed_scout_runtime') then
    create role seed_scout_runtime nologin noinherit;
  end if;
end $$;

create table if not exists public.seed_consultants (
  id uuid primary key default gen_random_uuid(),
  seed_key text not null unique,
  display_name text,
  primary_handle text not null,
  primary_platform text not null,
  profile_url text,
  follower_count integer,
  public_picks_detected boolean not null default false,
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
  seed_id uuid not null references public.seed_consultants(id) on delete restrict,
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
  seed_id uuid not null references public.seed_consultants(id) on delete restrict,
  idempotency_key text not null unique,
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

create table if not exists public.scout_runs (
  id uuid primary key default gen_random_uuid(),
  agent_name text not null,
  run_key text not null unique,
  owner_token uuid not null,
  status text not null default 'running'
    check (status in ('running','completed','partial','failed')),
  started_at timestamptz not null default now(),
  lease_expires_at timestamptz not null,
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
alter table public.scout_runs enable row level security;

revoke all on public.seed_consultants, public.seed_observations, public.seed_actions, public.scout_runs
  from public, anon, authenticated, service_role, seed_scout_runtime;

-- Immutable evidence trigger: observations can only be inserted.
create or replace function private.reject_seed_observation_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception 'seed_observations are append-only';
end;
$$;

drop trigger if exists seed_observations_append_only on public.seed_observations;
create trigger seed_observations_append_only
before update or delete on public.seed_observations
for each row execute function private.reject_seed_observation_mutation();

create or replace function private.scout_upsert_candidate(p_candidate jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seed public.seed_consultants;
  v_platform text := lower(trim(coalesce(p_candidate->>'platform', p_candidate->>'primary_platform', '')));
  v_handle text := lower(regexp_replace(trim(coalesce(p_candidate->>'handle', p_candidate->>'primary_handle', '')), '^@', ''));
  v_key text;
  v_score integer := greatest(0, least(100, coalesce((p_candidate->>'opportunity_score')::integer, 0)));
  v_state text;
begin
  if v_platform = '' or v_handle = '' then raise exception 'platform and handle are required'; end if;
  v_key := v_platform || ':' || v_handle;
  v_state := case when v_score >= 70 then 'outreach_ready' when v_score >= 45 then 'qualified' else 'discovered' end;

  insert into public.seed_consultants (
    seed_key, display_name, primary_handle, primary_platform, profile_url,
    follower_count, public_picks_detected, lifecycle_state, opportunity_score,
    score_reasons, source_type, source_ref, last_seen_at,
    last_public_activity_at, next_action_at, metadata
  ) values (
    v_key, nullif(trim(p_candidate->>'display_name'), ''), v_handle, v_platform,
    nullif(trim(p_candidate->>'profile_url'), ''), nullif(p_candidate->>'follower_count','')::integer,
    coalesce((p_candidate->>'public_picks_detected')::boolean, false), v_state, v_score,
    coalesce(p_candidate->'score_reasons','[]'::jsonb), coalesce(nullif(p_candidate->>'source_type',''),'api'),
    nullif(trim(p_candidate->>'source_ref'), ''), now(), nullif(p_candidate->>'last_public_activity_at','')::timestamptz,
    case when v_state='outreach_ready' then now() else null end,
    coalesce(p_candidate->'metadata','{}'::jsonb)
  )
  on conflict (seed_key) do update set
    display_name = coalesce(excluded.display_name, public.seed_consultants.display_name),
    profile_url = coalesce(excluded.profile_url, public.seed_consultants.profile_url),
    follower_count = coalesce(excluded.follower_count, public.seed_consultants.follower_count),
    public_picks_detected = public.seed_consultants.public_picks_detected or excluded.public_picks_detected,
    lifecycle_state = case
      when public.seed_consultants.lifecycle_state in ('contacted','replied','enrolled','declined','paused') then public.seed_consultants.lifecycle_state
      else excluded.lifecycle_state end,
    opportunity_score = greatest(public.seed_consultants.opportunity_score, excluded.opportunity_score),
    score_reasons = excluded.score_reasons,
    source_ref = coalesce(excluded.source_ref, public.seed_consultants.source_ref),
    last_seen_at = now(),
    last_public_activity_at = greatest(public.seed_consultants.last_public_activity_at, excluded.last_public_activity_at),
    next_action_at = coalesce(public.seed_consultants.next_action_at, excluded.next_action_at),
    metadata = public.seed_consultants.metadata || excluded.metadata,
    updated_at = now()
  returning * into v_seed;

  return jsonb_build_object('id',v_seed.id,'seed_key',v_seed.seed_key,'lifecycle_state',v_seed.lifecycle_state,'opportunity_score',v_seed.opportunity_score);
end;
$$;

create or replace function private.scout_append_observation(
  p_seed_id uuid, p_observation_type text, p_observed_at timestamptz,
  p_source_url text, p_source_fingerprint text, p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_id uuid;
begin
  insert into public.seed_observations(seed_id, observation_type, observed_at, source_url, source_fingerprint, payload)
  values(p_seed_id, p_observation_type, coalesce(p_observed_at,now()), p_source_url, p_source_fingerprint, coalesce(p_payload,'{}'::jsonb))
  on conflict(seed_id, source_fingerprint) do nothing
  returning id into v_id;
  return jsonb_build_object('id',v_id,'inserted',v_id is not null);
end;
$$;

create or replace function private.scout_queue_action(
  p_seed_id uuid, p_idempotency_key text, p_action_type text,
  p_priority integer, p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_action public.seed_actions;
begin
  insert into public.seed_actions(seed_id,idempotency_key,action_type,priority,payload)
  values(p_seed_id,p_idempotency_key,p_action_type,greatest(0,least(100,p_priority)),coalesce(p_payload,'{}'::jsonb))
  on conflict(idempotency_key) do update set
    priority = greatest(public.seed_actions.priority, excluded.priority),
    payload = public.seed_actions.payload || excluded.payload,
    updated_at = now()
  returning * into v_action;
  return jsonb_build_object('id',v_action.id,'idempotency_key',v_action.idempotency_key,'action_state',v_action.action_state);
end;
$$;

create or replace function private.scout_begin_run(p_run_key text, p_owner_token uuid, p_lease_seconds integer default 900)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_run public.scout_runs;
begin
  insert into public.scout_runs(agent_name,run_key,owner_token,lease_expires_at)
  values('seed-scout',p_run_key,p_owner_token,now()+make_interval(secs=>greatest(60,p_lease_seconds)))
  on conflict(run_key) do update set
    owner_token = excluded.owner_token,
    status = 'running',
    started_at = now(),
    lease_expires_at = excluded.lease_expires_at,
    finished_at = null
  where public.scout_runs.status <> 'completed'
    and public.scout_runs.lease_expires_at < now()
  returning * into v_run;

  if v_run.id is null then
    select * into v_run from public.scout_runs where run_key=p_run_key;
  end if;
  return jsonb_build_object('id',v_run.id,'status',v_run.status,'owner_token',v_run.owner_token,'acquired',v_run.owner_token=p_owner_token);
end;
$$;

create or replace function private.scout_finish_run(
  p_run_key text, p_owner_token uuid, p_status text,
  p_input_count integer, p_output_count integer, p_error_count integer, p_summary jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_run public.scout_runs;
begin
  if p_status not in ('completed','partial','failed') then raise exception 'invalid final status'; end if;
  update public.scout_runs set
    status=p_status, finished_at=now(), input_count=p_input_count,
    output_count=p_output_count, error_count=p_error_count,
    summary=coalesce(p_summary,'{}'::jsonb)
  where run_key=p_run_key and owner_token=p_owner_token and status='running'
  returning * into v_run;
  if v_run.id is null then raise exception 'run ownership mismatch or run not active'; end if;
  return jsonb_build_object('id',v_run.id,'status',v_run.status);
end;
$$;

-- Scope revocations to Scout-owned functions only. Never alter unrelated private functions.
revoke all on function private.reject_seed_observation_mutation() from public, anon, authenticated, service_role;
revoke all on function private.scout_upsert_candidate(jsonb) from public, anon, authenticated, service_role;
revoke all on function private.scout_append_observation(uuid,text,timestamptz,text,text,jsonb) from public, anon, authenticated, service_role;
revoke all on function private.scout_queue_action(uuid,text,text,integer,jsonb) from public, anon, authenticated, service_role;
revoke all on function private.scout_begin_run(text,uuid,integer) from public, anon, authenticated, service_role;
revoke all on function private.scout_finish_run(text,uuid,text,integer,integer,integer,jsonb) from public, anon, authenticated, service_role;

grant usage on schema private to seed_scout_runtime;
grant execute on function private.scout_upsert_candidate(jsonb) to seed_scout_runtime;
grant execute on function private.scout_append_observation(uuid,text,timestamptz,text,text,jsonb) to seed_scout_runtime;
grant execute on function private.scout_queue_action(uuid,text,text,integer,jsonb) to seed_scout_runtime;
grant execute on function private.scout_begin_run(text,uuid,integer) to seed_scout_runtime;
grant execute on function private.scout_finish_run(text,uuid,text,integer,integer,integer,jsonb) to seed_scout_runtime;

comment on table public.seed_consultants is 'Persistent consultant intelligence. No direct Vault profile link; enrollment requires a separately governed bridge.';
comment on table public.seed_observations is 'Database-enforced append-only public observations.';
comment on table public.seed_actions is 'Human-governed, idempotent action queue.';
comment on table public.scout_runs is 'Leased, idempotent execution ledger for Scout.';
