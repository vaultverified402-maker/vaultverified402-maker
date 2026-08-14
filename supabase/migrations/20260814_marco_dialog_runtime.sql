-- Marco OS autonomous-dialog runtime state.
-- DESIGN ONLY. Apply only to a dedicated Marco OS Supabase runtime, never the live Vault Verified project.

create schema if not exists marco_dialog;

create table if not exists marco_dialog.turn_leases (
  handoff_id text primary key,
  owner text not null,
  lease_token uuid not null,
  lease_expires_at timestamptz not null,
  state text not null check (state in ('LEASED','COMPLETED','INTERRUPTED')),
  provider text,
  provider_request_id text,
  attempt_count integer not null default 1 check (attempt_count > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table marco_dialog.turn_leases enable row level security;

-- No public/client policies by design. Only the dedicated dialog runtime service identity may access this schema.
revoke all on schema marco_dialog from anon, authenticated;
revoke all on all tables in schema marco_dialog from anon, authenticated;

create or replace function marco_dialog.acquire_turn_lease(
  p_handoff_id text,
  p_owner text,
  p_lease_token uuid,
  p_ttl_seconds integer default 180
)
returns table(acquired boolean, lease_token uuid, lease_expires_at timestamptz, attempt_count integer)
language plpgsql
security definer
set search_path = marco_dialog, pg_temp
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_exp timestamptz;
begin
  if p_handoff_id is null or btrim(p_handoff_id) = '' then
    raise exception 'handoff_id required';
  end if;
  if p_owner is null or btrim(p_owner) = '' then
    raise exception 'owner required';
  end if;
  if p_ttl_seconds < 30 or p_ttl_seconds > 900 then
    raise exception 'ttl out of range';
  end if;

  v_exp := v_now + make_interval(secs => p_ttl_seconds);

  insert into marco_dialog.turn_leases as t
    (handoff_id, owner, lease_token, lease_expires_at, state, attempt_count, created_at, updated_at)
  values
    (p_handoff_id, p_owner, p_lease_token, v_exp, 'LEASED', 1, v_now, v_now)
  on conflict (handoff_id) do update
    set owner = excluded.owner,
        lease_token = excluded.lease_token,
        lease_expires_at = excluded.lease_expires_at,
        state = 'LEASED',
        attempt_count = t.attempt_count + 1,
        updated_at = v_now
    where t.state = 'LEASED'
      and t.lease_expires_at < v_now;

  return query
  select
    (t.owner = p_owner and t.lease_token = p_lease_token and t.state = 'LEASED' and t.lease_expires_at > v_now),
    t.lease_token,
    t.lease_expires_at,
    t.attempt_count
  from marco_dialog.turn_leases t
  where t.handoff_id = p_handoff_id;
end;
$$;

create or replace function marco_dialog.complete_turn_lease(
  p_handoff_id text,
  p_owner text,
  p_lease_token uuid,
  p_state text,
  p_provider text default null,
  p_provider_request_id text default null
)
returns boolean
language plpgsql
security definer
set search_path = marco_dialog, pg_temp
as $$
declare
  v_count integer;
begin
  if p_state not in ('COMPLETED','INTERRUPTED') then
    raise exception 'invalid terminal state';
  end if;

  update marco_dialog.turn_leases
     set state = p_state,
         provider = p_provider,
         provider_request_id = p_provider_request_id,
         updated_at = clock_timestamp()
   where handoff_id = p_handoff_id
     and owner = p_owner
     and lease_token = p_lease_token
     and state = 'LEASED';

  get diagnostics v_count = row_count;
  return v_count = 1;
end;
$$;

revoke all on function marco_dialog.acquire_turn_lease(text,text,uuid,integer) from public;
revoke all on function marco_dialog.complete_turn_lease(text,text,uuid,text,text,text) from public;
