import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createContext,runInContext} from 'node:vm';

const source=readFileSync(new URL('../google-calendar-bridge.js',import.meta.url),'utf8');
const captured=[];
let googlePrompt='',householdReloads=0;
const elements={
 googleCalendarConnect:{disabled:false},
 googleCalendarConfirm:{disabled:false},
 googleCalendarStatus:{textContent:''},
 googleCalendarPick:{hidden:true},
 googleCalendarChoices:{innerHTML:'',replaceChildren(){this.innerHTML=''}},
 calendarImportDialog:{open:true,addEventListener(){}}
};
const oauth={
 initTokenClient(config){
  assert.equal(config.scope,'https://www.googleapis.com/auth/calendar.readonly');
  assert.match(config.client_id,/\.apps\.googleusercontent\.com$/);
  return {requestAccessToken(args){
   googlePrompt=args.prompt;
   config.callback({access_token:'ya29.PERSONAL_CALENDAR_ONLY',scope:config.scope});
  }};
 },
 hasGrantedAllScopes(resp,scope){return resp.scope===scope;}
};
const ctx=createContext({
 user:{id:'qa-user',email:'qa@example.test'},
 HOUSE:'qa-house',
 pendingGoogleCalendarGrant:null,
 $:id=>elements[id],
 URL:'https://example.supabase.co',
 KEY:'anon-key',
 AbortController,
 setTimeout,clearTimeout,
 validSession:async()=>({access_token:'qa-household-session'}),
 fetch:async(url,opts)=>{
  assert.equal(url,'https://example.supabase.co/functions/v1/calendar-google-sync');
  assert.equal(opts.headers.Authorization,'Bearer qa-household-session');
  const p=JSON.parse(opts.body);captured.push(p);
  assert.equal(p.expected_household_id,'qa-house','The importing Household remains the test household');
  const result=p.action==='config'?{ok:true,client_id:'123456-example.apps.googleusercontent.com'}:
   p.action==='list'?{ok:true,google_account:'personal@gmail.com',
    calendars:[{id:'personal@gmail.com',label:'Private test calendar',primary:true}]}:
   p.action==='import'?{ok:true,calendars:1,added:3,duplicates:0}:
   {error:'Invalid action'};
  return {ok:!!result.ok,status:result.ok?200:400,json:async()=>result};
 },
 window:{google:{accounts:{oauth2:oauth}}},
 document:{querySelectorAll:()=>[{value:'0'}]},
 esc:value=>String(value),
 load:async()=>{householdReloads++},
 renderConnectedCalendarSources:()=>{},
 console
});
runInContext(source,ctx,{filename:'google-calendar-bridge.js'});

await runInContext('prepareGoogleCalendarClient()',ctx);
assert.equal(elements.googleCalendarConnect.disabled,false);
assert.match(elements.googleCalendarStatus.textContent,/Ready/);

runInContext("$('googleCalendarConnect').onclick()",ctx);
await new Promise(resolve=>setImmediate(resolve));
assert.equal(googlePrompt,'select_account');
assert.match(elements.googleCalendarStatus.textContent,/personal@gmail.com/);
assert.equal(elements.googleCalendarPick.hidden,false);
assert.equal(ctx.user.id,'qa-user');
assert.equal(ctx.HOUSE,'qa-house');

await runInContext("$('googleCalendarConfirm').onclick()",ctx);
assert.equal(ctx.user.id,'qa-user','Google authorization must not replace the test login');
assert.equal(ctx.HOUSE,'qa-house','Calendar authorization must not switch households');
assert.equal(householdReloads,1);
assert.equal(captured.filter(c=>c.action==='import').length,1);
assert.deepEqual(JSON.parse(JSON.stringify(captured.find(c=>c.action==='import').calendar_ids)),
 ['personal@gmail.com']);
assert.ok(!captured.some(c=>'provider_refresh_token' in c),'Never store a Google refresh token');

runInContext("$('googleCalendarConnect').onclick()",ctx);
await new Promise(resolve=>setImmediate(resolve));
ctx.user={id:'different-user'};ctx.HOUSE='other-house';
await runInContext("$('googleCalendarConfirm').onclick()",ctx);
assert.match(elements.googleCalendarStatus.textContent,/Household account changed/);
assert.equal(captured.filter(c=>c.action==='import').length,1,
 'Switching Household accounts during Google consent must prevent the import');

console.log('PASS: QA Household can import a different Google account without changing login or household.');
