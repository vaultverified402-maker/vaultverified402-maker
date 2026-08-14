-- Vault Verified Operator Command Center
-- Read-only service-role operational surface for tracing consultant onboarding and first filing.
-- Intentionally not exposed to anon/authenticated clients.

create schema if not exists private;

create table if not exists private.operator_journey_events (
  id uuid primary key default gen_random_uuid(),
  application_id text,
  profile_id text,
  auth_user_id uuid,
  event_type text not null,
  detail jsonb not null default '{}'::jsonb,
  error_code text,
  created_at timestamptz not null default now()
);

revoke all on private.operator_journey_events from public, anon, authenticated;
grant select, insert on private.operator_journey_events to service_role;

create index if not exists operator_journey_events_app_idx on private.operator_journey_events(application_id, created_at desc);
create index if not exists operator_journey_events_profile_idx on private.operator_journey_events(profile_id, created_at desc);

create or replace function public.get_operator_command_center()
returns table (
  application_id text,
  submitted_at timestamptz,
  application_status text,
  program text,
  full_name text,
  primary_handle text,
  contact_email text,
  review_started_at timestamptz,
  approval_ready_at timestamptz,
  profile_id text,
  profile_status text,
  lifecycle_status text,
  profile_created_at timestamptz,
  auth_user_id uuid,
  last_sign_in_at timestamptz,
  total_records bigint,
  last_record_id text,
  last_record_at timestamptz,
  last_journey_event text,
  last_journey_event_at timestamptz,
  last_error_code text
)
language sql
security definer
set search_path = public, private, auth
as $$
  with last_record as (
    select distinct on (r.profile_id)
      r.profile_id,
      r.record_id,
      coalesce(r.preserved_at, r.created_at) as record_at
    from public.records r
    order by r.profile_id, coalesce(r.preserved_at, r.created_at) desc nulls last
  ),
  record_counts as (
    select r.profile_id, count(*)::bigint as total_records
    from public.records r
    group by r.profile_id
  )
  select
    a.application_id,
    a.submitted_at,
    a.status,
    a.program,
    a.full_name,
    a.primary_handle,
    a.contact_email,
    a.review_started_at,
    a.approval_ready_at,
    p.profile_id,
    p.status,
    p.lifecycle_status,
    p.created_at,
    p.auth_user_id,
    u.last_sign_in_at,
    coalesce(rc.total_records, 0),
    lr.record_id,
    lr.record_at,
    le.event_type,
    le.created_at,
    le.error_code
  from public.consultant_applications a
  left join public.profiles p on p.application_id = a.application_id
  left join auth.users u on u.id = p.auth_user_id
  left join record_counts rc on rc.profile_id = p.profile_id
  left join last_record lr on lr.profile_id = p.profile_id
  left join lateral (
    select e.event_type, e.created_at, e.error_code
    from private.operator_journey_events e
    where e.application_id = a.application_id
       or (p.profile_id is not null and e.profile_id = p.profile_id)
    order by e.created_at desc
    limit 1
  ) le on true
  where a.program in ('vault_verified_free','founding_verified_operator')
  order by a.submitted_at desc;
$$;

revoke all on function public.get_operator_command_center() from public, anon, authenticated;
grant execute on function public.get_operator_command_center() to service_role;

create or replace function private.capture_operator_application_journey()
returns trigger
language plpgsql
security definer
set search_path = private, public
as $$
begin
  if tg_op = 'INSERT' then
    if new.program in ('vault_verified_free','founding_verified_operator') then
      insert into private.operator_journey_events(application_id,event_type,detail)
      values (new.application_id,'application_submitted',jsonb_build_object('status',new.status,'program',new.program));
    end if;
  elsif new.program in ('vault_verified_free','founding_verified_operator') then
    if new.review_started_at is distinct from old.review_started_at and new.review_started_at is not null then
      insert into private.operator_journey_events(application_id,event_type) values (new.application_id,'review_started');
    end if;
    if new.approval_ready_at is distinct from old.approval_ready_at and new.approval_ready_at is not null then
      insert into private.operator_journey_events(application_id,event_type) values (new.application_id,'approved');
    end if;
    if new.status is distinct from old.status then
      insert into private.operator_journey_events(application_id,event_type,detail)
      values (new.application_id,'application_status_changed',jsonb_build_object('from',old.status,'to',new.status));
    end if;
  end if;
  return new;
end;
$$;

create or replace function private.capture_operator_profile_journey()
returns trigger
language plpgsql
security definer
set search_path = private, public
as $$
begin
  if new.consultant_type is distinct from 'Verified' then return new; end if;
  if not exists (
    select 1
    from public.consultant_applications a
    where a.application_id = new.application_id
      and a.program in ('vault_verified_free','founding_verified_operator')
  ) then return new; end if;

  if tg_op = 'INSERT' then
    insert into private.operator_journey_events(application_id,profile_id,auth_user_id,event_type,detail)
    values (new.application_id,new.profile_id,new.auth_user_id,'profile_created',jsonb_build_object('status',new.status,'lifecycle_status',new.lifecycle_status));
  elsif new.auth_user_id is distinct from old.auth_user_id and new.auth_user_id is not null then
    insert into private.operator_journey_events(application_id,profile_id,auth_user_id,event_type)
    values (new.application_id,new.profile_id,new.auth_user_id,'auth_linked');
  end if;
  return new;
end;
$$;

create or replace function private.capture_operator_record_journey()
returns trigger
language plpgsql
security definer
set search_path = private, public
as $$
begin
  insert into private.operator_journey_events(application_id,profile_id,event_type,detail)
  select new.application_id,new.profile_id,'selection_filed',jsonb_build_object('record_id',new.record_id,'event',new.event,'selection',new.selection)
  where exists (
    select 1
    from public.profiles p
    join public.consultant_applications a on a.application_id = p.application_id
    where p.profile_id = new.profile_id
      and p.consultant_type = 'Verified'
      and a.program in ('vault_verified_free','founding_verified_operator')
  );
  return new;
end;
$$;

drop trigger if exists trg_operator_application_journey on public.consultant_applications;
create trigger trg_operator_application_journey
after insert or update on public.consultant_applications
for each row execute function private.capture_operator_application_journey();

drop trigger if exists trg_operator_profile_journey on public.profiles;
create trigger trg_operator_profile_journey
after insert or update of auth_user_id on public.profiles
for each row execute function private.capture_operator_profile_journey();

drop trigger if exists trg_operator_record_journey on public.records;
create trigger trg_operator_record_journey
after insert on public.records
for each row execute function private.capture_operator_record_journey();

revoke all on function private.capture_operator_application_journey() from public, anon, authenticated;
revoke all on function private.capture_operator_profile_journey() from public, anon, authenticated;
revoke all on function private.capture_operator_record_journey() from public, anon, authenticated;
