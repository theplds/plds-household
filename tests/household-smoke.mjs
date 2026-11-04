import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script,createContext,runInContext} from 'node:vm';
import {URL as NodeURL} from 'node:url';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
assert.match(html,/PLDS Household v0\.3\.138/);
assert.ok(!html.includes('v0.3.137'),'The deployed version must be updated consistently');
const scripts=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)];
assert.ok(scripts.length>=1,'No embedded app scripts found');
for(const [,code] of scripts)new Script(code);

const start=html.indexOf('function priceAt(');
const end=html.indexOf('function getName(',start);
assert.ok(start>0&&end>start,'Historical pricing/session functions not found');
const lessonCode=html.slice(start,end);
const activity={id:'A',name:'Piano',price:40};
const schedule={id:'S',activity_id:'A',weekday:4,start_time:'14:00',valid_from:'2026-10-01',valid_until:null};
const dates=ym=>{
 const [y,m]=ym.split('-').map(Number),out=[];
 for(let d=new Date(Date.UTC(y,m-1,1));d.getUTCMonth()===m-1;d.setUTCDate(d.getUTCDate()+1)){
  out.push({date:d.toISOString().slice(0,10),weekday:d.getUTCDay()});
 }
 return out;
};
const ctx=createContext({
 activities:[activity],schedules:[schedule],overrides:[],monthlyAdjustments:[],
 activityPrices:[
  {activity_id:'A',effective_from:'0001-01-01',price:30},
  {activity_id:'A',effective_from:'2026-10-30',price:40},
  {activity_id:'A',effective_from:'2026-12-01',price:50}
 ],
 dates,month:'2026-10',Date
});
runInContext(lessonCode,ctx);
const history=runInContext('priceAt(activities[0],"2026-10-29")',ctx);
const current=runInContext('priceAt(activities[0],"2026-11-05")',ctx);
const future=runInContext('priceAt(activities[0],"2026-12-03")',ctx);
assert.equal(history,30);
assert.equal(current,40);
assert.equal(future,50);

ctx.overrides=[{schedule_id:'S',session_date:'2026-10-29',status:'rescheduled',new_date:'2026-11-05',new_time:'15:00'}];
let october=runInContext('sessions("2026-10")',ctx);
let november=runInContext('sessions("2026-11")',ctx);
assert.equal(october.find(x=>x.d.date==='2026-10-29').charge,0,'Original rescheduled lesson must be free');
assert.equal(november.find(x=>x.replacement).charge,30,'Replacement preserves original date fee');
assert.equal(november.find(x=>x.d.date==='2026-11-05'&&!x.replacement).charge,40);

ctx.overrides=[{schedule_id:'S',session_date:'2026-10-29',status:'cancelled_charged'}];
october=runInContext('sessions("2026-10")',ctx);
assert.equal(october.find(x=>x.d.date==='2026-10-29').charge,30);
ctx.overrides[0].status='cancelled_free';
october=runInContext('sessions("2026-10")',ctx);
assert.equal(october.find(x=>x.d.date==='2026-10-29').charge,0);

ctx.activityPrices=[];
assert.throws(()=>runInContext('priceAt(activities[0],"2026-10-29")',ctx),/Price history is unavailable/);

// Fixed monthly cost: one charge per calendar month regardless of number of sessions.
ctx.activityPrices=[
 {activity_id:'A',effective_from:'0001-01-01',price:30,billing_period:'session'},
 {activity_id:'A',effective_from:'2026-11-01',price:180,billing_period:'monthly'},
 {activity_id:'A',effective_from:'2026-12-01',price:190,billing_period:'monthly'}
];
ctx.overrides=[];
ctx.activities[0].created_at='2026-10-05T12:00:00Z';
const priceMode=expr=>runInContext(expr,ctx);
const octoberSessions=priceMode('sessions("2026-10")');
const novemberSessions=priceMode('sessions("2026-11")');
assert.ok(octoberSessions.some(x=>x.charge===30),'Old per-session charges should remain intact');
assert.ok(novemberSessions.length>0,'Schedule should remain in the calendar');
assert.ok(novemberSessions.every(x=>x.charge===0),'Monthly billing must not charge each lesson');
assert.equal(priceMode('monthlyActivityFee(activities[0],"2026-10")'),0);
assert.equal(priceMode('monthlyActivityFee(activities[0],"2026-11")'),180);
assert.equal(priceMode('monthlyActivityFee(activities[0],"2026-12")'),190);
assert.equal(priceMode('activityMonthTotal(activities[0],"2026-11",sessions("2026-11"))'),180);
ctx.overrides=[{schedule_id:'S',session_date:'2026-11-05',status:'rescheduled',new_date:'2026-12-03',new_time:'15:00'}];
assert.equal(priceMode('sessions("2026-12").find(x=>x.replacement).charge'),0,'Moving a monthly lesson must not bill twice');
assert.equal(priceMode('activityMonthTotal(activities[0],"2026-12",sessions("2026-12"))'),190);
ctx.overrides=[];
ctx.schedules=[];
ctx.activities[0].created_at='2026-11-04T22:50:00Z'; // Already November 5th in Athens.
ctx.activityPrices=[{activity_id:'A',effective_from:'0001-01-01',price:95,billing_period:'monthly'}];
assert.equal(priceMode('activityCreatedMonth(activities[0])'),'2026-11');
assert.equal(priceMode('monthlyActivityFee(activities[0],"2026-10")'),0,'Never back-bill before creation');
assert.equal(priceMode('monthlyActivityFee(activities[0],"2026-11")'),95,'New monthly activity bills this month without sessions');
assert.equal(priceMode('activityMonthTotal(activities[0],"2026-11",sessions("2026-11"))'),95);
ctx.monthlyAdjustments=[{activity_id:'A',billing_month:'2026-11-01',amount:0,reason:'Waived by parent'}];
assert.equal(priceMode('monthlyActivityFee(activities[0],"2026-11")'),0,'Manual override can waive an entire month');
assert.equal(priceMode('monthlyActivityFee(activities[0],"2026-12")'),95,'Override does not change other months');
ctx.monthlyAdjustments[0].amount=65;
assert.equal(priceMode('activityMonthTotal(activities[0],"2026-11",sessions("2026-11"))'),65,'Manual fee amount replaces normal monthly charge');
ctx.monthlyAdjustments=[];
assert.match(html,/id="abilling"/);
assert.match(html,/id="setupActivityBilling"/);
assert.match(html,/Fixed monthly fee/);

assert.ok(!html.includes('Changing an activity price can recalculate historical charges'),'Old report disclaimer must be corrected');
assert.match(html,/monthlyReportCsv/);
// The 3-dot menu offers navigation, not financial or destructive actions.
const menu=html.slice(html.indexOf('<details id="headerMoreMenu"'),html.indexOf('</details>',html.indexOf('<details id="headerMoreMenu"'))+10);
assert.ok(!menu.includes('data-menu-tab="children"'),'Children must be under Household Options, not the 3-dot menu');
assert.match(menu,/class="header-menu-dots"/);
assert.match(html,/#headerMoreMenu \.header-menu-dots\{[^}]*box-shadow:0 -7px 0 currentColor,0 7px 0 currentColor/);
assert.match(menu,/data-menu-tab="history"/);
assert.match(menu,/id="openSettings"/);
for(const id of ['openMonthlyReport','openSetupGuide','resetMonthActivities']){
 assert.ok(!menu.includes('id="'+id+'"'),'Unexpected '+id+' in overflow menu');
}
const budget=html.slice(html.indexOf('<div id="budgetDetails"'),html.indexOf('<section class="panel" id="content"'));
assert.ok(budget.includes('id="openMonthlyReport"'),'Monthly report must be inside Budget');
const options=html.slice(html.indexOf('<dialog id="settingsDialog"'),html.indexOf('<dialog id="passwordDialog"'));
for(const id of ['optionsProfile','optionsHousehold','optionsNotifications','optionsAppearance','optionsAccount']){
 assert.ok(options.includes('id="'+id+'"'),'Missing Options section '+id);
}
for(const id of ['manageChildren','openSetupGuide','resetMonthActivities','settingsName','enablePush','repairPush','themeToggle','dailyReminderEnabled','dailyReminderTime','logout','refreshAccess']){
 assert.ok(options.includes('id="'+id+'"'),'Misplaced Options action '+id);
 assert.equal(html.split('id="'+id+'"').length-1,1,'Duplicated UI id '+id);
}
assert.match(html,/optionsHousehold'\)\.addEventListener\('toggle'/);
assert.match(options,/<details id="optionsProfile" class="options-section">/);
assert.ok(!options.includes('<details id="optionsProfile" class="options-section" open>'),'Profile must initially be collapsed');
assert.match(html,/\$\('optionsProfile'\)\.open=false/);
assert.match(html,/\$\('manageChildren'\)\.onclick=\(\)=>\{\$\('settingsDialog'\)\.close\(\);tab='children';render\(\)\}/);
assert.ok(options.indexOf('id="manageChildren"')>options.indexOf('id="optionsHousehold"'),'Children action should be within Household section');
assert.ok(options.indexOf('id="manageChildren"')<options.indexOf('</details>',options.indexOf('id="optionsHousehold"')),'Children action must be inside Household accordion');
assert.match(html,/Session-rate changes apply today/);
assert.match(html,/password of at least 12 characters and your name/);
assert.ok(!html.includes('Changing an activity price affects past months too'),'Stale pricing guidance');
// Navigation state machine: all five visible destinations must stay exclusive.
const navStart=html.indexOf('function navigateDashboard(');
const navEnd=html.indexOf("$('viewToggle').onclick",navStart);
assert.ok(navStart>0&&navEnd>navStart,'Dashboard navigation handler missing');
let renderCount=0;
const navCtx=createContext({tab:'monthview',lastCalendarTab:'monthview',listWeek:'',render:()=>renderCount++});
runInContext(html.slice(navStart,navEnd),navCtx);
const go=(target,expected,last)=>{runInContext('navigateDashboard('+JSON.stringify(target)+')',navCtx);assert.equal(navCtx.tab,expected);if(last)assert.equal(navCtx.lastCalendarTab,last)};
go('budget','budget');
go('activities','activities');
go('payments','payments');
go('calendar','monthview','monthview');
go('calendar','sessions','sessions');
go('budget','budget','sessions');
go('calendar','sessions','sessions'); // Returning preserves the previous calendar mode
go('activities','activities','sessions');
go('activities','sessions','sessions'); // Tapping the active destination returns to calendar
go('calendar','monthview','monthview');
go('budget','budget','monthview');
go('budget','monthview','monthview');
go('history','history','monthview');
go('calendar','monthview','monthview');
assert.equal(renderCount,14);

// Test the real markup state-update logic using a tiny DOM substitute.
const stateStart=html.indexOf(' // Main navigation is exclusive:');
const stateEnd=html.indexOf(" let html='';",stateStart);
assert.ok(stateStart>0&&stateEnd>stateStart);
const stateCode=html.slice(stateStart,stateEnd);
function viewState(mode,previousCalendar){
 const ids=['viewToggle','budgetToggle','activities','payments'];
 const buttons=ids.map(id=>({
  id,classes:new Set(),attrs:{},textContent:'',title:'',
  setAttribute(k,v){this.attrs[k]=v;},
  classList:{toggle(){}}
 }));
 for(const b of buttons)b.classList={toggle(name,on){if(on)b.classes.add(name);else b.classes.delete(name)}};
 const items={viewToggle:buttons[0],budgetToggle:buttons[1],budgetDetails:{hidden:true},content:{hidden:false}};
 const doc={querySelectorAll(q){assert.equal(q,'.calendar-view-nav .tab');return buttons}};
 buttons[2].dataset={tab:'activities'};buttons[3].dataset={tab:'payments'};
 const context=createContext({tab:mode,lastCalendarTab:previousCalendar,budgetToggle:buttons[1],document:doc,$:id=>items[id]});
 runInContext(stateCode,context);
 const selected=buttons.filter(b=>b.attrs['aria-pressed']==='true');
 if(mode==='budget'){
  assert.equal(selected.length,1);assert.equal(selected[0].id,'budgetToggle');
  assert.equal(items.budgetDetails.hidden,false);assert.equal(items.content.hidden,true);
  assert.equal(buttons[1].attrs['aria-expanded'],'true');
 }else{
  assert.equal(items.budgetDetails.hidden,true);assert.equal(items.content.hidden,false);
  assert.equal(buttons[1].attrs['aria-expanded'],'false');
  if(mode==='monthview'||mode==='sessions'||mode==='activities'||mode==='payments'){
   assert.equal(selected.length,1,'Exactly one main view must be selected');
   assert.equal(selected[0].id,mode==='monthview'||mode==='sessions'?'viewToggle':mode);
  }else assert.equal(selected.length,0,'Secondary menu views must not highlight a main view');
 }
}
for(const mode of ['monthview','sessions','budget','activities','payments','children','history'])viewState(mode,'sessions');
assert.match(html,/#content\[hidden\]\{display:none!important\}/);
assert.ok(!html.includes('content:"⌄"'),'Replace the legacy Options dropdown glyph');
assert.match(html,/border-right:2px solid currentColor/);
// Options section surfaces contrast against dialog backgrounds in both themes.
assert.match(html,/\.options-section\{[^}]*background:#263a55\}/);
assert.match(html,/\.options-section\[open\]>summary\{background:#3a6097;color:#fff\}/);
assert.match(html,/:root\[data-theme="light"\] \.options-section>summary\{background:#eaf1fa\}/);
assert.match(html,/:root\[data-theme="light"\] \.options-section\[open\]>summary\{background:#bbd8f9;color:#14385c\}/);
assert.match(html,/\.options-section\[open\]>summary small,\.options-section\[open\]>summary::after\{color:#fff\}/);
// Activity updates and private read-state must remain separate from lesson billing.
for(const id of ['activityNotesDialog','activityNoteForm','noteViewerDialog','unreadNoticePanel']){
 assert.equal(html.split('id="'+id+'"').length-1,1,'Missing or duplicated notes UI '+id);
}
assert.match(html,/data-activity-notes/);
assert.match(html,/data-adjust-monthly/);
assert.match(html,/\.has-teacher-note/);
assert.match(html,/\.has-homework\.has-teacher-note/);
const noteStart=html.indexOf('/* Unread note state is per household member');
const noteEnd=html.indexOf('function render(){',noteStart);
assert.ok(noteStart>0&&noteEnd>noteStart,'Unread note logic unavailable');
const panel={hidden:true,innerHTML:''};
const noteContext=createContext({
 activities:[{id:'A',name:'Basketball'}],schedules:[{id:'S',activity_id:'A'}],
 teacherNotes:[{schedule_id:'S',lesson_date:'2026-11-04',teacher_id:'T',note:'Bring shoes',updated_at:'2026-11-04T12:00:00Z'}],
 lessonHomework:[{id:'H',schedule_id:'S',lesson_date:'2026-11-04',teacher_id:'T',description:'Practice drills',files:[],updated_at:'2026-11-04T12:30:00Z'}],
 activityUpdates:[{id:'N',activity_id:'A',title:'Court change',details:'Practice in hall B',session_date:'2026-11-05',updated_at:'2026-11-04T13:00:00Z'}],
 noticeReads:[],noticeFeedStart:'2026-11-01T00:00:00Z',user:{id:'U'},HOUSE:'HH',
 Date,displayDateDMY:x=>x,esc:x=>String(x),
 $:id=>{assert.equal(id,'unreadNoticePanel');return panel},
 db:{from:()=>({upsert:async()=>({error:null})})}
});
runInContext(html.slice(noteStart,noteEnd),noteContext);
assert.equal(runInContext('noticeItems().length',noteContext),3);
assert.equal(runInContext('unreadNotices().length',noteContext),3);
runInContext('renderUnreadNotices()',noteContext);
assert.equal(panel.hidden,false);
assert.match(panel.innerHTML,/3 unread/);
await runInContext('markNoticeSeen(unreadNotices()[0])',noteContext);
assert.equal(runInContext('unreadNotices().length',noteContext),2,'Opening an alert clears only that alert');
assert.match(panel.innerHTML,/2 unread/);
assert.equal(runInContext('noticeItems().find(n=>n.kind==="activity").key',noteContext),'activity:N');

// One-time ICS import: parse locally, preview, and keep external events outside paid schedules.
const parserSource=readFileSync(new URL('../calendar-import.js',import.meta.url),'utf8');
new Script(parserSource);
const icsCtx=createContext({Intl,Date,Error,Math,Set,Map,Number,String,RegExp});
runInContext(parserSource,icsCtx);
const parseICS=(source,opts={windowStart:'2026-10-01',windowEnd:'2027-05-31'})=>icsCtx.HouseholdICS.parse(source,opts);
const icsEvent=(uid,start,end,extras='')=>['BEGIN:VEVENT','UID:'+uid,'DTSTART:'+start,'DTEND:'+end,'SUMMARY:Test event',extras,'END:VEVENT'].filter(Boolean).join('\r\n');
const icsFile=events=>'BEGIN:VCALENDAR\r\nVERSION:2.0\r\n'+events.join('\r\n')+'\r\nEND:VCALENDAR';
const one=parseICS(icsFile([icsEvent('utc-test','20261105T150000Z','20261105T160000Z','LOCATION:New court')]));
assert.equal(one.events.length,1);
assert.equal(one.events[0].event_date,'2026-11-05');
assert.equal(one.events[0].start_time,'17:00:00','UTC must display in Athens time');
assert.equal(one.events[0].end_time,'18:00:00');
assert.equal(one.events[0].location,'New court');
const recurring=parseICS(icsFile([icsEvent('weekly','20261105T170000','20261105T180000',
 'RRULE:FREQ=WEEKLY;BYDAY=TU,TH;COUNT=4\r\nEXDATE:20261110T170000')]));
assert.equal(recurring.events.length,3,'Weekly recurrence must respect COUNT and EXDATE');
assert.equal(recurring.events[0].event_date,'2026-11-05');
assert.equal(recurring.events[1].event_date,'2026-11-12');
const duplicated=parseICS(icsFile([icsEvent('same','20261105T170000','20261105T180000'),icsEvent('same','20261105T170000','20261105T180000')]));
assert.equal(duplicated.events.length,1,'UID plus occurrence must deduplicate');
const allDay=parseICS(icsFile([icsEvent('holiday','20261225','20261226')]));
assert.equal(allDay.events[0].all_day,true);
assert.equal(allDay.events[0].start_time,null);
const complex=parseICS(icsFile([icsEvent('unknown-recurrence','20261105T170000','20261105T180000','RRULE:FREQ=MONTHLY;BYSETPOS=1;BYDAY=MO')]));
assert.equal(complex.events.length,0,'Never silently import a complex recurrence incorrectly');
assert.ok(complex.warnings.length>0);
const cancelled=parseICS(icsFile([
 icsEvent('series','20261105T170000','20261105T180000','RRULE:FREQ=DAILY;COUNT=3'),
 icsEvent('series','20261106T170000','20261106T180000','RECURRENCE-ID:20261106T170000\r\nSTATUS:CANCELLED')
]));
assert.equal(cancelled.events.length,2,'RECURRENCE-ID cancellations must be removed');
const zone=parseICS(icsFile([icsEvent('london','20261105T150000','20261105T160000','')]).replaceAll('DTSTART:','DTSTART;TZID=Europe/London:').replaceAll('DTEND:','DTEND;TZID=Europe/London:'));
assert.equal(zone.events[0].start_time,'17:00:00','London TZID must map to Athens');
const winTz=parseICS(icsFile([icsEvent('win-tz','20261105T170000','20261105T180000')]).replaceAll('DTSTART:','DTSTART;TZID=GTB Standard Time:').replaceAll('DTEND:','DTEND;TZID=GTB Standard Time:'));
assert.equal(winTz.events[0].start_time,'17:00:00','Windows Outlook TZID should map correctly');
const rangeSpan=parseICS(icsFile([icsEvent('multiday','20261105','20261108')]));
assert.equal(rangeSpan.events.length,3,'Exclusive-end three-day all-day events must show on all three days');
assert.equal(rangeSpan.events[2].event_date,'2026-11-07');

assert.match(html,/<script src="calendar-import\.js"><\/script>/);
for(const id of ['calendarImportDialog','calendarImportFile','calendarImportPreview','calendarImportSave','calendarImportChild','calendarImportFrom','calendarImportThrough','calendarEventDialog','openCalendarImporter']){
 assert.equal(html.split('id="'+id+'"').length-1,1,'Missing or repeated calendar import control '+id);
}
assert.match(html,/id="setupImportCalendar"/);
assert.match(html,/Step '\+\(setupStep\+1\)\+' of 6/);
assert.match(html,/'Calendar import','Finish'\]\[setupStep\]/);
assert.match(html,/next\.textContent=setupStep===5\?'Finish setup'/);
assert.match(html,/setupStep===4\)\{\n  content\.innerHTML='<p>Already have a family calendar\?/);
assert.match(html,/calendarImportFromSetup=false;setupStep=4;renderHouseholdSetup\(\)/);
assert.match(html,/setupStep===5\)\{\n  await saveHouseholdProfile\(householdProfile\.name,true\)/);
assert.match(html,/Imported entries will be visible to/);
assert.match(html,/data-import-event/);
assert.match(html,/db\.from\('calendar_import_events'\)/);
assert.match(html,/ignoreDuplicates:true,returning:true/);
assert.match(html,/importedEvents\.filter/);
assert.ok(!lessonCode.includes('importedEvents'), 'Imported events must remain outside the financial lesson model');

// QA onboarding may restart only in a specially designated, single-member household.
const qaMigration=readFileSync(new URL('../migrations/20261104_repeatable_qa_household.sql',import.meta.url),'utf8');
assert.match(qaMigration,/create table if not exists private\.qa_households/);
assert.match(qaMigration,/revoke all on private\.qa_households from public, anon, authenticated/);
assert.match(qaMigration,/v_actor uuid := \(select auth\.uid\(\)\)/);
assert.match(qaMigration,/m\.role='owner'/);
assert.match(qaMigration,/p_confirmation is distinct from 'RESET QA'/);
assert.match(qaMigration,/count\(\*\) from public\.household_members where user_id=v_actor\)<>1/);
assert.match(qaMigration,/count\(\*\) from public\.household_members where household_id=v_household\)<>1/);
assert.match(qaMigration,/delete from public\.calendar_import_events where household_id=v_household/);
assert.match(qaMigration,/delete from public\.activities where household_id=v_household/);
assert.match(qaMigration,/delete from public\.children where household_id=v_household/);
assert.match(qaMigration,/onboarding_completed_at=null/);
assert.ok(!qaMigration.includes("delete from auth.users"),'QA reset must preserve the authentication account');
for(const id of ['qaReplayTools','restartQaSetup','qaTestBanner']){
 assert.equal(html.split('id="'+id+'"').length-1,1,'Duplicate or missing QA control '+id);
}
assert.match(html,/qaMode=!qaCheck\.error&&qaCheck\.data===true/);
assert.match(html,/\$\('qaReplayTools'\)\.hidden=!qaMode/);
assert.match(html,/if\(!qaMode\|\|!user\)return/);
assert.match(html,/answer!=='RESET QA'/);
assert.match(html,/db\.rpc\('reset_my_qa_household',\{p_confirmation:'RESET QA'\}\)/);
assert.match(html,/await loadHouseholdProfile\(\);await load\(\);await loadPreferences\(\)/);
assert.match(html,/openHouseholdSetup\(true\)/);
assert.match(html,/qaMode=false;HOUSE=null/);

// Signup must visibly open a stand-alone registration form, not reuse hidden login fields.
for(const id of ['signupDialog','signupForm','signupEmail','signupName','signupPassword','signupPasswordConfirm','showSignupPassword','showSignupPasswordConfirm','signupSubmit','signupCancel','signupStatus']){
 assert.equal(html.split('id="'+id+'"').length-1,1,'Missing or duplicated signup control '+id);
}
assert.match(html,/id="betaSignup" aria-haspopup="dialog" aria-controls="signupDialog"/);
assert.match(html,/<form id="signupForm" novalidate>/);
assert.ok(!html.includes('id="betaName"'),'Obsolete registration field must not remain outside the form');
const signBegin=html.indexOf("$('betaSignup').onclick=()=>{");
const signEnd=html.indexOf("$('revealPassword').onclick=",signBegin);
assert.ok(signBegin>0&&signEnd>signBegin,'Invited signup interaction handlers missing');
const signupElements=Object.fromEntries(['signupDialog','signupForm','signupEmail','signupName',
 'signupPassword','signupPasswordConfirm','showSignupPassword','showSignupPasswordConfirm','signupStatus','signupSubmit','signupCancel',
 'betaSignup','betaStatus','email'].map(id=>[id,{value:'',textContent:'',disabled:false,type:'password',attrs:{},
  setAttribute(key,value){this.attrs[key]=String(value)},focus(){this.focused=true}}]));
signupElements.signupDialog.showModal=function(){this.open=true};
signupElements.signupDialog.close=function(){this.open=false};
let signupSubmit,signupRequests=[];
signupElements.signupForm.addEventListener=function(name,handler){if(name==='submit')signupSubmit=handler};
const signupCtx=createContext({
 $:id=>{assert.ok(signupElements[id],'Unexpected signup DOM reference '+id);return signupElements[id]},
 requestJson:async(path,opts)=>{signupRequests.push({path,opts});return {user:{id:'new-user'}}},
 saveSession:()=>{},start:async()=>{},HOUSE:null,
 globalThis:{URL:NodeURL},location:{href:'https://theplds.github.io/plds-household/'}
});
runInContext(html.slice(signBegin,signEnd),signupCtx);
signupElements.email.value='mpoulidis+household-qa@gmail.com';
signupElements.betaSignup.onclick();
assert.equal(signupElements.signupDialog.open,true,'Clicking Create invited account must open signup form');
assert.equal(signupElements.signupEmail.value,'mpoulidis+household-qa@gmail.com');
assert.equal(signupElements.signupEmail.focused,true);
signupElements.signupPassword.value='password-must-be-preserved';
signupElements.showSignupPassword.onclick();
assert.equal(signupElements.signupPassword.type,'text','Show reveals signup password');
assert.equal(signupElements.showSignupPassword.textContent,'Hide');
assert.equal(signupElements.showSignupPassword.attrs['aria-pressed'],'true');
assert.equal(signupElements.signupPassword.value,'password-must-be-preserved','Show preserves input');
assert.equal(signupElements.signupPasswordConfirm.type,'password','New password toggle should not expose confirmation');
signupElements.showSignupPasswordConfirm.onclick();
assert.equal(signupElements.signupPasswordConfirm.type,'text','Confirmation password can be revealed');
signupElements.showSignupPassword.onclick();
assert.equal(signupElements.signupPassword.type,'password','Hide masks password');
signupElements.betaSignup.onclick();
assert.equal(signupElements.signupPassword.type,'password','Reopen signup resets visibility');
assert.equal(signupElements.signupPasswordConfirm.type,'password','Confirmation should reset to hidden');
assert.equal(typeof signupSubmit,'function');
const submitEvent={preventDefault(){this.prevented=true}};
await signupSubmit(submitEvent);
assert.equal(submitEvent.prevented,true);
assert.equal(signupRequests.length,0,'Empty registration must not contact auth backend');
assert.match(signupElements.signupStatus.textContent,/Enter your name/);
signupElements.signupName.value='QA Tester';
signupElements.signupPassword.value='twelve-letters-1234';
signupElements.signupPasswordConfirm.value='wrong-password';
await signupSubmit({preventDefault(){}});
assert.equal(signupRequests.length,0,'Password mismatch must not create an account');
assert.match(signupElements.signupStatus.textContent,/do not match/);
signupElements.signupPasswordConfirm.value=signupElements.signupPassword.value;
await signupSubmit({preventDefault(){}});
assert.equal(signupRequests.length,1,'Valid registration submits exactly once');
assert.ok(signupRequests[0].path.startsWith('/auth/v1/signup?redirect_to='));
assert.equal(new NodeURL('https://example.invalid'+signupRequests[0].path).searchParams.get('redirect_to'),'https://theplds.github.io/plds-household/');
const signupPayload=JSON.parse(signupRequests[0].opts.body);
assert.equal(signupPayload.email,'mpoulidis+household-qa@gmail.com');
assert.equal(signupPayload.data.display_name,'QA Tester');
assert.equal(signupPayload.password,'twelve-letters-1234');
assert.equal(signupPayload.email_redirect_to,'https://theplds.github.io/plds-household/');
assert.match(signupElements.signupStatus.textContent,/Check mpoulidis\+household-qa@gmail\.com for a confirmation link/);
assert.equal(signupElements.signupSubmit.disabled,false,'Submit must reactivate when server completes');
assert.equal(signupElements.signupDialog.open,true,'Keep confirmation instructions visible');
signupElements.signupCancel.onclick();
assert.equal(signupElements.signupDialog.open,false);

// Sign out has one entry, inside the three-dot menu, not inside Options.
const headerMenu=html.slice(html.indexOf('<div class="header-more-options">'),html.indexOf('</div></details>',html.indexOf('<div class="header-more-options">')));
const optionsAccount=html.slice(html.indexOf('id="optionsAccount"'),html.indexOf('id="settingsStatus"',html.indexOf('id="optionsAccount"')));
assert.match(headerMenu,/id="logout" type="button">Sign out<\/button>/);
assert.ok(!optionsAccount.includes('id="logout"'),'Options must not also contain Sign out');
assert.equal(html.split('id="logout"').length-1,1,'Sign out must be unique');
assert.match(html,/\$\('logout'\)\.onclick=async\(\)=>\{\$\('headerMoreMenu'\)\.open=false/);
assert.match(html,/async function handleRecoveryLink\(\)/);
assert.match(html,/\['recovery','signup','invite','email'\]/);
assert.match(html,/history\.replaceState\(null,'',location\.pathname\)/);
console.log('PASS: signup Show-Hide, confirmation redirect, menu Sign out, and prior financial/calendar tests.');
