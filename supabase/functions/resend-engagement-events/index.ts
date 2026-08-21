import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { Webhook } from "npm:svix";

const H={"content-type":"application/json","cache-control":"no-store"};
const J=(s:number,b:unknown)=>new Response(JSON.stringify(b),{status:s,headers:H});

Deno.serve(async (req:Request)=>{
  if(req.method!=="POST") return J(405,{error:"POST only"});
  const svixId=req.headers.get("svix-id");
  const svixTs=req.headers.get("svix-timestamp");
  const svixSig=req.headers.get("svix-signature");
  if(!svixId||!svixTs||!svixSig) return J(400,{error:"missing_signature_headers"});
  const raw=await req.text();
  const admin=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:secret,error:se}=await admin.rpc("get_resend_engagement_webhook_secret_api");
  if(se||!secret) return J(503,{error:"webhook_secret_unconfigured"});
  let evt:any;
  try{
    evt=new Webhook(String(secret)).verify(raw,{"svix-id":svixId,"svix-timestamp":svixTs,"svix-signature":svixSig});
  }catch{
    return J(401,{error:"invalid_signature"});
  }
  const allowed=new Set(["email.delivered","email.opened","email.clicked","email.bounced","email.complained","email.failed","email.suppressed"]);
  if(!allowed.has(String(evt?.type||""))) return J(200,{status:"ignored",event_type:evt?.type||null});
  const to=Array.isArray(evt?.data?.to)?evt.data.to:[];
  const recipient=to.length?String(to[0]).trim().toLowerCase():null;
  const payload={provider_event_id:svixId,event_type:String(evt.type),provider_message_id:evt?.data?.email_id??null,recipient_email:recipient,occurred_at:evt?.created_at??new Date().toISOString(),payload:evt};
  const {data,error}=await admin.rpc("ingest_resend_engagement_event_api",{p_event:payload});
  if(error) return J(500,{error:"ingest_failed",detail:error.message});
  return J(200,{ok:true,result:data});
});