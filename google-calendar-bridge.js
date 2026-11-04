/* Household one-time Google Calendar import.
 * A separate Google Identity Services token dialog never calls Supabase sign-in,
 * changes Household sessions, or stores provider access/refresh tokens.
 */
const GOOGLE_CALENDAR_SCOPE='https://www.googleapis.com/auth/calendar.readonly';
let googleCalendarTokenClient=null;
let googleCalendarPreparation=null;

async function googleCalendarApi(payload){
 const session=await validSession();
 if(!session?.access_token||!user||!HOUSE)throw Error('Sign in to Household before importing.');
 const expectedHousehold=payload.expected_household_id||HOUSE;
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),55000);
 try{
  const response=await fetch(URL+'/functions/v1/calendar-google-sync',{
   method:'POST',signal:controller.signal,
   headers:{apikey:KEY,Authorization:'Bearer '+session.access_token,'Content-Type':'application/json'},
   body:JSON.stringify({...payload,expected_household_id:expectedHousehold})
  });
  const data=await response.json().catch(()=>({}));
  if(!response.ok||data.ok!==true)throw Error(data.error||'Google Calendar request failed ('+response.status+')');
  return data;
 }catch(err){
  if(err?.name==='AbortError')throw Error('Google Calendar request timed out.');
  throw err;
 }finally{clearTimeout(timer)}
}
function loadGoogleCalendarSdk(){
 if(window.google?.accounts?.oauth2?.initTokenClient)return Promise.resolve();
 return new Promise((resolve,reject)=>{
  const script=document.createElement('script');
  script.src='https://accounts.google.com/gsi/client';
  script.async=true;
  script.onload=()=>window.google?.accounts?.oauth2?.initTokenClient?
    resolve():reject(Error('Google authorization library did not initialize.'));
  script.onerror=()=>reject(Error('Google authorization could not load. Check blockers or connectivity.'));
  document.head.appendChild(script);
 });
}
function clearGoogleCalendarConsent(){
 pendingGoogleCalendarGrant=null;
 $('googleCalendarPick').hidden=true;
 $('googleCalendarChoices').replaceChildren();
}
async function prepareGoogleCalendarClient(){
 if(googleCalendarTokenClient)return;
 if(googleCalendarPreparation)return googleCalendarPreparation;
 const button=$('googleCalendarConnect'),status=$('googleCalendarStatus');
 const expectedUserId=user?.id,expectedHouseholdId=HOUSE;
 if(!expectedUserId||!expectedHouseholdId)return;
 button.disabled=true;
 status.textContent='Preparing separate Google Calendar authorization…';
 googleCalendarPreparation=(async()=>{
  const [{client_id:clientId}]=await Promise.all([
   googleCalendarApi({action:'config',expected_household_id:expectedHouseholdId}),
   loadGoogleCalendarSdk()
  ]);
  if(!user||user.id!==expectedUserId||HOUSE!==expectedHouseholdId)
   throw Error('Household account changed. Reopen the importer.');
  if(!clientId||!window.google?.accounts?.oauth2?.initTokenClient)
   throw Error('Google Calendar authorization is unavailable.');
  const oauth=window.google.accounts.oauth2;
  googleCalendarTokenClient=oauth.initTokenClient({
   client_id:clientId,
   scope:GOOGLE_CALENDAR_SCOPE,
   callback:response=>{
    if(!user||user.id!==googleCalendarRequestUser||HOUSE!==googleCalendarRequestHousehold){
     clearGoogleCalendarConsent();
     status.textContent='Household account changed. Reopen the importer.';
     return;
    }
    if(!$('calendarImportDialog').open)return;
    if(response?.error||!response?.access_token){
     status.textContent='Google did not authorize calendar access: '+(response?.error||'Permission not granted.');
     return;
    }
    if(!oauth.hasGrantedAllScopes(response,GOOGLE_CALENDAR_SCOPE)){
     status.textContent='Read-only calendar permission was not granted.';
     return;
    }
    pendingGoogleCalendarGrant={
     accessToken:response.access_token,
     expectedUserId:googleCalendarRequestUser,
     expectedHouseholdId:googleCalendarRequestHousehold
    };
    void showGoogleCalendarSelector();
   },
   error_callback:e=>{
    status.textContent='Google account chooser could not open: '+String(e?.type||'Popup blocked');
   }
  });
  status.textContent='Ready. Choose the Google account whose calendar you want to copy.';
 })().catch(err=>{
  status.textContent='Could not prepare Google Calendar: '+(err.message||String(err));
 }).finally(()=>{
  button.disabled=false;
  googleCalendarPreparation=null;
 });
 return googleCalendarPreparation;
}
let googleCalendarRequestUser=null,googleCalendarRequestHousehold=null;
$('googleCalendarConnect').onclick=()=>{
 const status=$('googleCalendarStatus');
 if(!user||!HOUSE){status.textContent='Sign in to Household first.';return}
 if(!googleCalendarTokenClient){
  status.textContent='Preparing Google authorization. Select this button again when ready.';
  void prepareGoogleCalendarClient();
  return;
 }
 clearGoogleCalendarConsent();
 googleCalendarRequestUser=user.id;
 googleCalendarRequestHousehold=HOUSE;
 status.textContent='Choose a Google account in the separate Google window. Your Household login will not change.';
 try{
  // MUST be called directly from the click to avoid browser popup blocking.
  googleCalendarTokenClient.requestAccessToken({prompt:'select_account'});
 }catch(err){
  status.textContent='Google account chooser failed: '+(err.message||String(err));
 }
};
async function showGoogleCalendarSelector(){
 const grant=pendingGoogleCalendarGrant;
 if(!grant||!user||!HOUSE)return;
 const status=$('googleCalendarStatus'),panel=$('googleCalendarPick');
 panel.hidden=true;
 if(user.id!==grant.expectedUserId||HOUSE!==grant.expectedHouseholdId){
  clearGoogleCalendarConsent();
  status.textContent='Household account changed; cancel this import and reopen it.';
  return;
 }
 status.textContent='Reading calendars available to the selected Google account…';
 try{
  const result=await googleCalendarApi({
   action:'list',provider_token:grant.accessToken,
   expected_household_id:grant.expectedHouseholdId
  });
  if(!user||user.id!==grant.expectedUserId||HOUSE!==grant.expectedHouseholdId)
   throw Error('Household account changed before calendar selection.');
  if(!result.calendars?.length)throw Error('No readable calendars were returned.');
  grant.calendars=result.calendars;
  $('googleCalendarChoices').innerHTML=result.calendars.map((c,i)=>
   '<label class="google-calendar-choice"><input type="checkbox" name="googleCalendarChoice" value="'+i+'"><span>'+
   esc(c.label)+(c.primary?' · Primary':'')+'</span></label>'
  ).join('');
  panel.hidden=false;
  const source=result.google_account?String(result.google_account):'the selected Google account';
  status.textContent='Google source: '+source+'. Choose only calendars you want to share with this Household.';
 }catch(err){
  clearGoogleCalendarConsent();
  status.textContent='Could not read Google calendars: '+(err.message||String(err));
 }
}
$('googleCalendarConfirm').onclick=async()=>{
 const grant=pendingGoogleCalendarGrant,status=$('googleCalendarStatus'),button=$('googleCalendarConfirm');
 if(!grant?.calendars?.length)return;
 if(!user||user.id!==grant.expectedUserId||HOUSE!==grant.expectedHouseholdId){
  clearGoogleCalendarConsent();
  status.textContent='Household account changed. Import cancelled.';
  return;
 }
 const ids=[...document.querySelectorAll('input[name="googleCalendarChoice"]:checked')]
  .map(x=>grant.calendars[Number(x.value)]?.id).filter(Boolean);
 if(!ids.length||ids.length>5){
  status.textContent='Choose between one and five Google calendars.';
  return;
 }
 button.disabled=true;
 status.textContent='Copying selected Google appointments into your current Household…';
 try{
  const result=await googleCalendarApi({
   action:'import',provider_token:grant.accessToken,calendar_ids:ids,
   expected_household_id:grant.expectedHouseholdId
  });
  if(!user||user.id!==grant.expectedUserId||HOUSE!==grant.expectedHouseholdId)
   throw Error('Household account changed during the import. Please verify the imported events.');
  clearGoogleCalendarConsent();
  await load();
  renderConnectedCalendarSources();
  status.textContent=Number(result.added||0)+' appointments copied from '+Number(result.calendars||0)+
   ' Google calendar(s). '+Number(result.duplicates||0)+' previously imported appointments left unchanged.'+
   ' Future changes stay in Household.';
 }catch(err){
  status.textContent='Google import: '+(err.message||String(err));
 }finally{
  button.disabled=false;
 }
};
$('calendarImportDialog').addEventListener('close',()=>{clearGoogleCalendarConsent()});
