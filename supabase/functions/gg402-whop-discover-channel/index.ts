import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
const json=(status:number,body:unknown)=>new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json"}});

Deno.serve(async(req:Request)=>{
  if(req.method!=="POST")return json(405,{error:"POST only"});
  const whopApiKey=(Deno.env.get("GG402_WHOP_API_KEY")??"").trim();
  const sb=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  if(!whopApiKey)return json(503,{status:"unconfigured",detail:"GG402_WHOP_API_KEY not set"});

  const {data:acct,error:ae}=await sb
    .from("seed_platform_accounts")
    .select("id,config,external_account_ref,discovered_at,validated_at")
    .eq("platform","whop")
    .maybeSingle();
  if(ae||!acct)return json(500,{status:"account_lookup_failed",error:ae?.message});

  const companyId=acct.config?.company_id;
  const targetExpId=acct.config?.target_experience_id;
  if(!companyId||!targetExpId){
    return json(400,{
      status:"missing_config",
      detail:"seed_platform_accounts.config must have company_id (biz_xxx) and target_experience_id (exp_xxx) set before running discovery",
      current_config:acct.config
    });
  }

  let cursor:string|null=null;
  let pages=0;
  const matches:any[]=[];
  const allSeen:any[]=[];
  do{
    const url=new URL("https://api.whop.com/api/v1/chat_channels");
    url.searchParams.set("company_id",companyId);
    url.searchParams.set("first","50");
    if(cursor)url.searchParams.set("after",cursor);
    const resp=await fetch(url.toString(),{headers:{authorization:`Bearer ${whopApiKey}`}});
    const respBody=await resp.json().catch(()=>({}));
    if(!resp.ok){
      return json(resp.status,{status:"discovery_failed",whop_status:resp.status,whop_error:respBody?.error??respBody});
    }
    for(const ch of (respBody.data??[])){
      allSeen.push({id:ch.id,experience_id:ch.experience?.id,experience_name:ch.experience?.name});
      if(ch.experience?.id===targetExpId)matches.push(ch);
    }
    cursor=respBody.page_info?.has_next_page?respBody.page_info?.end_cursor:null;
    pages++;
  }while(cursor&&pages<10);

  if(matches.length===0){
    return json(404,{
      status:"channel_not_found",
      detail:`No chat channel found for company ${companyId} attached to experience ${targetExpId}. Discovery deliberately does not fall back to any default -- fix target_experience_id or confirm the channel exists in Whop.`,
      channels_seen:allSeen
    });
  }
  if(matches.length>1){
    return json(409,{
      status:"ambiguous",
      detail:`Experience ${targetExpId} resolved to ${matches.length} channels. Refusing to guess which one is the paid destination. Set external_account_ref manually after confirming the correct channel, or narrow target_experience_id.`,
      candidates:matches.map(m=>({id:m.id,experience_id:m.experience.id,experience_name:m.experience.name,who_can_post:m.who_can_post}))
    });
  }

  const found=matches[0];
  const{error:ue}=await sb
    .from("seed_platform_accounts")
    .update({external_account_ref:found.id,discovered_at:new Date().toISOString(),discovered_note:`Resolved via experience ${targetExpId} ("${found.experience.name}"), single unambiguous match`})
    .eq("id",acct.id);
  if(ue)return json(500,{status:"persist_failed",error:ue.message});

  return json(200,{
    status:"discovered",
    channel_id:found.id,
    experience_id:found.experience.id,
    experience_name:found.experience.name,
    who_can_post:found.who_can_post,
    note:"external_account_ref and discovered_at persisted. validated_at is still null -- send a real controlled test message next; DISPATCH will not attempt live PREMIUM sends until validated_at is set."
  });
});
