import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
const json=(status:number,body:unknown)=>new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json"}});

// Deliberate, operator-invoked only. Never called by DISPATCH or any cron path.
// Sends exactly one real message to the discovered channel and, only on confirmed
// delivery (a real Whop message id in the response), sets validated_at plus concrete
// evidence (message id, channel id) -- not just a timestamp.
Deno.serve(async(req:Request)=>{
  if(req.method!=="POST")return json(405,{error:"POST only"});
  const whopApiKey=(Deno.env.get("GG402_WHOP_API_KEY")??"").trim();
  const sb=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  if(!whopApiKey)return json(503,{status:"unconfigured",detail:"GG402_WHOP_API_KEY not set"});

  const {data:acct,error:ae}=await sb
    .from("seed_platform_accounts")
    .select("id,external_account_ref,discovered_at,validated_at")
    .eq("platform","whop")
    .maybeSingle();
  if(ae||!acct)return json(500,{status:"account_lookup_failed",error:ae?.message});

  if(!acct.external_account_ref||!acct.discovered_at){
    return json(400,{status:"not_discovered",detail:"Run gg402-whop-discover-channel first -- external_account_ref/discovered_at are not set."});
  }

  const content=[
    "GG402 WHOP INTEGRATION TEST",
    "This is a controlled validation message, not a real selection.",
    `Sent ${new Date().toISOString()}`
  ].join("\n");

  const wr=await fetch("https://api.whop.com/api/v1/messages",{
    method:"POST",
    headers:{"content-type":"application/json","authorization":`Bearer ${whopApiKey}`},
    body:JSON.stringify({channel_id:acct.external_account_ref,content})
  });
  const wb=await wr.json().catch(()=>({}));

  if(!wr.ok||!wb?.id){
    return json(wr.status,{
      status:"validation_send_failed",
      detail:"Test message was not delivered. validated_at NOT set. Check chat:message:create permission on the API key.",
      whop_status:wr.status,
      whop_error:wb?.error??wb
    });
  }

  const{error:ue}=await sb
    .from("seed_platform_accounts")
    .update({
      validated_at:new Date().toISOString(),
      validated_message_id:String(wb.id),
      validated_channel_id:acct.external_account_ref,
      validated_note:`Controlled test message delivered to channel ${acct.external_account_ref}, Whop message id ${wb.id}`
    })
    .eq("id",acct.id);
  if(ue)return json(500,{status:"validated_but_persist_failed",whop_message_id:wb.id,error:ue.message});

  return json(200,{
    status:"validated",
    whop_message_id:String(wb.id),
    channel_id:acct.external_account_ref,
    note:"validated_at, validated_message_id, and validated_channel_id are now set. If is_enabled is also true, DISPATCH will attempt live Whop sends for PREMIUM jobs starting next cron cycle."
  });
});
