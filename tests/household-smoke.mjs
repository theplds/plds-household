import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script,createContext,runInContext} from 'node:vm';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
assert.match(html,/PLDS Household v0\.3\.129/);
assert.ok(!html.includes('v0.3.128'),'The deployed version must be updated consistently');
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
 activities:[activity],schedules:[schedule],overrides:[],
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
assert.ok(!html.includes('Changing an activity price can recalculate historical charges'),'Old report disclaimer must be corrected');
assert.match(html,/monthlyReportCsv/);
// The 3-dot menu offers navigation, not financial or destructive actions.
const menu=html.slice(html.indexOf('<details id="headerMoreMenu"'),html.indexOf('</details>',html.indexOf('<details id="headerMoreMenu"'))+10);
assert.match(menu,/data-menu-tab="children"/);
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
for(const id of ['openSetupGuide','resetMonthActivities','settingsName','enablePush','repairPush','themeToggle','dailyReminderEnabled','dailyReminderTime','logout','refreshAccess']){
 assert.ok(options.includes('id="'+id+'"'),'Misplaced Options action '+id);
 assert.equal(html.split('id="'+id+'"').length-1,1,'Duplicated UI id '+id);
}
assert.match(html,/optionsHousehold'\)\.addEventListener\('toggle'/);
assert.match(html,/Price changes apply from today/);
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
console.log('PASS: finance, navigation exclusivity, highlights, content visibility, and modern chevrons.');
