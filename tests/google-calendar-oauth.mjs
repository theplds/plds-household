import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script} from 'node:vm';
const root=new URL('../',import.meta.url);
const html=readFileSync(new URL('index.html',root),'utf8');
const bridge=readFileSync(new URL('google-calendar-bridge.js',root),'utf8');
const edge=readFileSync(new URL('supabase/functions/calendar-google-sync/index.ts',root),'utf8');
const sql=readFileSync(new URL('migrations/20261104_google_calendar_oauth_secure_sources.sql',root),'utf8');
new Script(bridge,{filename:'google-calendar-bridge.js'});
assert.match(html,/id="googleCalendarConnect"/);
assert.match(html,/id="googleCalendarChoices"/);
assert.match(html,/<script src="google-calendar-bridge.js"><\/script>/);
assert.match(html,/pendingCalendarUser/);
assert.doesNotMatch(html,/pendingGoogleCalendarGrant=providerToken/);
assert.match(html,/if\(pendingCalendarUser\)\{/);
assert.match(html,/if\(typeof prepareGoogleCalendarClient==='function'\)void prepareGoogleCalendarClient\(\)/);
assert.match(bridge,/https:\/\/www\.googleapis\.com\/auth\/calendar\.readonly/);
assert.doesNotMatch(bridge,/access_type.*offline/);
assert.doesNotMatch(bridge,/prompt.*consent/);
assert.match(bridge,/pendingGoogleCalendarGrant=null/);
assert.doesNotMatch(edge,/read_google_calendar_refresh/);
assert.doesNotMatch(edge,/save_google_calendar_refresh/);
assert.doesNotMatch(edge,/provider_refresh_token/);
assert.doesNotMatch(edge,/action==="sync"/);
assert.match(edge,/action==="config"/);
assert.match(edge,/GOOGLE_OAUTH_CLIENT_ID/);
assert.match(edge,/action==="list"\|\|action==="import"/);
assert.match(edge,/expected_household_id!==household/);
assert.match(edge,/resolution=ignore-duplicates/);
assert.match(edge,/Google calendar is too large|too many pages|too large for a safe import/i);
assert.match(edge,/calendar_import_events/);
assert.match(edge,/household_members/);
assert.match(edge,/Google Calendar API is disabled/);
assert.match(sql,/vault\.create_secret/); // legacy schema still present; new import never calls it
assert.match(sql,/revoke all on function public\.read_google_calendar_refresh/);
assert.match(sql,/revoke all on function public\.save_google_calendar_refresh/);
assert.doesNotMatch(bridge,/localStorage\.(?:setItem|getItem)\([^)]*(?:provider|google)/i);
const localEdits=readFileSync(new URL('migrations/20261104_household_calendar_local_edit.sql',root),'utf8');
assert.match(localEdits,/grant update \(title,details,location,event_date,start_time,end_time,all_day\)/);
assert.match(localEdits,/old\.source_id is not null/);
for(const id of ['calendarEventTitle','calendarEventDate','calendarEventAllDay','calendarEventStart','calendarEventEnd',
 'calendarEventLocation','calendarEventNotes','addHouseholdEvent']){
 assert.equal(html.split('id="'+id+'"').length-1,1,id+' should appear exactly once');
}
assert.match(html,/source_key:'household:'\+crypto\.randomUUID\(\)/);
assert.match(html,/\.eq\('updated_at',e\.updated_at\)/);
assert.match(bridge,/google\.accounts\.oauth2\.initTokenClient|oauth\.initTokenClient/);
assert.match(bridge,/requestAccessToken\(\{prompt:'select_account'\}\)/);
assert.doesNotMatch(bridge,/signInWithOAuth|auth\/v1\/authorize|location\.assign/);
assert.doesNotMatch(edge,/same Google account as the signed-in Household|identity\.email.*user\.email/);
assert.match(edge,/await postgrest\("calendar_import_events\?/);
assert.doesNotMatch(edge,/\bdataApi\(/);
assert.doesNotMatch(bridge,/refreshToken/);
assert.match(bridge,/action:'import'/);
// Imported entries should render as ordinary activity cards, with linked palette
// when available and a solid default when not. Distinction is retained in the
// tooltip/editor, never as cramped inline text or an invented billing charge.
assert.match(html,/\.calendar-event\.imported-calendar-event:not\(\[data-activity\]\)\{background:#5065f5!important/);
assert.match(html,/class="calendar-event imported-calendar-event"/);
assert.match(html,/const linkedActivity=activities\.find\(a=>a\.id===e\.activity_id\)/);
assert.match(html,/data-palette=".*chosenPalette\(linkedActivity\)/);
assert.match(html,/class="line activity-box imported-event-row"/);
assert.doesNotMatch(html,/class="imported-event-label"/);
assert.doesNotMatch(html,/border:1px dashed #8db1cf/);
assert.match(html,/Imported calendar appointments are never billed/);
assert.ok(!html.slice(html.indexOf('const ss=sessions()'),html.indexOf("if(tab==='monthview')")).includes('importedEvents.reduce('),
 'Imported appointments must not be included in the billing amount.');
console.log('PASS: imported calendar events share activity card layout and remain nonbillable.');
console.log('PASS: one-time Google Calendar import, no saved provider credentials, editable household events.');
