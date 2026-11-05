import {parseSportsEmail,normalizeEmailAddress} from "./parser.mjs";

// Resend sends a signed metadata-only event. After signature verification we
// retrieve email content server-to-server; no provider token reaches the browser.
const serviceUrl=Deno.env.get('SUPABASE_URL')||'';
const serviceKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
const resendKey=Deno.env.get('RESEND_API_KEY')||'';
const webhookSecret=Deno.env.get('RESEND_WEBHOOK_SECRET')||'';
const inboundDomain=(Deno.env.get('INBOUND_EMAIL_DOMAIN')||'').trim().toLowerCase();
const response=(status:number,obj:unknown)=>new Response(JSON.stringify(obj),{
 status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}
});
function decodeBase64(s:string):Uint8Array{
 const normalized=s.replace(/-/g,'+').replace(/_/g,'/');
 const bin=atob(normalized.padEnd(Math.ceil(normalized.length/4)*4,'='));
 return Uint8Array.from(bin,c=>c.charCodeAt(0));
}
async function isVerified(req:Request,raw:string):Promise<boolean>{
 const id=req.headers.get('svix-id'),timestamp=req.headers.get('svix-timestamp'),
  signature=req.headers.get('svix-signature');
 if(!id||!timestamp||!signature||!webhookSecret.startsWith('whsec_'))return false;
 if(!/^[\w.-]{4,120}$/.test(id)||!/^\d{10}$/.test(timestamp))return false;
 if(Math.abs(Date.now()/1000-Number(timestamp))>300)return false;
 try{
  const secretBytes=decodeBase64(webhookSecret.slice(6));
  const key=await crypto.subtle.importKey('raw',secretBytes,{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const expected=new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(
   id+'.'+timestamp+'.'+raw)));
  for(const entry of signature.split(' ')){
   if(!entry.startsWith('v1,'))continue;
   const actual=decodeBase64(entry.slice(3));
   let difference=actual.length^expected.length;
   for(let i=0;i<expected.length;i++)difference|=expected[i]^(actual[i]||0);
   if(difference===0)return true;
  }
  return false;
 }catch{return false;}
}
async function pg(path:string,method='GET',body?:unknown,prefer?:string){
 const result=await fetch(serviceUrl+'/rest/v1/'+path,{
  method,
  headers:{apikey:serviceKey,Authorization:'Bearer '+serviceKey,
   'Content-Type':'application/json',...(prefer?{Prefer:prefer}:{})},
  body:body===undefined?undefined:JSON.stringify(body),
  signal:AbortSignal.timeout(12000)
 });
 if(!result.ok)throw Error('Database request failed: '+result.status);
 const text=await result.text();return text?JSON.parse(text):null;
}
const safeText=(s:unknown,limit:number)=>String(s||'').slice(0,limit);
Deno.serve(async(req:Request)=>{
 if(req.method!=='POST')return response(405,{error:'Method not allowed'});
 // Fail closed until the external provider is configured by the owner.
 if(!serviceUrl||!serviceKey||!resendKey||!webhookSecret||
  !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(inboundDomain))
  return response(503,{error:'Inbound email integration is not configured'});
 const raw=await req.text();
 if(raw.length>250000)return response(413,{error:'Payload too large'});
 if(!await isVerified(req,raw))return response(401,{error:'Invalid signature'});
 let event;
 try{event=JSON.parse(raw)}catch{return response(400,{error:'Invalid JSON'})}
 if(event?.type!=='email.received')return response(200,{ok:true,ignored:'event_type'});
 const emailId=event?.data?.email_id;
 if(typeof emailId!=='string'||!/^[0-9a-f-]{36}$/i.test(emailId))return response(400,{error:'Invalid email ID'});
 const addresses=(Array.isArray(event.data.to)?event.data.to:[])
  .map((x:unknown)=>normalizeEmailAddress(x));
 // Never infer household identity from sender/name/subject; routing requires
 // an unguessable, per-household recipient token plus configured domain.
 const tokens=[...new Set(addresses.filter((x:string)=>x.endsWith('@'+inboundDomain))
   .map((x:string)=>x.slice(0,-inboundDomain.length-1)))];
 if(tokens.length!==1||!/^[a-f0-9]{64}$/.test(tokens[0]))
  return response(200,{ok:true,ignored:'no_unique_household_inbox'});
 try{
  const configs=await pg('household_email_intake?inbox_token=eq.'+encodeURIComponent(tokens[0])+
   '&enabled=eq.true&select=household_id,allowed_sender,activity_id,child_id');
  if(!Array.isArray(configs)||configs.length!==1)return response(200,{ok:true,ignored:'disabled_inbox'});
  const config=configs[0];
  const mailResponse=await fetch('https://api.resend.com/emails/receiving/'+encodeURIComponent(emailId)+'?html_format=cid',{
   headers:{Authorization:'Bearer '+resendKey},signal:AbortSignal.timeout(12000)
  });
  if(!mailResponse.ok)return response(502,{error:'Provider email retrieval failed'});
  const email=await mailResponse.json();
  const sender=normalizeEmailAddress(email?.from||'');
  if(!sender||sender!==config.allowed_sender)return response(200,{ok:true,ignored:'sender_not_allowed'});
  const actualTo=(Array.isArray(email?.to)?email.to:[]).map((x:unknown)=>normalizeEmailAddress(x));
  if(!actualTo.includes(tokens[0]+'@'+inboundDomain))
   return response(200,{ok:true,ignored:'recipient_mismatch'});
  const subject=safeText(email?.subject,300);
  const bodyText=safeText(email?.text,150000);
  const html=safeText(email?.html,150000);
  let proposals=parseSportsEmail({text:bodyText,html});
  if(!proposals.length&&html)proposals=parseSportsEmail({html});
  const excerpt=(bodyText||html.replace(/<[^>]*>/g,' ')).replace(/\s+/g,' ').slice(0,700);
  const created=await pg('household_email_inbox?on_conflict=provider_email_id','POST',[{
   household_id:config.household_id,provider_email_id:emailId,sender,subject,excerpt,
   status:proposals.length?'new':'unparsed',
   received_at:email?.created_at||event?.created_at||new Date().toISOString()
  }],'resolution=ignore-duplicates,return=representation');
  if(!Array.isArray(created)||!created.length)
   return response(200,{ok:true,ignored:'already_processed'});
  const inboxId=created[0].id;
  if(proposals.length){
   await pg('household_email_proposals?on_conflict=inbox_id,proposed_date,start_time,end_time',
    'POST',proposals.map((p:any)=>({
     household_id:config.household_id,inbox_id:inboxId,
     proposed_date:p.proposed_date,start_time:p.start_time,end_time:p.end_time,
     venue:p.venue,description:p.description,
     activity_id:config.activity_id,child_id:config.child_id
    })),'resolution=ignore-duplicates,return=minimal');
  }
  return response(200,{ok:true,proposals:proposals.length});
 }catch(e){
  // Return non-2xx for provider retries, but never expose message content.
  console.error('Inbound processing failed',e instanceof Error?e.message:'unknown');
  return response(503,{error:'Inbound message could not be processed'});
 }
});
