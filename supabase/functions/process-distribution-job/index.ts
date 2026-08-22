import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
const json=(status:number,body:unknown)=>new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json"}});
const F:Record<string,string>={"A":"01110/10001/10001/11111/10001/10001/10001","B":"11110/10001/10001/11110/10001/10001/11110","C":"01111/10000/10000/10000/10000/10000/01111","D":"11110/10001/10001/10001/10001/10001/11110","E":"11111/10000/10000/11110/10000/10000/11111","F":"11111/10000/10000/11110/10000/10000/10000","G":"01111/10000/10000/10111/10001/10001/01111","H":"10001/10001/10001/11111/10001/10001/10001","I":"11111/00100/00100/00100/00100/00100/11111","J":"00111/00010/00010/00010/10010/10010/01100","K":"10001/10010/10100/11000/10100/10010/10001","L":"10000/10000/10000/10000/10000/10000/11111","M":"10001/11011/10101/10101/10001/10001/10001","N":"10001/11001/10101/10011/10001/10001/10001","O":"01110/10001/10001/10001/10001/10001/01110","P":"11110/10001/10001/11110/10000/10000/10000","Q":"01110/10001/10001/10001/10101/10010/01101","R":"11110/10001/10001/11110/10100/10010/10001","S":"01111/10000/10000/01110/00001/00001/11110","T":"11111/00100/00100/00100/00100/00100/00100","U":"10001/10001/10001/10001/10001/10001/01110","V":"10001/10001/10001/10001/10001/01010/00100","W":"10001/10001/10001/10101/10101/10101/01010","X":"10001/10001/01010/00100/01010/10001/10001","Y":"10001/10001/01010/00100/00100/00100/00100","Z":"11111/00001/00010/00100/01000/10000/11111","0":"01110/10001/10011/10101/11001/10001/01110","1":"00100/01100/00100/00100/00100/00100/01110","2":"01110/10001/00001/00010/00100/01000/11111","3":"11110/00001/00001/01110/00001/00001/11110","4":"00010/00110/01010/10010/11111/00010/00010","5":"11111/10000/10000/11110/00001/00001/11110","6":"01110/10000/10000/11110/10001/10001/01110","7":"11111/00001/00010/00100/01000/01000/01000","8":"01110/10001/10001/01110/10001/10001/01110","9":"01110/10001/10001/01111/00001/00001/01110","-":"00000/00000/00000/11111/00000/00000/00000","@":"01110/10001/10111/10101/10111/10000/01111",".":"00000/00000/00000/00000/00000/00110/00110","/":"00001/00010/00010/00100/01000/01000/10000",":":"00000/00110/00110/00000/00110/00110/00000","(":"00010/00100/01000/01000/01000/00100/00010",")":"01000/00100/00010/00010/00010/00100/01000","+":"00000/00100/00100/11111/00100/00100/00000"," ":"00000/00000/00000/00000/00000/00000/00000","?":"01110/10001/00001/00010/00100/00000/00100"};
const W=1080,H=1350;type C=[number,number,number,number];const BG:C=[5,5,5,255],CY:C=[0,212,255,255],WH:C=[245,245,243,255],GR:C=[138,138,138,255],LN:C=[38,38,38,255];
function rect(px:Uint8Array,x:number,y:number,w:number,h:number,c:C){for(let yy=Math.max(0,y);yy<Math.min(H,y+h);yy++)for(let xx=Math.max(0,x);xx<Math.min(W,x+w);xx++){const i=(yy*W+xx)*4;px[i]=c[0];px[i+1]=c[1];px[i+2]=c[2];px[i+3]=c[3];}}
function text(px:Uint8Array,s:unknown,x:number,y:number,scale:number,c:C,max=80){let cx=x;for(const raw of String(s??"").toUpperCase().slice(0,max)){const rows=(F[raw]||F["?"]).split("/");for(let ry=0;ry<7;ry++)for(let rx=0;rx<5;rx++)if(rows[ry][rx]==="1")rect(px,cx+rx*scale,y+ry*scale,scale,scale,c);cx+=6*scale;}}
function u32(n:number){return new Uint8Array([(n>>>24)&255,(n>>>16)&255,(n>>>8)&255,n&255]);}
let CT:Uint32Array|undefined;function crc(b:Uint8Array){if(!CT){CT=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=(c&1)?0xedb88320^(c>>>1):c>>>1;CT[n]=c>>>0;}}let c=0xffffffff;for(const x of b)c=CT[(c^x)&255]^(c>>>8);return(c^0xffffffff)>>>0;}
function cat(...a:Uint8Array[]){const n=a.reduce((s,x)=>s+x.length,0),o=new Uint8Array(n);let p=0;for(const x of a){o.set(x,p);p+=x.length;}return o;}
function chunk(t:string,d:Uint8Array){const tb=new TextEncoder().encode(t),body=cat(tb,d);return cat(u32(d.length),body,u32(crc(body)));}
async function pngCard(r:any,p:any,tierLabel:string){const px=new Uint8Array(W*H*4);for(let i=0;i<px.length;i+=4){px[i]=5;px[i+1]=5;px[i+2]=5;px[i+3]=255;}rect(px,0,0,W,8,CY);text(px,"VAULT VERIFIED",70,70,6,CY,20);text(px,"PUBLIC RECORD IMMUTABLE",70,135,3,GR,32);rect(px,70,205,940,2,LN);text(px,"RECORD",70,250,4,GR);text(px,r.record_id,70,320,7,WH,24);rect(px,70,420,330,70,LN);rect(px,73,423,324,64,BG);text(px,String(r.status||"PRESERVED"),92,440,4,CY,18);rect(px,70,545,940,2,LN);text(px,"EVENT",70,590,4,GR);text(px,String(r.event||"EVENT"),70,650,5,WH,32);text(px,"SELECTION",70,755,4,GR);text(px,String(r.selection||"SELECTION FILED"),70,815,5,WH,32);if(r.odds)text(px,"ODDS "+r.odds,70,895,4,CY,24);rect(px,70,980,940,2,LN);text(px,"CONSULTANT",70,1030,4,GR);text(px,"@"+p.handle,70,1090,5,WH,28);text(px,p.profile_id+" / "+tierLabel,70,1160,3,GR,28);rect(px,70,1240,940,2,LN);text(px,"THIS RECORD CANNOT BE EDITED AFTER FILING",70,1270,2,GR,48);text(px,"VAULTVERIFIED.APP",70,1310,2,GR,28);const raw=new Uint8Array((W*4+1)*H);for(let y=0;y<H;y++){const o=y*(W*4+1);raw[o]=0;raw.set(px.subarray(y*W*4,(y+1)*W*4),o+1);}const cs=new CompressionStream("deflate");const ab=await new Response(new Blob([raw]).stream().pipeThrough(cs)).arrayBuffer();const ih=cat(u32(W),u32(H),new Uint8Array([8,6,0,0,0]));return cat(new Uint8Array([137,80,78,71,13,10,26,10]),chunk("IHDR",ih),chunk("IDAT",new Uint8Array(ab)),chunk("IEND",new Uint8Array()));}
async function sha(b:Uint8Array){return[...new Uint8Array(await crypto.subtle.digest("SHA-256",b))].map(x=>x.toString(16).padStart(2,"0")).join("");}
function safe(e:unknown,...secrets:string[]){let s=String(e);for(const w of secrets)if(w)s=s.replaceAll(w,"[REDACTED]");return s;}

async function sendDiscord(webhook:string,content:string,attachBytes:Uint8Array|null){
  const form=new FormData();
  form.append("payload_json",JSON.stringify({content}));
  if(attachBytes)form.append("file",new Blob([attachBytes],{type:"image/png"}),"record-card.png");
  const dr=await fetch(`${webhook}?wait=true`,{method:"POST",body:form});
  const db=await dr.json().catch(()=>({}));
  if(!dr.ok||!db?.id)throw new Error(`Discord ${dr.status}: ${JSON.stringify(db).slice(0,300)}`);
  return db;
}

async function buildCard(sb:any,r:any,p:any,tierLabel:string,pathSuffix:string){
  let{data:ar,error:ae}=await sb.rpc("get_artifact_for_record",{p_record_id:r.record_id,p_asset_type:`record_card_${pathSuffix}`});
  if(ae)throw new Error(`artifact lookup: ${ae.message}`);
  let a=Array.isArray(ar)?ar[0]:ar;
  let bytes:Uint8Array;
  if(!a||a.mime_type!=="image/png"){
    bytes=await pngCard(r,p,tierLabel);
    const h=await sha(bytes),path=`${p.handle}/${r.record_id}/record_card.${pathSuffix}.png`;
    const{error:ue}=await sb.storage.from("record-cards").upload(path,bytes,{contentType:"image/png",upsert:true});
    if(ue)throw new Error(`artifact upload: ${ue.message}`);
    const{error:rg}=await sb.rpc("register_artifact",{p_record_id:r.record_id,p_asset_type:`record_card_${pathSuffix}`,p_template_id:"gg402-record-card-edge",p_template_version:`edge-v3-png-${pathSuffix}`,p_content_hash:h,p_storage_path:path,p_mime_type:"image/png",p_width:W,p_height:H});
    if(rg)throw new Error(`artifact register: ${rg.message}`);
  }else{
    const{data:b,error:de}=await sb.storage.from("record-cards").download(a.storage_path);
    if(de||!b)throw new Error(`artifact download: ${de?.message??"empty"}`);
    bytes=new Uint8Array(await b.arrayBuffer());
    if(await sha(bytes)!==a.content_hash)throw new Error("artifact hash mismatch");
  }
  return bytes;
}

Deno.serve(async(req:Request)=>{
if(req.method!=="POST")return json(405,{error:"POST only"});
let body:any={};try{body=await req.json()}catch{}
let freeWebhook=(Deno.env.get("GG402_DISCORD_WEBHOOK_URL")??"").trim();
const pre="GG402_DISCORD_WEBHOOK_URL=";if(freeWebhook.startsWith(pre))freeWebhook=freeWebhook.slice(pre.length).trim();
let premiumWebhook=(Deno.env.get("GG402_PREMIUM_DISCORD_WEBHOOK_URL")??"").trim();
const sb=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

if(body.mode==="health"){const{error}=await sb.from("records").select("id",{head:true,count:"exact"}).limit(1);return json(error?500:200,{ok:!error,mode:"health",free_discord_secret:freeWebhook.startsWith("https://discord.com/api/webhooks/")?"present":"invalid",premium_discord_secret:premiumWebhook.startsWith("https://discord.com/api/webhooks/")?"present":"invalid",database:error?error.message:"reachable"});}
if(!freeWebhook.startsWith("https://discord.com/api/webhooks/"))return json(503,{status:"unconfigured",detail:"free webhook missing/invalid"});

const owner=crypto.randomUUID();
await sb.rpc("recover_stale_distribution_jobs",{p_lease_seconds:300});
let ids:string[]=[];
if(body.job_id)ids=[body.job_id];
else{const{data,error}=await sb.rpc("list_pending_distribution_signals");if(error)return json(500,{status:"signal_list_failed",error:error.message});ids=(data??[]).map((x:any)=>x.job_id);}
if(!ids.length)return json(200,{status:"empty"});
const results:any[]=[];

for(const id of ids.slice(0,5)){
const{data:rows,error:ce}=await sb.rpc("claim_distribution_job",{p_job_id:id,p_owner_token:owner});
if(ce){results.push({job_id:id,status:"claim_failed",error:ce.message});continue;}
const job=Array.isArray(rows)?rows[0]:rows;
if(!job){results.push({job_id:id,status:"not_claimed"});continue;}
const tier=(job.distribution_tier==="FREE"||job.distribution_tier==="PREMIUM")?job.distribution_tier:"INTERNAL";

if(tier==="INTERNAL"){
  const{error:se}=await sb.rpc("suppress_distribution_job",{p_job_id:id});
  results.push({job_id:id,record_id:job.record_id,status:se?"suppress_failed":"suppressed",distribution_tier:"INTERNAL",error:se?.message});
  continue;
}

let r:any,p:any;
try{
  const{data:rr,error:re}=await sb.from("records").select("record_id,profile_id,event,selection,odds,status").eq("record_id",job.record_id).single();
  if(re||!rr)throw new Error(`record fetch: ${re?.message??"not found"}`);
  r=rr;
  const{data:pp,error:pe}=await sb.from("profiles").select("profile_id,handle").eq("profile_id",r.profile_id).single();
  if(pe||!pp)throw new Error(`profile fetch: ${pe?.message??"not found"}`);
  p=pp;
}catch(e){
  results.push({job_id:id,record_id:job.record_id,status:"failed",error:safe(e,freeWebhook,premiumWebhook)});
  continue;
}

const destinations:any={};

if(tier==="FREE"){
  try{
    const bytes=await buildCard(sb,r,p,"FREE","free-v3");
    const content=["GG402 SELECTION FILED",`${r.selection??"Selection filed"}${r.odds?` (${r.odds})`:""}`,"Record preserved before start",r.record_id,"","Independent record: Vault Verified",`https://vaultverified.app/record/${encodeURIComponent(r.record_id)}`].join("\n");
    const db=await sendDiscord(freeWebhook,content,bytes);
    await sb.rpc("record_distribution_attempt",{p_job_id:id,p_platform:"discord",p_status:"published",p_provider_response:db,p_external_post_id:String(db.id),p_published_url:null,p_error_code:null,p_error_message:null});
    destinations.discord={status:"published",message_id:String(db.id)};
  }catch(e){
    const m=safe(e,freeWebhook,premiumWebhook);
    try{await sb.rpc("record_distribution_attempt",{p_job_id:id,p_platform:"discord",p_status:"failed",p_provider_response:null,p_external_post_id:null,p_published_url:null,p_error_code:"PROCESSING_ERROR",p_error_message:m});}catch{}
    destinations.discord={status:"failed",error:m};
  }
  const{data:fin,error:fe}=await sb.rpc("finalize_distribution_job",{p_job_id:id,p_required_platforms:["discord"]});
  const finRow=Array.isArray(fin)?fin[0]:fin;
  results.push({job_id:id,record_id:r.record_id,distribution_tier:tier,destinations,final_status:fe?`finalize_failed: ${fe.message}`:finRow?.status});
  continue;
}

// -- PREMIUM: full selection, private channel, dedicated webhook. Whop is entitlement-only,
// not a required (or attempted) publishing destination. --
try{
  if(!premiumWebhook.startsWith("https://discord.com/api/webhooks/")){
    await sb.rpc("record_distribution_attempt",{p_job_id:id,p_platform:"discord_premium",p_status:"failed",p_provider_response:null,p_external_post_id:null,p_published_url:null,p_error_code:"UNCONFIGURED",p_error_message:"GG402_PREMIUM_DISCORD_WEBHOOK_URL missing/invalid"});
    destinations.discord_premium={status:"failed",error:"unconfigured"};
  }else{
    const bytes=await buildCard(sb,r,p,"PREMIUM","premium-v1");
    const content=["GG402 PREMIUM SELECTION FILED",`${r.selection??"Selection filed"}${r.odds?` (${r.odds})`:""}`,"Record preserved before start",r.record_id,"","Independent record: Vault Verified",`https://vaultverified.app/record/${encodeURIComponent(r.record_id)}`].join("\n");
    const db=await sendDiscord(premiumWebhook,content,bytes);
    await sb.rpc("record_distribution_attempt",{p_job_id:id,p_platform:"discord_premium",p_status:"published",p_provider_response:db,p_external_post_id:String(db.id),p_published_url:null,p_error_code:null,p_error_message:null});
    destinations.discord_premium={status:"published",message_id:String(db.id)};
  }
}catch(e){
  const m=safe(e,freeWebhook,premiumWebhook);
  try{await sb.rpc("record_distribution_attempt",{p_job_id:id,p_platform:"discord_premium",p_status:"failed",p_provider_response:null,p_external_post_id:null,p_published_url:null,p_error_code:"PROCESSING_ERROR",p_error_message:m});}catch{}
  destinations.discord_premium={status:"failed",error:m};
}

const{data:fin,error:fe}=await sb.rpc("finalize_distribution_job",{p_job_id:id,p_required_platforms:["discord_premium"]});
const finRow=Array.isArray(fin)?fin[0]:fin;
results.push({job_id:id,record_id:r.record_id,distribution_tier:tier,destinations,final_status:fe?`finalize_failed: ${fe.message}`:finRow?.status});
}
return json(200,{status:"processed",owner_token:owner,results});});
