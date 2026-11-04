import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../supabase/functions/calendar-google-sync/index.ts',import.meta.url),'utf8');
const match=source.match(/async function getGoogle\(path:string,accessToken:string\):Promise<any>\{[\s\S]*?\n\}/);
assert.ok(match,'Google request function missing');
const testable=match[0].replace('path:string,accessToken:string):Promise<any>','path,accessToken)').replace(/\(item:any\)/g,'(item)');
const samples=[
 {
  response:{code:403,message:'Google Calendar API has not been used in project 000 before or it is disabled',
   details:[{reason:'SERVICE_DISABLED'}]},
  match:/Google Calendar API is disabled for the Google Cloud project/
 },
 {
  response:{code:403,message:'Request had insufficient authentication scopes',
   details:[{reason:'ACCESS_TOKEN_SCOPE_INSUFFICIENT'}]},
  match:/calendar.readonly permission/
 },
 {
  response:{code:403,errors:[{reason:'userRateLimitExceeded'}]},
  match:/request limit/
 }
];
for(const {response,match:expected} of samples){
 const fetch=async()=>({ok:false,status:response.code,json:async()=>({error:response})});
 const getGoogle=new Function('fetch','AbortSignal',testable+';return getGoogle;')(
  fetch,{timeout:()=>({})});
 await assert.rejects(()=>getGoogle('/calendar/v3/users/me/calendarList','mock-access-token'),expected);
}
console.log('PASS: Google Calendar errors distinguish disabled API, denied scopes, and rate limits.');
