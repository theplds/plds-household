/* Google Calendar authorization is separate from household sign-in.
 * Google read-only access is used for one import only. Household manages edits
 * and shares them with household members; no Google refresh token is retained.
 */
async function googleCalendarApi(payload){
 const session=await validSession();
 if(!session?.access_token)throw Error('Please sign in again to connect Google Calendar.');
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),55000);
 try{
  const response=await fetch(URL+'/functions/v1/calendar-google-sync',{
   method:'POST',signal:controller.signal,
   headers:{apikey:KEY,Authorization:'Bearer '+session.access_token,'Content-Type':'application/json'},
   body:JSON.stringify(payload)
  });
  const data=await response.json().catch(()=>({}));
  if(!response.ok||data.ok!==true)throw Error(data.error||'Google Calendar request failed ('+response.status+')');
  return data;
 }catch(err){
  if(err?.name==='AbortError')throw Error('Google Calendar took too long to respond.');
  throw err;
 }finally{clearTimeout(timer)}
}
async function showGoogleCalendarSelector(){
 const grant=pendingGoogleCalendarGrant;
 if(!grant||!user||!HOUSE)return;
 openCalendarImporter(false);
 const status=$('googleCalendarStatus'),panel=$('googleCalendarPick');
 panel.hidden=true;
 if(grant.error){status.textContent=grant.error;pendingGoogleCalendarGrant=null;return}
 if(user.id!==grant.expectedUserId){
  status.textContent='You switched Google accounts. Sign in with the invited Google account and connect again.';
  pendingGoogleCalendarGrant=null;return;
 }
 status.textContent='Reading your Google calendars…';
 try{
  const result=await googleCalendarApi({action:'list',provider_token:grant.accessToken});
  if(!result.calendars?.length)throw Error('Google returned no readable calendars.');
  grant.calendars=result.calendars;
  $('googleCalendarChoices').innerHTML=result.calendars.map((c,i)=>
   '<label class="google-calendar-choice"><input type="checkbox" name="googleCalendarChoice" value="'+i+'"><span>'+esc(c.label)+(c.primary?' · Primary':'')+'</span></label>'
  ).join('');
  panel.hidden=false;
  status.textContent='Choose up to five calendars to copy into Household. This is a one-time import.';
 }catch(err){status.textContent='Could not list Google calendars: '+(err.message||String(err))}
}
$('googleCalendarConnect').onclick=()=>{
 if(!user||!HOUSE){$('googleCalendarStatus').textContent='Sign in to your household first.';return}
 const oauth=new globalThis.URL(URL+'/auth/v1/authorize');
 oauth.searchParams.set('provider','google');
 oauth.searchParams.set('redirect_to',new globalThis.URL('./',location.href).href);
 oauth.searchParams.set('scopes','https://www.googleapis.com/auth/calendar.readonly');
 try{
  sessionStorage.setItem('plds_calendar_oauth_pending',user.id);
  $('googleCalendarStatus').textContent='Redirecting to Google for separate read-only calendar permission…';
  location.assign(oauth.href);
 }catch(err){
  $('googleCalendarStatus').textContent='Could not start Google permission: '+(err.message||String(err));
 }
};
$('googleCalendarConfirm').onclick=async()=>{
 const grant=pendingGoogleCalendarGrant,status=$('googleCalendarStatus'),button=$('googleCalendarConfirm');
 if(!grant?.calendars?.length)return;
 const ids=[...document.querySelectorAll('input[name="googleCalendarChoice"]:checked')]
  .map(x=>grant.calendars[Number(x.value)]?.id).filter(Boolean);
 if(!ids.length||ids.length>5){status.textContent='Choose one to five calendars.';return}
 button.disabled=true;status.textContent='Copying selected Google appointments into Household…';
 try{
  const result=await googleCalendarApi({
   action:'import',provider_token:grant.accessToken,calendar_ids:ids
  });
  pendingGoogleCalendarGrant=null;
  $('googleCalendarPick').hidden=true;
  await load();renderConnectedCalendarSources();
  status.textContent=Number(result.added||0)+' appointments imported from '+Number(result.calendars||0)+' Google calendar(s). '+Number(result.duplicates||0)+' existing appointments kept unchanged. Future edits stay inside Household and sync among its members.';
 }catch(err){
  status.textContent='Google Calendar import: '+(err.message||String(err));
 }finally{button.disabled=false}
};
window.addEventListener('load',()=>{
 // A successful Google Calendar callback is consumed and stripped by the normal
 // auth handler before this point. Wait for the existing household session and
 // membership initialization before rendering calendar selection.
 authenticationReady.then(async ready=>{
  if(!ready||!pendingGoogleCalendarGrant)return;
  await start();
  await showGoogleCalendarSelector();
 }).catch(err=>{console.warn('Calendar selection initialization:',err.message)});
});
