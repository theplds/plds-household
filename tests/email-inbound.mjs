import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script} from 'node:vm';
import {parseSportsEmail,htmlToScheduleText,normalizeEmailAddress} from '../supabase/functions/household-inbound-email/parser.mjs';
const root=new URL('../',import.meta.url);
const html=readFileSync(new URL('index.html',root),'utf8');
const ui=readFileSync(new URL('email-inbox.js',root),'utf8');
const backend=readFileSync(new URL('supabase/functions/household-inbound-email/index.ts',root),'utf8');
const sql=readFileSync(new URL('migrations/20261105_household_forwarded_email_inbox.sql',root),'utf8');
new Script(ui,{filename:'email-inbox.js'});
const sample=['Weekly Schedule - ΚΩΝΣΤΑΝΤΙΝΟΣ ΠΟΥΛΙΔΗΣ',
 '5 ΝΟΕΜΒΡΙΟΥ-12 ΝΟΕΜΒΡΙΟΥ 2026','Saturday, 7 November 2026',
 'Time Venue Teams Type','09:00 - 10:00 | Γηπεδάκια Junior | J-1 (2019 ΑΓΟΡΙΑ-ΚΟΡΙΤΣΙΑ) | Training',
 'Sunday, 8 November 2026','10:30 - 11:30 | Indoor gym | J-1 | Training'].join('\n');
let items=parseSportsEmail({text:sample});
assert.deepEqual(items.map(x=>[x.proposed_date,x.start_time,x.end_time]),[
 ['2026-11-07','09:00','10:00'],['2026-11-08','10:30','11:30']]);
assert.equal(items[0].venue,'Γηπεδάκια Junior');
assert.equal(parseSportsEmail({text:sample+'\n10:30 - 11:30 | Indoor gym'}).length,2);
const greek='Σάββατο, 7 Νοεμβρίου 2026\n09:00 – 10:00 | Γηπεδάκια Junior';
assert.equal(parseSportsEmail({text:greek})[0].proposed_date,'2026-11-07');
const formatted='<h2>Saturday, 7 November 2026</h2><table><tr><th>Time</th><th>Venue</th><th>Teams</th><th>Type</th></tr><tr><td>09:00 - 10:00</td><td>Γηπεδάκια Junior</td><td>J-1</td><td>Training</td></tr></table>';
assert.match(htmlToScheduleText(formatted),/Saturday, 7 November 2026/);
assert.equal(parseSportsEmail({html:formatted})[0].venue,'Γηπεδάκια Junior');
assert.deepEqual(parseSportsEmail({text:'No timetable attached'}),[]);
assert.deepEqual(parseSportsEmail({text:'Saturday, 7 November 2026\n09:00 - 10:00 Cancelled'}),[]);
assert.deepEqual(parseSportsEmail({text:'Sunday, 31 November 2026\n09:00 - 10:00 | Invalid'}),[]);
assert.deepEqual(parseSportsEmail({text:'Sunday, 8 November 2026\n23:30 - 01:00 | Overnight'}),[]);
assert.equal(normalizeEmailAddress('MyTeam <COACH@example.com>'),'coach@example.com');
for(const id of ['openEmailIntake','emailIntakeDialog','emailIntakeStatus','emailIntakeProposals',
 'emailIntakeAddress','emailIntakeSender','emailIntakeActivity','emailIntakeChild',
 'emailIntakeEnabled','emailIntakeSave','emailIntakeRefresh','emailIntakeClose']){
 assert.equal(html.split('id="'+id+'"').length-1,1,'Missing or duplicate '+id);
}
assert.match(html,/<script src="email-inbox.js"><\/script>/);
assert.match(ui,/db\.rpc\('ensure_household_email_intake'/);
assert.match(ui,/db\.rpc\('review_household_email_proposal'/);
assert.match(ui,/p_action:action/);
assert.match(ui,/if\(!confirm\('Approve this one-time session/);
assert.match(ui,/emailIntakeState\.inbox_token/);
assert.match(ui,/allowed_sender:sender,activity_id:activityId,child_id:childId,enabled/);
assert.doesNotMatch(ui,/auth\/v1\/authorize|provider_refresh_token|service_role/);
assert.match(backend,/svix-signature/);
assert.match(backend,/crypto\.subtle\.sign\('HMAC'/);
assert.match(backend,/Math\.abs\(Date\.now\(\)\/1000-Number\(timestamp\)\)>300/);
assert.match(backend,/inboundDomain/);
assert.match(backend,/if\(!await isVerified/);
assert.match(backend,/resend\.com\/emails\/receiving/);
assert.match(backend,/sender!==config\.allowed_sender/);
assert.match(backend,/recipient_mismatch/);
assert.match(backend,/resendKey/);
assert.doesNotMatch(backend,/insert into public\.schedules/);
assert.match(sql,/enable row level security/g);
assert.match(sql,/auth\.uid\(\)/);
assert.match(sql,/pending','approved','dismissed/);
assert.match(sql,/created_at/);
assert.match(sql,/s\.start_time<v\.end_time and s\.end_time>v\.start_time/);
assert.match(sql,/p_action='dismiss'/);
assert.match(sql,/insert into public\.schedules/);
assert.match(sql,/v\.proposed_date,v\.proposed_date,p_child_id is null/);
assert.match(sql,/grant execute on function public\.review_household_email_proposal/);
assert.match(sql,/inbox_token text not null unique/);
console.log('PASS: forwarded sports schedule parsing, signed webhook, household RLS and approval-only sessions.');
