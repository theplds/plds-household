import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script} from 'node:vm';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
for(const [,script] of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))
 new Script(script,{filename:'Household inline script'});
assert.doesNotMatch(html,/<select id="lessonStatusSelect"/,
 'Native dropdown must not create a blank white option list');
assert.match(html,/<details id="lessonStatusDetails" class="lesson-status-details">/);
assert.match(html,/role="radiogroup" aria-label="Choose lesson status"/);
for(const status of ['completed','cancelled_free','cancelled_charged','rescheduled'])
 assert.match(html,new RegExp('name="lessonStatusChoice" value="'+status+'"'));
assert.match(html,/id="lessonStatusRescheduled"/);
assert.match(html,/id="lessonStatusCurrent"/);
assert.match(html,/class="lesson-status-options"/);
assert.match(html,/name='lessonStatusChoice'/);
assert.match(html,/status.value=e.target.value/);
assert.match(html,/if\(status.value==='rescheduled'\)\$\('newdate'\)\?\.focus\(\)/);
assert.match(html,/const choice=\$\('lessonStatusRescheduled'\)/);
assert.match(html,/choice.dispatchEvent\(new Event\('change',\{bubbles:true\}\)\)/);
assert.match(html,/const record=\{schedule_id:id,session_date:date,status,new_date:status==='rescheduled'/);
assert.match(html,/billingPeriodAt\(a,date\)==="monthly"\?"Cancel practice · fee unchanged":"Cancel · no charge"/);
assert.match(html,/:root\[data-theme="light"\] \.lesson-status-option/);
assert.match(html,/\.lesson-status-option:has\(input:checked\)/);
assert.match(html,/\.lesson-actions::before\{content:none!important\}/);
console.log('PASS: visible Cancel / Reschedule choices in all themes, unchanged billing/save rules and no native select.');
