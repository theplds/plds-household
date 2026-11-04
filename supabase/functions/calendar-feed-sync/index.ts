// Read-only calendar subscription synchronizer. Never handles household billing.
import "./calendar-import.js";
const API=Deno.env.get("SUPABASE_URL")||"";
const SERVICE=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
const ANON=Deno.env.get("SUPABASE_ANON_KEY")||"";
const ORIGIN="https://theplds.github.io";
const headers={
 "Access-Control-Allow-Origin":ORIGIN,
 "Access-Control-Allow-Headers":"authorization,apikey,content-type",
 "Access-Control-Allow-Methods":"POST,OPTIONS",
 "Content-Type":"application/json",
 "Cache-Control":"no-store"
};
const json=(o:unknown,status=200)=>new Response(JSON.stringify(o),{status,headers});
type Source={id:string;household_id:string;provider:string;label:string;created_by:string;last_synced_at:string|null};
type Entry={id:string;source_key:string;event_date:string;title:string;details:string;location:string;start_time:string|null;end_time:string|null;all_day:boolean;removed_from_source:boolean;child_id:string|null;activity_id:string|null;hidden:boolean};
type CalendarRow={source_key:string;event_date:string;title:string;details:string;location:string;start_time:string|null;end_time:string|null;all_day:boolean};
function providerHost(url:URL,provider:string){
 if(url.protocol!=="https:"||url.username||url.password||url.port||url.hash)return false;
 const host=url.hostname.toLowerCase();
 if(provider==="google")return ["calendar.google.com","calendar.googleusercontent.com"].includes(host);
 if(provider==="outlook")return ["outlook.office365.com","outlook.live.com","outlook.office.com"].includes(host);
 if(provider==="apple")return host==="icloud.com"||host.endsWith(".icloud.com");
 return false;
}
async function dataApi(path:string,method="GET",body?:unknown,extraHeaders:Record<string,string>={}):Promise<any>{
 if(!API||!SERVICE)throw Error("Calendar sync service configuration is unavailable");
 const res=await fetch(API+"/rest/v1/"+path,{
  method,
  headers:{"apikey":SERVICE,"Authorization":"Bearer "+SERVICE,"Content-Type":"application/json",
   "Prefer":"return=representation",...extraHeaders},
  ...(body===undefined?{}:{body:JSON.stringify(body)})
 });
 const raw=await res.text();
 if(!res.ok)throw Error("Database "+res.status+": "+(raw.slice(0,100)));
 try{return raw?JSON.parse(raw):[]}catch{throw Error("Invalid database response")}
}
async function fetchSubscription(secret:string,provider:string){
 let current=new URL(secret);
 for(let hop=0;hop<4;hop++){
  if(!providerHost(current,provider))throw Error("Calendar link has an unsupported or unsafe destination");
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),14000);
  let response:Response;
  try{response=await fetch(current.href,{redirect:"manual",headers:{"Accept":"text/calendar,application/octet-stream;q=0.9,*/*;q=0.1"},signal:controller.signal});}
  finally{clearTimeout(timer)}
  if([301,302,303,307,308].includes(response.status)){
   const target=response.headers.get("location");if(!target)throw Error("Calendar provider returned an invalid redirect");
   current=new URL(target,current);continue;
  }
  if(!response.ok)throw Error("Calendar provider returned HTTP "+response.status);
  if(Number(response.headers.get("content-length")||0)>2e6)throw Error("Calendar feed is larger than 2 MB");
  const reader=response.body?.getReader();if(!reader)throw Error("Calendar download was empty");
  const decoder=new TextDecoder(),parts:string[]=[];let size=0;
  while(true){
   const {done,value}=await reader.read();if(done)break;
   size+=value.length;if(size>2e6){await reader.cancel();throw Error("Calendar feed is larger than 2 MB")}
   parts.push(decoder.decode(value,{stream:true}));
  }
  parts.push(decoder.decode());
  const text=parts.join("");
  if(!text.includes("BEGIN:VCALENDAR")||!text.includes("BEGIN:VEVENT"))throw Error("Link did not return an event calendar");
  return text;
 }
 throw Error("Calendar link redirected too many times");
}
function dateRange(){
 const today=new Date(),a=new Date(Date.UTC(today.getUTCFullYear(),today.getUTCMonth()-6,1));
 const b=new Date(Date.UTC(today.getUTCFullYear(),today.getUTCMonth()+13,0));
 return {windowStart:a.toISOString().slice(0,10),windowEnd:b.toISOString().slice(0,10)};
}
async function syncSource(source:Source,force:boolean){
 if(source.last_synced_at&&Date.now()-Date.parse(source.last_synced_at)<(force?60000:15*60000))
  return {ok:true,skipped:true,reason:"Recently synchronized"};
 try{
  const secret=await dataApi("rpc/read_calendar_feed_secret","POST",{p_source_id:source.id});
  if(typeof secret!=="string"||!secret)throw Error("The saved calendar connection is unavailable");
  const raw=await fetchSubscription(secret,source.provider);
  const parser=(globalThis as any).HouseholdICS;
  if(!parser?.parse)throw Error("Calendar parser unavailable");
  const range=dateRange(),result=parser.parse(raw,{...range,limit:400});
  if(result.warnings.length)throw Error("Calendar contains unsupported occurrences. Sync skipped to avoid losing appointments: "+result.warnings[0]);
  if(result.events.length===400)throw Error("Calendar exceeds the 400-event limit; use a narrower subscription or contact support");
  const next:CalendarRow[]=result.events.map((event:CalendarRow)=>({...event,source_key:source.id+"|"+event.source_key}));
  const existing:Entry[]=await dataApi("calendar_import_events?select=id,source_key,event_date,title,details,location,start_time,end_time,all_day,removed_from_source,child_id,activity_id,hidden&source_id=eq."+source.id+"&limit=1000");
  if(existing.length>=1000)throw Error("Connected calendar has too many entries");
  const byKey=new Map(existing.map(e=>[e.source_key,e]));
  const changedKeys=new Set(next.map(e=>e.source_key));
  let created=0,updated=0,removed=0;
  const add:any[]=[];
  for(const entry of next){
   const old=byKey.get(entry.source_key);
   if(!old){add.push({...entry,source_id:source.id,household_id:source.household_id,created_by:source.created_by});continue}
   const patch:Record<string,unknown>={};
   for(const field of ["title","details","location","event_date","start_time","end_time","all_day"]){
    if(String((old as any)[field]??"")!==String((entry as any)[field]??""))patch[field]=(entry as any)[field];
   }
   if(old.removed_from_source)patch.removed_from_source=false;
   if(Object.keys(patch).length){
    await dataApi("calendar_import_events?id=eq."+old.id+"&source_id=eq."+source.id,"PATCH",patch);
    updated++;
   }
  }
  for(let i=0;i<add.length;i+=100){
   const batch=add.slice(i,i+100);
   const inserted=await dataApi("calendar_import_events?on_conflict=household_id%2Csource_key","POST",batch,{"Prefer":"resolution=ignore-duplicates,return=representation"});
   created+=Array.isArray(inserted)?inserted.length:batch.length;
  }
  // Only mark missing events after a complete, warning-free read. Their user-assigned
  // child/activity associations are preserved for audit and possible reappearance.
  // Ignore old events outside the calendar's bounded window.
  if(next.length){
   for(const old of existing){
    if(!old.removed_from_source&&old.event_date>=range.windowStart&&old.event_date<=range.windowEnd&&!changedKeys.has(old.source_key)){
     await dataApi("calendar_import_events?id=eq."+old.id+"&source_id=eq."+source.id,"PATCH",{removed_from_source:true});
     removed++;
    }
   }
  }
  await dataApi("calendar_sync_sources?id=eq."+source.id,"PATCH",
   {last_synced_at:new Date().toISOString(),last_error:null,last_event_count:next.length});
  return {ok:true,created,updated,removed,total:next.length};
 }catch(err){
  const message=(err instanceof Error?err.message:String(err)).slice(0,250);
  await dataApi("calendar_sync_sources?id=eq."+source.id,"PATCH",{last_error:message}).catch(()=>{});
  return {ok:false,error:message};
 }
}
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers});
 if(req.method!=="POST")return json({error:"Method not allowed"},405);
 try{
  // Never allow untrusted callers to set arbitrary household IDs.
  const token=(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"");
  if(!token)return json({error:"Sign in required"},401);
  const verified=await fetch(API+"/auth/v1/user",{
   headers:{"apikey":ANON,"Authorization":"Bearer "+token}
  });
  if(!verified.ok)return json({error:"Session expired; sign in again"},401);
  const user=await verified.json();if(!user.id)return json({error:"Not signed in"},401);
  const body=await req.json().catch(()=>({}));
  const sourceId=String(body.source_id||"");
  if(!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(sourceId))return json({error:"Invalid calendar source"},400);
  const sources=await dataApi("calendar_sync_sources?select=id,household_id,provider,label,created_by,last_synced_at&id=eq."+sourceId+"&limit=1");
  const source=sources[0] as Source|undefined;
  if(!source)return json({error:"Calendar not found"},404);
  const members=await dataApi("household_members?select=user_id&household_id=eq."+source.household_id+"&user_id=eq."+user.id+"&limit=1");
  if(!members.length)return json({error:"Calendar not accessible to this household account"},403);
  const outcome=await syncSource(source,body.force===true);
  return json(outcome,outcome.ok?200:422);
 }catch(err){
  return json({error:"Calendar sync failed: "+(err instanceof Error?err.message:String(err)).slice(0,190)},500);
 }
});
