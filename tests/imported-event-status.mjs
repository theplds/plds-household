import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script} from 'node:vm';

const root=new URL('../',import.meta.url);
const html=readFileSync(new URL('index.html',root),'utf8');
const migration=readFileSync(new URL('migrations/20261104_imported_event_status.sql',root),'utf8');
const scripts=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)];
for(const [,body] of scripts)new Script(body);

// The imported Household event editor must offer independent nonbillable statuses.
for(const id of ['calendarEventActionPanel','calendarEventAction','calendarEventReplacement',
 'calendarEventNewDate','calendarEventNewTimes','calendarEventNewStart','calendarEventNewEnd']){
 assert.equal(html.split('id="'+id+'"').length-1,1,'Expected one '+id);
}
assert.match(html,/<option value="cancelled">Cancel<\/option>/);
assert.match(html,/<option value="rescheduled">Reschedule<\/option>/);
assert.match(html,/calendarEventActionPanel'\)\.hidden=readOnly\|\|!event/);
assert.match(html,/event_status,replacement_date,replacement_start_time,replacement_end_time/);
assert.match(html,/\.eq\('updated_at',e\.updated_at\)/);
assert.match(html,/event_status==='rescheduled'/);
assert.match(html,/item\.isReplacement\?'is-replacement':cancelled\?'is-cancelled'/);
assert.match(html,/state=item\.isReplacement\?'Rescheduled':cancelled\?'Cancelled'/);
assert.match(html,/status=item\.isReplacement\?'Rescheduled':cancelled\?'Cancelled'/);

// Verify month projection, including rescheduling into a different month.
const start=html.indexOf(' const importedEventChildIds=e=>');
const end=html.indexOf(' const owed=ss.reduce(',start);
assert.ok(start>=0&&end>start,'Could not locate calendar projection');
const fn=new Function('importedEvents','month','childFilter','activityChildren',
 html.slice(start,end)+'return visibleImported;');
const base={id:'e1',event_date:'2026-11-07',title:'Test appointment',
 child_id:null,activity_id:null,hidden:false,removed_from_source:false};
const events=[
 {...base,event_status:'scheduled'},
 {...base,id:'e2',event_status:'cancelled',event_date:'2026-11-14'},
 {...base,id:'e3',event_status:'rescheduled',replacement_date:'2026-12-01'},
 {...base,id:'e4',event_status:'rescheduled',event_date:'2026-11-21',
   replacement_date:'2026-11-26',replacement_start_time:'10:30'}
];
const nov=fn(events,'2026-11','all',[]);
const dec=fn(events,'2026-12','all',[]);
assert.equal(nov.length,5,'November includes all original appointments and a same-month replacement');
assert.equal(dec.length,1,'December includes a moved appointment from November');
assert.equal(dec[0].e.id,'e3');
assert.equal(dec[0].isReplacement,true);
assert.equal(nov.filter(x=>x.e.id==='e4').length,2);
assert.equal(nov.filter(x=>x.e.id==='e2').length,1,'Cancelled events remain visible');

// Data protection: no changes to sessions, no hidden charge logic.
assert.match(migration,/event_status in \('scheduled','cancelled','rescheduled'\)/);
assert.match(migration,/new\.event_status,new\.replacement_date/);
assert.match(migration,/old\.source_id is not null/);
assert.match(migration,/grant update \(event_status,replacement_date,replacement_start_time,replacement_end_time\)/);
assert.match(html,/const owed=ss\.reduce\(\(sum,x\)=>sum\+x\.charge,0\)/);
console.log('PASS: imported event Cancel / Reschedule status, cross-month replacement, source protection and no charges.');
