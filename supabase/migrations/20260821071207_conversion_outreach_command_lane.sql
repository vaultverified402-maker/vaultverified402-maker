create or replace function public.get_conversion_outreach_tasks_api()
returns table(prospect_id uuid,prospect_ref text,prospect_name text,handle text,platform text,profile_url text,language_code text,qualification_score numeric,stage text,message_text text,activation_url text)
language sql security definer set search_path=''
as $$
select distinct on(q.prospect_id) q.prospect_id,p.prospect_ref,coalesce(nullif(p.canonical_name,''),nullif(i.display_name,''),p.canonical_handle,'Operator'),coalesce(nullif(i.handle,''),nullif(i.platform_identity,''),p.canonical_handle),i.platform,i.profile_url,coalesce(nullif(p.language_code,''),'en'),p.qualification_score,q.stage,
case when coalesce(nullif(p.language_code,''),'en') ilike 'es%' then 'Tus selecciones ya son públicas. Lo que falta es un registro independiente antes de que exista el resultado. Preserva tu primera selección gratis: https://www.vaultverified.app/apply.html?source=telegram_operator&utm_campaign=preserve_first_pick'
else 'Your picks are already public. What is missing is an independent record before the result exists. Preserve your first pick free: https://www.vaultverified.app/apply.html?source=telegram_operator&utm_campaign=preserve_first_pick' end,
'https://www.vaultverified.app/apply.html?source=telegram_operator&utm_campaign=preserve_first_pick'::text
from private.operator_activation_queue q join acquisition.prospects p on p.id=q.prospect_id join acquisition.identities i on i.prospect_id=q.prospect_id
where q.stage='READY_FOR_OUTREACH' and i.platform='telegram' and coalesce(nullif(i.handle,''),nullif(i.platform_identity,''),p.canonical_handle) is not null
order by q.prospect_id,i.last_seen_at desc nulls last,i.id
$$;
revoke all on function public.get_conversion_outreach_tasks_api() from public,anon,authenticated;
grant execute on function public.get_conversion_outreach_tasks_api() to service_role;

create or replace function public.mark_conversion_outreach_contacted_api(p_prospect_id uuid,p_channel text)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_channel text:=lower(trim(coalesce(p_channel,'')));v_updated int:=0;
begin
if v_channel not in('telegram','email','whop','instagram','x','reddit','discord','web_form','sms') then raise exception 'unsupported channel';end if;
update acquisition.outreach_cohort set contacted_at=coalesce(contacted_at,now()) where prospect_id=p_prospect_id and channel=v_channel;
get diagnostics v_updated=row_count;
if not exists(select 1 from acquisition.funnel_events where prospect_id=p_prospect_id and event_type='OUTREACH_CONTACTED' and channel=v_channel) then
insert into acquisition.funnel_events(prospect_id,event_type,channel,campaign,occurred_at,metadata) values(p_prospect_id,'OUTREACH_CONTACTED',v_channel,'preserve_first_pick',now(),jsonb_build_object('source','operator_command_center'));
end if;
return jsonb_build_object('status','recorded','prospect_id',p_prospect_id,'channel',v_channel,'cohort_rows_updated',v_updated);
end $$;
revoke all on function public.mark_conversion_outreach_contacted_api(uuid,text) from public,anon,authenticated;
grant execute on function public.mark_conversion_outreach_contacted_api(uuid,text) to service_role;

create or replace function public.ingest_resend_engagement_event_api(p_event jsonb)
returns jsonb language plpgsql security definer set search_path='acquisition','private','public','pg_temp'
as $$
declare
v_event_id text:=coalesce(p_event->>'provider_event_id','');v_type text:=coalesce(p_event->>'event_type','');v_message_id text:=nullif(p_event->>'provider_message_id','');v_email text:=lower(nullif(trim(p_event->>'recipient_email'),''));v_occurred timestamptz:=coalesce(nullif(p_event->>'occurred_at','')::timestamptz,now());v_payload jsonb:=coalesce(p_event->'payload','{}'::jsonb);v_bounce_type text:=coalesce(v_payload#>>'{data,bounce,type}','');v_suppress boolean:=false;v_reason text;v_row_id bigint;v_prospect_id uuid;v_funnel_type text;
begin
if v_event_id='' or v_type='' then raise exception 'provider_event_id and event_type required';end if;
if v_type='email.complained' then v_suppress:=true;v_reason:='complaint';elsif v_type='email.suppressed' then v_suppress:=true;v_reason:='provider_suppressed';elsif v_type='email.bounced' and lower(v_bounce_type) in('permanent','hard') then v_suppress:=true;v_reason:='hard_bounce';end if;
insert into acquisition.engagement_provider_events(provider,provider_event_id,event_type,provider_message_id,recipient_email,occurred_at,payload,suppression_applied) values('resend',v_event_id,v_type,v_message_id,v_email,v_occurred,v_payload,v_suppress) on conflict(provider,provider_event_id) do nothing returning id into v_row_id;
if v_row_id is null then return jsonb_build_object('status','duplicate','event_id',v_event_id);end if;
select q.prospect_id into v_prospect_id from private.prospect_engagement_queue q where(v_message_id is not null and q.provider_message_id=v_message_id)or(v_message_id is null and v_email is not null and lower(q.recipient_email)=v_email) order by q.sent_at desc nulls last limit 1;
if v_type='email.delivered' then v_funnel_type:='EMAIL_DELIVERED';elsif v_type='email.opened' then v_funnel_type:='EMAIL_OPENED';elsif v_type='email.clicked' then v_funnel_type:='EMAIL_CLICKED';end if;
if v_prospect_id is not null and v_funnel_type is not null then
insert into acquisition.funnel_events(prospect_id,event_type,channel,campaign,occurred_at,metadata) values(v_prospect_id,v_funnel_type,'email','preserve_first_pick',v_occurred,jsonb_build_object('provider','resend','provider_event_id',v_event_id,'provider_message_id',v_message_id));
update acquisition.outreach_cohort set contacted_at=coalesce(contacted_at,v_occurred) where prospect_id=v_prospect_id and channel='email';
end if;
if v_suppress and v_email is not null then
insert into acquisition.engagement_suppressions(email,reason,source,metadata,channel,recipient_identity) values(v_email,v_reason,'resend_webhook',jsonb_build_object('provider_event_id',v_event_id,'event_type',v_type,'provider_message_id',v_message_id,'occurred_at',v_occurred,'bounce_type',nullif(v_bounce_type,'')),'email',v_email) on conflict(lower(email)) do update set metadata=coalesce(acquisition.engagement_suppressions.metadata,'{}'::jsonb)||excluded.metadata;
end if;
return jsonb_build_object('status','recorded','event_row_id',v_row_id,'suppression_applied',v_suppress,'recipient_email',v_email,'prospect_id',v_prospect_id,'funnel_event',v_funnel_type);
end $$;
revoke all on function public.ingest_resend_engagement_event_api(jsonb) from public,anon,authenticated;
grant execute on function public.ingest_resend_engagement_event_api(jsonb) to service_role;
