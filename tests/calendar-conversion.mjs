import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script} from 'node:vm';
const root=new URL('../',import.meta.url);
const html=readFileSync(new URL('index.html',root),'utf8');
const bridge=readFileSync(new URL('calendar-convert.js',root),'utf8');
const sql=readFileSync(new URL('migrations/20261105_convert_calendar_events_to_activities.sql',root),'utf8');
const notes=readFileSync(new URL('migrations/20261105_preserve_calendar_conversion_notes.sql',root),'utf8');
new Script(bridge,{filename:'calendar-convert.js'});
for(const id of ['calendarConvertOpen','calendarEventConvert','calendarConvertDialog','calendarConvertIncludePast',
 'calendarConvertGroups','calendarConvertSummary','calendarConvertStatus','calendarConvertSelectAll',
 'calendarConvertConfirm','calendarConvertClose']){
 assert.equal(html.split('id="'+id+'"').length-1,1,id+' must occur exactly once');
}
assert.match(html,/<script src="calendar-convert.js"><\/script>/);
assert.match(bridge,/db\.rpc\('convert_calendar_events_to_activities'/);
assert.match(bridge,/expectedHousehold=HOUSE,expectedUser=user\.id/);
assert.match(bridge,/calendar-convert-occurrence/);
assert.match(bridge,/calendar-convert-price/);
assert.match(bridge,/confirm\(warning\)/);
assert.match(bridge,/value="0"/);
assert.match(bridge,/e\.event_date>=today/);
assert.match(bridge,/!e\.converted_at/);
assert.match(bridge,/!e\.source_id/);
assert.doesNotMatch(bridge,/auth\/v1\/authorize|location\.assign|saveSession|provider_refresh_token/);
assert.match(sql,/public\.household_members/);
assert.match(sql,/p_household_id/);
assert.match(sql,/v_all_ids && v_ids/);
assert.match(sql,/for update/);
assert.match(sql,/v_price < 0/);
assert.match(sql,/e\.source_id is null/);
assert.match(sql,/e\.converted_at is null/);
assert.match(sql,/e\.all_day=false/);
assert.match(sql,/e\.end_time>e\.start_time/);
assert.match(sql,/prev_date\+7/);
assert.match(sql,/v_run\.first_day,v_run\.last_day,false/);
assert.match(sql,/set hidden=true,converted_activity_id=/);
assert.match(sql,/insert into public\.schedules/);
assert.match(sql,/insert into public\.session_overrides/);
assert.match(sql,/cancelled_free/);
assert.match(sql,/grant execute on function public\.convert_calendar_events_to_activities/);
assert.match(notes,/insert into public\.activity_updates/);
assert.match(notes,/new\.converted_activity_id/);
const end=bridge.indexOf('function calendarConvertExistingOptions()');
assert.ok(end>100,'Conversion preview should be a testable section');
const section=bridge.slice(0,end);
const today='2026-11-05';
let includePast=false;
const source=[
 {id:'a1',title:'Piano',event_date:'2026-11-07',start_time:'15:00:00',end_time:'16:00:00',source_key:'google-copy:piano1',all_day:false},
 {id:'a2',title:'Piano',event_date:'2026-11-14',start_time:'15:00:00',end_time:'16:00:00',source_key:'google-copy:piano2',all_day:false},
 {id:'a3',title:'Piano',event_date:'2026-10-31',start_time:'15:00:00',end_time:'16:00:00',source_key:'google-copy:piano0',all_day:false},
 {id:'b1',title:'English',event_date:'2026-11-08',start_time:'10:00:00',end_time:'11:00:00',source_key:'ics:english',all_day:false},
 {id:'b2',title:'English',event_date:'2026-11-09',start_time:null,end_time:null,source_key:'ics:all-day',all_day:true},
 {id:'c1',title:'Piano',event_date:'2026-11-15',start_time:'15:00:00',end_time:'16:00:00',source_key:'feed:live',all_day:false,source_id:'feed'},
 {id:'c2',title:'Piano',event_date:'2026-11-21',start_time:'15:00:00',end_time:'16:00:00',source_key:'google-copy:converted',all_day:false,converted_at:'2026-11-01'},
 {id:'c3',title:'Piano',event_date:'2026-11-28',start_time:'15:00:00',end_time:'16:00:00',source_key:'google-copy:deleted',all_day:false,hidden:true},
 {id:'c4',title:'Piano',event_date:'2026-11-29',start_time:'15:00:00',end_time:'16:00:00',source_key:'household:local',all_day:false}
];
const build=new Function('importedEvents','localDate','document',section+
 '\nreturn {eligible:calendarConversionEligible,groups:calendarConversionGroups,setScope(v){calendarConvertScopedTitle=v}};');
const instance=build(source,()=>today,{getElementById:()=>({checked:includePast})});
assert.deepEqual(instance.eligible().map(x=>x.id),['a1','a2','b1']);
assert.deepEqual(instance.groups().map(g=>[g.name,g.events.length]),[['English',1],['Piano',2]]);
instance.setScope('piano');
assert.deepEqual(instance.groups().map(g=>[g.name,g.events.length]),[['Piano',2]]);
includePast=true;
assert.deepEqual(instance.groups().map(g=>[g.name,g.events.length]),[['Piano',3]]);
console.log('PASS: conversion preview, safe filters, provenance, bounded recurrence and atomic RPC contract.');
