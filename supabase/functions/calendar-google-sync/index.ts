// Household Google Calendar: explicit read-only consent, Vault refresh credentials,
// household-scoped API access, and bounded incremental reconciliation while app is open.
const API=Deno.env.get("SUPABASE_URL")||"";
const SERVICE=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
const ANON=Deno.env.get("SUPABASE_ANON_KEY")||"";
const GOOGLE_ID=Deno.env.get("GOOGLE_OAUTH_CLIENT_ID")||"";
const GOOGLE_SECRET=Deno.env.get("GOOGLE_OAUTH_CLIENT_SECRET")||"";
const ORIGIN="https://theplds.github.io";
const CORS={"Access-Control-Allow-Origin":ORIGIN,
 "Access-Control-Allow-Headers":"authorization,apikey,content-type",
 "Access-Control-Allow-Methods":"POST,OPTIONS","Content-Type":"application/json",
 "Cache-Control":"no-store"};
const json=(obj:unknown,status=200)=>new Response(JSON.stringify(obj),{status,headers:CORS});
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TZ="Europe/Athens";
type Source={id:string;household_id:string;provider:string;created_by:string;
 connection_kind:string;google_calendar_id:string;last_synced_at:string|null};
type EventRow={source_key:string;event_date:string;title:string;details:string;
 location:string;start_time:string|null;end_time:string|null;all_day:boolean};
async function postgrest(path:string,method="GET",body?:unknown,headers:Record<string,string>={}):Promise<any>{
 if(!API||!SERVICE)throw Error("Server unavailable");
 const r=await fetch(API+"/rest/v1/"+path,{method,headers:{apikey:SERVICE,Authorization:"Bearer "+SERVICE,
  "Content-Type":"application/json",Prefer:"return=representation",...headers},
  ...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(18000)});
 if(!r.ok)throw Error("Calendar database request failed: "+r.status);
 const t=await r.text();return t?JSON.parse(t):null;
}
async function getGoogle(path:string,accessToken:string):Promise<any>{
 const response=await fetch("https://www.googleapis.com"+path,{headers:{Authorization:"Bearer "+accessToken},
  signal:AbortSignal.timeout(18000)});
 if(!response.ok){
  if(response.status===401)throw Error("Google permission expired. Reconnect the calendar.");
  if(response.status===403)throw Error("Google Calendar API is disabled or permission was denied.");
  throw Error("Google Calendar returned HTTP "+response.status);
 }
 return await response.json();
}
async function listGoogleCalendars(token:string){
 const calendars:any[]=[];let page="";
 for(let i=0;i<5;i++){
  const path="/calendar/v3/users/me/calendarList?maxResults=250&minAccessRole=reader"+
   (page?"&pageToken="+encodeURIComponent(page):"");
  const data=await getGoogle(path,token);
  for(const c of data.items||[]){
   if(c.deleted||!c.id)continue;
   calendars.push({id:String(c.id),label:String(c.summary||c.id).slice(0,80),
    primary:c.primary===true,selected:c.selected!==false});
  }
  if(!data.nextPageToken)break;
  page=String(data.nextPageToken);
 }
 return calendars;
}
async function refreshAccess(sourceId:string){
 if(!GOOGLE_ID||!GOOGLE_SECRET)throw Error("Google OAuth credentials are not configured for calendar sync.");
 const secret=await postgrest("rpc/read_google_calendar_refresh","POST",{p_source_id:sourceId});
 if(typeof secret!=="string"||!secret)throw Error("Google calendar connection is missing its refresh permission.");
 const data=new URLSearchParams({client_id:GOOGLE_ID,client_secret:GOOGLE_SECRET,
  refresh_token:secret,grant_type:"refresh_token"});
 const r=await fetch("https://oauth2.googleapis.com/token",{
  method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:data,
  signal:AbortSignal.timeout(18000)});
 if(!r.ok){
  if(r.status===400||r.status===401)throw Error("Google access expired or was revoked. Reconnect this calendar.");
  throw Error("Google token renewal failed: HTTP "+r.status);
 }
 const result=await r.json();
 if(!result.access_token)throw Error("Google did not return a calendar access token");
 return String(result.access_token);
}
function athensParts(raw:string){
 const date=new Date(raw);
 if(!Number.isFinite(date.getTime()))throw Error("Invalid event date");
 const parts=new Intl.DateTimeFormat("en-GB",{timeZone:TZ,year:"numeric",month:"2-digit",
  day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(date);
 const p:any={};for(const part of parts)if(part.type!=="literal")p[part.type]=part.value;
 return {day:p.year+"-"+p.month+"-"+p.day,time:p.hour+":"+p.minute};
}
function mapGoogleEvents(events:any[],sourceId:string):EventRow[]{
 const rows:EventRow[]=[];
 for(const e of events){
  if(!e||e.status==="cancelled"||!e.id||!e.start)continue;
  const title=String(e.summary||"Untitled appointment").slice(0,250);
  const details=String(e.description||"").slice(0,4000);
  const location=String(e.location||"").slice(0,500);
  if(e.start.date){
   const begin=String(e.start.date),end=String(e.end?.date||begin);
   const from=Date.parse(begin+"T12:00:00Z"),to=Date.parse(end+"T12:00:00Z");
   const days=Number.isFinite(from)&&Number.isFinite(to)?Math.max(1,Math.min(31,Math.ceil((to-from)/86400000))):1;
   for(let i=0;i<days;i++){
    const day=new Date(from+i*86400000).toISOString().slice(0,10);
    rows.push({source_key:sourceId+"|google:"+e.id+"|"+day,event_date:day,
     title,details,location,start_time:null,end_time:null,all_day:true});
   }
  }else if(e.start.dateTime){
   const start=athensParts(e.start.dateTime),end=e.end?.dateTime?athensParts(e.end.dateTime):null;
   rows.push({source_key:sourceId+"|google:"+e.id,event_date:start.day,title,details,location,
    start_time:start.time,end_time:end?.time||null,all_day:false});
  }
  if(rows.length>1500)throw Error("Too many Google appointments; select fewer calendars.");
 }
 return rows;
}
function syncRange(){
 const now=new Date(),start=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()-6,1));
 const end=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()+13,1));
 return {start:start.toISOString(),end:end.toISOString(),startDay:start.toISOString().slice(0,10),
  endDay:end.toISOString().slice(0,10)};
}
async function syncSource(source:Source,force:boolean){
 if(source.last_synced_at&&Date.now()-Date.parse(source.last_synced_at)<(force?60000:15*60000))
  return {ok:true,skipped:true};
 try{
  const access=await refreshAccess(source.id),range=syncRange(),items:any[]=[];
  let page="";
  for(let i=0;i<12;i++){
   const path="/calendar/v3/calendars/"+encodeURIComponent(source.google_calendar_id)+
    "/events?singleEvents=true&showDeleted=false&maxResults=250&timeMin="+
    encodeURIComponent(range.start)+"&timeMax="+encodeURIComponent(range.end)+
    (page?"&pageToken="+encodeURIComponent(page):"");
   const result=await getGoogle(path,access);
   items.push(...(result.items||[]));
   if(items.length>1500)throw Error("Google calendar has too many events to sync safely.");
   if(!result.nextPageToken){page="";break}
   page=String(result.nextPageToken);
  }
  if(page)throw Error("Google calendar is too large to sync completely.");
  const incoming=mapGoogleEvents(items,source.id);
  const existing=await postgrest("calendar_import_events?select=id,source_key,event_date,title,details,location,start_time,end_time,all_day,removed_from_source&source_id=eq."+
   source.id+"&limit=1700");
  if(existing.length>=1700)throw Error("Too many previously synced Google appointments.");
  const byKey=new Map(existing.map((e:any)=>[e.source_key,e]));
  const newKeys=new Set(incoming.map(e=>e.source_key));
  const created:any[]=[];let updated=0,removed=0;
  for(const event of incoming){
   const old:any=byKey.get(event.source_key);
   if(!old){created.push({...event,household_id:source.household_id,source_id:source.id,created_by:source.created_by});continue;}
   const patch:any={};
   for(const field of ["event_date","title","details","location","start_time","end_time","all_day"])
    if(String(old[field]??"")!==String((event as any)[field]??""))patch[field]=(event as any)[field];
   if(old.removed_from_source)patch.removed_from_source=false;
   if(Object.keys(patch).length){
    await postgrest("calendar_import_events?id=eq."+old.id+"&source_id=eq."+source.id,"PATCH",patch);
    updated++;
   }
  }
  let added=0;
  for(let i=0;i<created.length;i+=100){
   const batch=created.slice(i,i+100);
   const result=await postgrest("calendar_import_events?on_conflict=household_id%2Csource_key",
    "POST",batch,{Prefer:"resolution=ignore-duplicates,return=representation"});
   added+=Array.isArray(result)?result.length:0;
  }
  // A complete, successful list is required before marking missing source events removed.
  for(const old of existing){
   if(!old.removed_from_source&&old.event_date>=range.startDay&&old.event_date<range.endDay&&
    !newKeys.has(old.source_key)){
    await postgrest("calendar_import_events?id=eq."+old.id+"&source_id=eq."+source.id,
      "PATCH",{removed_from_source:true});removed++;
   }
  }
  await postgrest("calendar_sync_sources?id=eq."+source.id,"PATCH",{
   last_synced_at:new Date().toISOString(),last_error:null,last_event_count:incoming.length});
  return {ok:true,created:added,updated,removed,total:incoming.length};
 }catch(error){
  const message=(error instanceof Error?error.message:"Unknown Google Calendar failure").slice(0,250);
  await postgrest("calendar_sync_sources?id=eq."+source.id,"PATCH",{last_error:message}).catch(()=>{});
  return {ok:false,error:message};
 }
}
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers:CORS});
 if(req.method!=="POST")return json({error:"Method not allowed"},405);
 try{
  const jwt=(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"");
  if(!jwt)return json({error:"Sign in required"},401);
  const auth=await fetch(API+"/auth/v1/user",{
   headers:{apikey:ANON,Authorization:"Bearer "+jwt},signal:AbortSignal.timeout(10000)});
  if(!auth.ok)return json({error:"Session expired. Sign in again."},401);
  const user=await auth.json();if(!UUID.test(String(user.id||"")))return json({error:"Invalid account"},401);
  const memberships=await postgrest("household_members?select=household_id&user_id=eq."+user.id+"&limit=2");
  if(memberships.length!==1)return json({error:"A single household membership is required"},403);
  const household=String(memberships[0].household_id);
  const body=await req.json().catch(()=>({}));
  const action=String(body.action||"");
  if(action==="list"||action==="connect"){
   const token=String(body.provider_token||"");
   if(token.length<20||token.length>4096)return json({error:"Google calendar permission is missing."},400);
   // Only connect the same Google account as the authenticated household user.
   const identity=await getGoogle("/oauth2/v2/userinfo",token);
   if(String(identity.email||"").toLowerCase()!==String(user.email||"").toLowerCase())
    return json({error:"Select the same Google account you used to sign in to Household."},409);
   const calendars=await listGoogleCalendars(token);
   if(action==="list")return json({ok:true,calendars});
   if(!GOOGLE_ID||!GOOGLE_SECRET)return json({error:"Google Calendar server credentials are not configured yet."},503);
   const refresh=String(body.provider_refresh_token||"");
   if(refresh.length<20||refresh.length>2048)return json({error:"Long-term calendar permission was not granted. Try connecting again."},400);
   const chosen=Array.isArray(body.calendar_ids)?[...new Set(body.calendar_ids.map(String))]:[];
   if(chosen.length<1||chosen.length>5||chosen.some(id=>!calendars.some(c=>c.id===id)))
    return json({error:"Choose one to five calendars from your own Google account."},400);
   const sources=await postgrest("calendar_sync_sources?select=id,household_id,provider,connection_kind,google_calendar_id,created_by,last_synced_at&household_id=eq."+
    household+"&limit=20");
   const free=Math.max(0,5-sources.length);let needed=0;
   for(const id of chosen)if(!sources.some((x:Source)=>x.connection_kind==="google_oauth"&&x.google_calendar_id===id))needed++;
   if(needed>free)return json({error:"A household can connect at most five calendars in total."},400);
   const connected:any[]=[];
   for(const id of chosen){
    const details=calendars.find(x=>x.id===id)!;
    let source:Source|undefined=sources.find((x:Source)=>x.connection_kind==="google_oauth"&&x.google_calendar_id===id);
    let newSource=false;
    if(!source){
     const created=await postgrest("calendar_sync_sources","POST",{household_id:household,provider:"google",
      label:details.label,created_by:user.id,connection_kind:"google_oauth",google_calendar_id:id});
     source=created[0];newSource=true;
    }
    try{
     await postgrest("rpc/save_google_calendar_refresh","POST",{p_source_id:source!.id,p_token:refresh});
     const result=await syncSource(source!,true);
     connected.push({id:source!.id,label:details.label,...result});
    }catch(error){
     if(newSource)await postgrest("calendar_sync_sources?id=eq."+source!.id,"DELETE").catch(()=>{});
     throw error;
    }
   }
   return json({ok:true,connected});
  }
  if(action==="sync"){
   const id=String(body.source_id||"");
   if(!UUID.test(id))return json({error:"Invalid calendar source."},400);
   const rows=await postgrest("calendar_sync_sources?select=id,household_id,provider,connection_kind,google_calendar_id,created_by,last_synced_at&id=eq."+
    id+"&limit=1");
   const source:Source|undefined=rows[0];
   if(!source||source.household_id!==household||source.connection_kind!=="google_oauth")
    return json({error:"Calendar is not connected to your household."},403);
   const result=await syncSource(source,body.force===true);
   return json(result,result.ok?200:422);
  }
  return json({error:"Unknown action"},400);
 }catch(error){
  const message=(error instanceof Error?error.message:"Calendar request failed").slice(0,210);
  return json({error:message},422);
 }
});
