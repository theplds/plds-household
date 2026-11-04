// One-time, independent Google Calendar consent. Does not sign into Household or store refresh tokens.
// Imported events are owned and edited within Household only.
const API=Deno.env.get("SUPABASE_URL")||"";
const SERVICE=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
const ANON=Deno.env.get("SUPABASE_ANON_KEY")||"";
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
  // Google includes a precise reason in its API error JSON. Distinguish
  // disabled API from missing OAuth permissions; do not expose token data.
  const payload=await response.json().catch(()=>null);
  const error=payload?.error||{};
  const details=Array.isArray(error.details)?error.details:[];
  const reasons=[
   ...details.map((item:any)=>String(item?.reason||"")),
   ...(Array.isArray(error.errors)?error.errors.map((item:any)=>String(item?.reason||"")):[])
  ];
  const reason=reasons.join(" ").toUpperCase();
  const description=String(error.message||"");
  if(response.status===401)throw Error("Google calendar permission expired. Select your Google account again.");
  if(response.status===403){
   if(reason.includes("SERVICE_DISABLED")||reason.includes("ACCESSNOTCONFIGURED")||
      /(?:calendar api).*(?:not been used|disabled)|service has not been used/i.test(description))
    throw Error("Google Calendar API is disabled for the Google Cloud project. Enable Google Calendar API in that project's APIs & Services, then try again.");
   if(reason.includes("ACCESS_TOKEN_SCOPE_INSUFFICIENT")||reason.includes("INSUFFICIENTPERMISSIONS")||
      /insufficient authentication scopes|insufficient permission/i.test(description))
    throw Error("Google denied the calendar.readonly permission. Reauthorize and allow calendar read access.");
   if(reason.includes("RATE_LIMIT")||reason.includes("RATELIMIT")||
      reason.includes("QUOTA")||/rate limit|quota exceeded/i.test(description))
    throw Error("Google Calendar request limit reached. Try again later.");
   throw Error("Google Calendar access was denied (403). Verify that Calendar API is enabled for the correct project and read-only calendar permission was granted.");
  }
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
  const details=String(e.description||"").slice(0,3000);
  const location=String(e.location||"").slice(0,300);
  if(e.start.date){
   const begin=String(e.start.date),end=String(e.end?.date||begin);
   const from=Date.parse(begin+"T12:00:00Z"),to=Date.parse(end+"T12:00:00Z");
   const days=Number.isFinite(from)&&Number.isFinite(to)?Math.ceil((to-from)/86400000):0;
   if(days<1||days>31)throw Error("One Google all-day event spans over 31 days or has invalid dates.");
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
  // The signed-in Household identity determines the target household.
  // The separately authorized Google identity may be different.
  if(body.expected_household_id!==household)
   return json({error:"The Household account changed. Reopen the importer and try again."},409);
  if(action==="config"){
   const clientId=String(Deno.env.get("GOOGLE_OAUTH_CLIENT_ID")||"").trim();
   if(!/^[a-z0-9-]+\.apps\.googleusercontent\.com$/i.test(clientId))
    return json({error:"Google calendar authorization is not configured."},503);
   return json({ok:true,client_id:clientId});
  }
  if(action==="list"||action==="import"){
   const token=String(body.provider_token||"");
   if(token.length<20||token.length>4096)return json({error:"Google calendar permission is missing."},400);
   // Calendar ownership is proven by Google-issued bearer access to the calendar API;
   // it is deliberately independent of the Household login email.
   const available=await listGoogleCalendars(token);
   if(action==="list")return json({ok:true,calendars:available,google_account:available.find(c=>c.primary)?.id||null});
   const selected=Array.isArray(body.calendar_ids)?[...new Set(body.calendar_ids.map(String))]:[];
   if(selected.length<1||selected.length>5||selected.some(id=>!available.some(c=>c.id===id)))
    return json({error:"Choose one to five readable calendars."},400);
   const range=syncRange();
   const batches:EventRow[][]=[];
   for(const calendarId of selected){
    let page="",events:any[]=[];
    for(let n=0;n<10;n++){
     const path="/calendar/v3/calendars/"+encodeURIComponent(calendarId)+
      "/events?singleEvents=true&showDeleted=false&maxResults=250&timeMin="+
      encodeURIComponent(range.start)+"&timeMax="+encodeURIComponent(range.end)+
      (page?"&pageToken="+encodeURIComponent(page):"");
     const result=await getGoogle(path,token);
     events.push(...(result.items||[]));
     if(events.length>1300)throw Error("One calendar is too large for a safe import.");
     if(!result.nextPageToken){page="";break}
     page=String(result.nextPageToken);
    }
    if(page)throw Error("Calendar contains too many pages for a safe import.");
    const mapped=mapGoogleEvents(events,calendarId).map(event=>({
     ...event,source_key:"google-copy:"+event.source_key
    }));
    if(mapped.some(row=>row.source_key.length>450))throw Error("Google supplied an event identifier that is too long.");
    batches.push(mapped);
   }
   // Google is never written. Re-importing skips previously copied events,
   // preserving all edits made by Household members.
   let added=0,duplicates=0;
   for(const batch of batches){
    for(let i=0;i<batch.length;i+=80){
     const records=batch.slice(i,i+80).map(event=>({
      ...event,household_id:household,created_by:user.id
     }));
     const result=await postgrest("calendar_import_events?on_conflict=household_id%2Csource_key",
      "POST",records,{"Prefer":"resolution=ignore-duplicates,return=representation"});
     const saved=Array.isArray(result)?result.length:0;
     added+=saved;duplicates+=records.length-saved;
    }
   }
   return json({ok:true,calendars:selected.length,added,duplicates,
    imported:batches.reduce((n,b)=>n+b.length,0)});
  }
  return json({error:"Unknown import action"},400);
 }catch(error){
  return json({error:(error instanceof Error?error.message:"Calendar import failed").slice(0,210)},422);
 }
});
