create or replace function public.activate_first_pick(
  p_request_id uuid,
  p_full_name text,
  p_handle text,
  p_email text,
  p_event_id text,
  p_market_code text,
  p_side text,
  p_line numeric,
  p_prop_player text,
  p_prop_stat_code text,
  p_odds text,
  p_thesis text,
  p_confidence integer
)
returns table(
  success boolean,
  error_code text,
  replay boolean,
  application_id text,
  profile_id text,
  operator_handle text,
  record_id text,
  preserved_at timestamptz,
  record_hash text
)
language plpgsql
security definer
set search_path = 'public', 'extensions', 'pg_temp'
as $function$
declare
  v_existing record;
  v_validation record;
  v_application_id text;
  v_profile_id text;
  v_record_id text;
  v_handle text;
  v_email text;
  v_now timestamptz := now();
  v_hash_input text;
  v_hash text;
begin
  if p_request_id is null then
    return query select false,'request_id_required',false,null::text,null::text,null::text,null::text,null::timestamptz,null::text;
    return;
  end if;

  select r.record_id,r.profile_id,r.preserved_at,r.record_hash,p.handle,p.application_id
  into v_existing
  from public.records r
  join public.profiles p on p.profile_id=r.profile_id
  where r.request_id=p_request_id;

  if found then
    return query select true,'replay',true,v_existing.application_id,v_existing.profile_id,v_existing.handle,v_existing.record_id,v_existing.preserved_at,v_existing.record_hash;
    return;
  end if;

  v_handle := lower(regexp_replace(btrim(coalesce(p_handle,'')),'^@',''));
  v_email := lower(btrim(coalesce(p_email,'')));

  if length(btrim(coalesce(p_full_name,''))) < 2 then
    return query select false,'name_required',false,null::text,null::text,null::text,null::text,null::timestamptz,null::text;
    return;
  end if;
  if v_handle = '' or length(v_handle) > 40 then
    return query select false,'invalid_handle',false,null::text,null::text,null::text,null::text,null::timestamptz,null::text;
    return;
  end if;
  if v_email = '' or position('@' in v_email) < 2 then
    return query select false,'invalid_email',false,null::text,null::text,null::text,null::text,null::timestamptz,null::text;
    return;
  end if;
  if exists(select 1 from public.profiles p where lower(p.handle)=v_handle) then
    return query select false,'handle_taken',false,null::text,null::text,v_handle,null::text,null::timestamptz,null::text;
    return;
  end if;
  if exists(select 1 from public.profiles p where lower(p.email)=v_email and p.consultant_type='Verified' and p.status='active') then
    return query select false,'email_enrolled',false,null::text,null::text,v_handle,null::text,null::timestamptz,null::text;
    return;
  end if;

  select * into v_validation from public.validate_filing_request(
    p_event_id,p_market_code,p_side,p_line,p_prop_player,p_prop_stat_code,p_odds,p_thesis,p_confidence
  );

  if not v_validation.is_valid then
    return query select false,v_validation.errors[1],false,null::text,null::text,v_handle,null::text,null::timestamptz,null::text;
    return;
  end if;

  if v_validation.scheduled_start <= v_now then
    return query select false,'event_cutoff_passed',false,null::text,null::text,v_handle,null::text,null::timestamptz,null::text;
    return;
  end if;

  v_application_id := 'CON-FP-' || upper(replace(gen_random_uuid()::text,'-',''));

  insert into public.consultant_applications(
    application_id,full_name,primary_handle,platform,platform_handle,sports_covered,
    contact_email,status,ack_preevent,ack_permanent,program,application_version,
    source,review_started_at,review_completed_at,status_updated_at
  ) values (
    v_application_id,btrim(p_full_name),v_handle,'other',v_handle,v_validation.league,
    v_email,'accepted',true,true,'vault_verified_free','v3_first_pick',
    'organic_search',v_now,v_now,v_now
  );

  v_profile_id := public.activate_free_operator(v_application_id,'first_pick_activation');

  v_record_id := public.generate_record_id();
  v_hash_input :=
    v_record_id || '|' || v_profile_id || '|' || p_event_id || '|' || p_market_code || '|' ||
    coalesce(p_side,'') || '|' || coalesce(p_line::text,'') || '|' || coalesce(p_prop_player,'') || '|' ||
    coalesce(p_prop_stat_code,'') || '|' || coalesce(v_validation.normalized_selection_label,'') || '|' ||
    coalesce(p_odds,'') || '|' || coalesce(p_thesis,'') || '|' || coalesce(p_confidence::text,'') || '|' ||
    to_char(v_now at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
  v_hash := encode(extensions.digest(v_hash_input,'sha256'),'hex');

  insert into public.records(
    record_id,profile_id,application_id,request_id,event_id,sport,league,event,market,
    selection,odds,thesis,confidence,scheduled_start,preserved_at,lock_timestamp,
    pre_event_lock,status,source_type,decision_origin,consultant_origin,selection_method,
    record_hash,verification_level,created_at
  ) values (
    v_record_id,v_profile_id,v_application_id,p_request_id,p_event_id,v_validation.sport,v_validation.league,
    v_validation.away_team || ' @ ' || v_validation.home_team,p_market_code,
    v_validation.normalized_selection_label,p_odds,p_thesis,p_confidence,v_validation.scheduled_start,
    v_now,v_now,true,'preserved','pre_event_filing','HUMAN','REAL','MANUAL',v_hash,'UNVERIFIED',v_now
  );

  return query select true,'ok',false,v_application_id,v_profile_id,v_handle,v_record_id,v_now,v_hash;
end;
$function$;

revoke all on function public.activate_first_pick(uuid,text,text,text,text,text,text,numeric,text,text,text,text,integer) from public;
grant execute on function public.activate_first_pick(uuid,text,text,text,text,text,text,numeric,text,text,text,text,integer) to service_role;
