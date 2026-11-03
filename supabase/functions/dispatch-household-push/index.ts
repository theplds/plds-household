import webpush from "npm:web-push@3.6.7";
const SUPABASE_URL=Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PUBLIC_KEY="BOBF5EPwXEmv0ZPHvNMdf0PmBG5bqWs0dK8Fb6D_hR_WjDT_MRDd9skdn-FniTb093gmK8mRRdiK3b3_urHLvAs";
const NEW_PUBLIC_KEY="BKY7JjUrF9797pFx2HqnLrZj_CB7RRiLoVLmkiycVW4RBSKAijHY59t9bfNMkEvV9nWGzOpyrLYemIWmdg0R_Pg";
const NEW_PRIVATE_KEY=Deno.env.get("PLDS_VAPID_PRIVATE_V2")||"";
let legacyKeyCache:string|null=null;
async function legacyKey(){
 if(legacyKeyCache)return legacyKeyCache;
 const value=await admin("rpc/get_legacy_push_signing_key","POST",{});
 if(typeof value!=="string"||value.length<30)throw Error("Legacy push signing key is unavailable");
 legacyKeyCache=value;
 return value;
}
async function vapidOptions(sub:{vapid_version?:number}){
 if(Number(sub.vapid_version)===2){
  if(!NEW_PRIVATE_KEY)throw Error("New VAPID key is not configured");
  return {TTL:86400,vapidDetails:{subject:"mailto:mpoulidis@gmail.com",publicKey:NEW_PUBLIC_KEY,privateKey:NEW_PRIVATE_KEY}};
 }
 return {TTL:86400,vapidDetails:{subject:"mailto:mpoulidis@gmail.com",publicKey:PUBLIC_KEY,privateKey:await legacyKey()}};
}
const headers={"Access-Control-Allow-Origin":"https://theplds.github.io","Access-Control-Allow-Headers":"authorization,apikey,content-type","Access-Control-Allow-Methods":"POST,OPTIONS","Content-Type":"application/json"};
function respond(obj:unknown,status=200){return new Response(JSON.stringify(obj),{status,headers});}
async function admin(path:string,method="GET",body?:unknown){
 const r=await fetch(SUPABASE_URL+"/rest/v1/"+path,{method,headers:{"apikey":SERVICE_KEY,"Authorization":"Bearer "+SERVICE_KEY,"Content-Type":"application/json","Prefer":"return=representation"},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const raw=await r.text();if(!r.ok)throw Error("Database "+r.status+": "+raw.slice(0,180));return raw?JSON.parse(raw):[];
}
Deno.serve(async req=>{
 if(req.method==="OPTIONS")return new Response(null,{headers});
 if(req.method!=="POST")return respond({error:"Method not allowed"},405);
 try{
  const token=(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"");
  if(!token)return respond({error:"Unauthorized"},401);
  const auth=await fetch(SUPABASE_URL+"/auth/v1/user",{headers:{"apikey":Deno.env.get("SUPABASE_ANON_KEY")||"","Authorization":"Bearer "+token}});
  if(!auth.ok)return respond({error:"Unauthorized"},401);
  const user=await auth.json();if(!user.id)return respond({error:"Unauthorized"},401);
  const memberships=await admin("household_members?select=household_id&user_id=eq."+encodeURIComponent(user.id));
  if(!memberships.length)return respond({error:"Not a household member"},403);
  const allowed=memberships.map((m:{household_id:string})=>m.household_id);

  const input=await req.json().catch(()=>({}));
  if(input?.check_vapid===true){
   return respond({ok:true,v2_secret_configured:NEW_PRIVATE_KEY.length>0,v2_public_key:NEW_PUBLIC_KEY,legacy_subscriptions_supported:true});
  }
  const since=new Date(Date.now()-600000).toISOString();
  const changes=await admin("change_log?select=id,household_id,actor_id,entity_type,action,details,changed_at&actor_id=eq."+encodeURIComponent(user.id)+"&changed_at=gte."+encodeURIComponent(since)+"&order=id.desc&limit=100");
  let sent=0,attempted=0;
  for(const change of changes){
   if(!allowed.includes(change.household_id))continue;
   const targets=await admin("push_subscriptions?select=id,endpoint,p256dh,auth_secret,user_id,vapid_version&household_id=eq."+change.household_id+"&user_id=neq."+user.id);
   const label=({activities:"Activity",schedules:"Weekly session",session_overrides:"Lesson",payments:"Payment",children:"Child profile",activity_children:"Activity assignment",schedule_children:"Weekly assignment"} as Record<string,string>)[change.entity_type]||"Household";
   const verb=({INSERT:"added",UPDATE:"updated",DELETE:"deleted"} as Record<string,string>)[change.action]||"changed";
   const name=typeof change.details?.name==="string"?change.details.name:"";
   const actor=(user.email||"").toLowerCase()==="voulgaridouioanna@hotmail.com"?"Ioanna":(user.email||"").toLowerCase()==="mpoulidis@gmail.com"?"Michael":"A household member";
   // Display the scheduled lesson time, never the notification/change timestamp.
   let scheduled="";
   const d=change.details||{};
   const fmtDate=(v:string)=>/^\\d{4}-\\d{2}-\\d{2}$/.test(v)?v.slice(8,10)+"/"+v.slice(5,7)+"/"+v.slice(0,4):"";
   const fmtTime=(v:string)=>/^\\d{2}:\\d{2}/.test(v)?v.slice(0,5):"";
   let schedule=d;
   if(change.entity_type==="session_overrides"&&d.schedule_id){
    const rows=await admin("schedules?select=id,weekday,start_time,valid_from,valid_until,activity_id&id=eq."+encodeURIComponent(d.schedule_id));
    schedule=rows[0]||{};
   }else if(change.entity_type==="activities"&&d.id){
    const rows=await admin("schedules?select=id,weekday,start_time,valid_from,valid_until,activity_id&activity_id=eq."+encodeURIComponent(d.id)+"&order=valid_from.desc&limit=2");
    if(rows.length===1)schedule=rows[0];
   }
   if(change.entity_type==="session_overrides"){
    const date=fmtDate(String(d.new_date||d.session_date||""));
    const time=fmtTime(String(d.new_time||schedule.start_time||""));
    if(date&&time)scheduled=date+" · "+time;
   }else if((change.entity_type==="schedules"||change.entity_type==="activities")&&Number.isInteger(schedule.weekday)&&schedule.start_time){
    // Weekly sessions: show the next scheduled occurrence in Europe/Athens.
    const local=new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Athens",year:"numeric",month:"2-digit",day:"2-digit",weekday:"short"}).formatToParts(new Date());
    const part=(type:string)=>local.find(p=>p.type===type)?.value||"";
    const base=new Date(Date.UTC(Number(part("year")),Number(part("month"))-1,Number(part("day"))));
    const weekdays=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
    const target=Number(schedule.weekday);
    // Database weekday convention: Monday=1, Sunday=7.
    const jsDay=target===7?0:target;
    let delta=(jsDay-base.getUTCDay()+7)%7;
    base.setUTCDate(base.getUTCDate()+delta);
    const iso=base.toISOString().slice(0,10);
    if(schedule.valid_from&&iso<schedule.valid_from)scheduled="";
    else if(schedule.valid_until&&iso>schedule.valid_until)scheduled="";
    else scheduled=fmtDate(iso)+" · "+fmtTime(String(schedule.start_time));
   }
   const message=(actor+" "+verb.toLowerCase()+" "+label.toLowerCase()+(name?" · "+name:"")+(scheduled?" | "+scheduled:"")).slice(0,180);
   for(const sub of targets){
    const prev=await admin("push_deliveries?select=log_id,status&log_id=eq."+change.id+"&subscription_id=eq."+sub.id);
    if(prev.some((x:{status?:string})=>x.status==="accepted"))continue;
    attempted++;
    try{
     if(!prev.length)await admin("push_deliveries","POST",{log_id:change.id,subscription_id:sub.id,status:"pending",attempted_at:new Date().toISOString()});
    }catch(e){if(String(e).includes("409"))continue;throw e;}
    try{
     await webpush.sendNotification({endpoint:sub.endpoint,keys:{p256dh:sub.p256dh,auth:sub.auth_secret}},
      JSON.stringify({title:"PLDS Household",body:message,tag:"plds-"+change.id,url:"https://theplds.github.io/plds-household/"}),await vapidOptions(sub));
     await admin("push_deliveries?log_id=eq."+change.id+"&subscription_id=eq."+sub.id,"PATCH",{status:"accepted",last_error:null,attempted_at:new Date().toISOString()});
     sent++;
    }catch(e){
     if((e as {statusCode?:number}).statusCode===404||(e as {statusCode?:number}).statusCode===410){
      await admin("push_deliveries?log_id=eq."+change.id+"&subscription_id=eq."+sub.id,"PATCH",{status:"failed",last_error:"Subscription expired",attempted_at:new Date().toISOString()});
      await admin("push_subscriptions?id=eq."+sub.id,"DELETE");
     }else{
      await admin("push_deliveries?log_id=eq."+change.id+"&subscription_id=eq."+sub.id,"PATCH",{status:"failed",last_error:String(e).slice(0,180),attempted_at:new Date().toISOString()});
      console.error("Push delivery failed",String(e).slice(0,220));
     }
    }
   }
  }
  return respond({ok:true,sent,attempted});
 }catch(e){console.error("Dispatch error",String(e).slice(0,250));return respond({error:"Notification delivery unavailable"},500);}
});