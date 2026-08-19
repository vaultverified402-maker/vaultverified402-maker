-- Vault Verified Operator Activation Command Center
-- Read-only service-role operational surface over current production truth.
-- No duplicate journey ledger and no new lifecycle triggers.

create or replace function public.get_operator_command_center()
returns table (
  application_id text,
  submitted_at timestamptz,
  application_status text,
  program text,
  full_name text,
  primary_handle text,
  contact_email text,
  profile_id text,
  profile_status text,
  lifecycle_status text,
  profile_created_at timestamptz,
  auth_user_id uuid,
  last_sign_in_at timestamptz,
  first_record_at timestamptz,
  total_records bigint,
  last_record_id text,
  last_record_at timestamptz,
  activation_state text,
  acquisition_prospect_id uuid,
  acquisition_stage text,
  acquisition_next_action text,
  acquisition_blocker_code text,
  acquisition_requires_human_approval boolean
)
language sql
security definer
set search_path = public, private, acquisition, auth, pg_temp
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
  ),
  matched_prospect as (
    select
      p.id as prospect_id,
      p.canonical_handle,
      q.stage,
      q.next_action,
      q.blocker_code,
      q.requires_human_approval
    from acquisition.prospects p
    left join private.operator_activation_queue q on q.prospect_id = p.id
  )
  select
    a.application_id,
    a.submitted_at,
    a.status,
    a.program,
    a.full_name,
    a.primary_handle,
    a.contact_email,
    pr.profile_id,
    pr.status,
    pr.lifecycle_status,
    pr.created_at,
    pr.auth_user_id,
    u.last_sign_in_at,
    pr.first_record_at,
    coalesce(rc.total_records, pr.total_records::bigint, 0::bigint),
    lr.record_id,
    lr.record_at,
    case
      when pr.profile_id is null then 'ENROLLMENT_NOT_ESTABLISHED'
      when pr.first_record_at is not null or coalesce(rc.total_records, pr.total_records::bigint, 0::bigint) > 0 then 'ACTIVATED'
      else 'FIRST_RECORD_DUE'
    end,
    mp.prospect_id,
    mp.stage,
    mp.next_action,
    mp.blocker_code,
    mp.requires_human_approval
  from public.consultant_applications a
  left join public.profiles pr on pr.application_id = a.application_id
  left join auth.users u on u.id = pr.auth_user_id
  left join record_counts rc on rc.profile_id = pr.profile_id
  left join last_record lr on lr.profile_id = pr.profile_id
  left join lateral (
    select m.*
    from matched_prospect m
    where lower(regexp_replace(coalesce(m.canonical_handle,''),'^@','','g')) =
          lower(regexp_replace(coalesce(pr.handle,a.primary_handle,a.platform_handle,''),'^@','','g'))
    limit 1
  ) mp on true
  where a.program in ('vault_verified_free','founding_verified_operator')
  order by a.submitted_at desc;
$$;

revoke all on function public.get_operator_command_center() from public, anon, authenticated;
grant execute on function public.get_operator_command_center() to service_role;
