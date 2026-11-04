/* Household calendar .ics parser — one-time, local preview. No network calls.
 * Supports common DAILY/WEEKLY/MONTHLY/YEARLY RRULEs, EXDATE and overrides.
 * Complex RRULEs are skipped with visible warnings, never silently simplified.
 */
(function(g){
'use strict';
const ATHENS='Europe/Athens',DOW=['SU','MO','TU','WE','TH','FR','SA'];
const dtfCache=new Map();
function partsInZone(ms,tz){
 let f=dtfCache.get(tz);
 if(!f){f=new Intl.DateTimeFormat('en-US',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});dtfCache.set(tz,f)}
 const a={};for(const part of f.formatToParts(new Date(ms)))if(part.type!=='literal')a[part.type]=Number(part.value);
 return {y:a.year,m:a.month,d:a.day,h:a.hour,min:a.minute,sec:a.second};
}
function zoneToMs(p,tz){
 let n=Date.UTC(p.y,p.m-1,p.d,p.h||0,p.min||0,p.sec||0);
 for(let i=0;i<4;i++){
  const a=partsInZone(n,tz);
  const delta=Date.UTC(p.y,p.m-1,p.d,p.h||0,p.min||0,p.sec||0)-
   Date.UTC(a.y,a.m-1,a.d,a.h||0,a.min||0,a.sec||0);
  if(!delta)break;n+=delta;
 }
 return n;
}
const iso=p=>[p.y,String(p.m).padStart(2,'0'),String(p.d).padStart(2,'0')].join('-');
const dayNumber=p=>Date.UTC(p.y,p.m-1,p.d)/86400000;
const ymdNum=n=>{const x=new Date(n*86400000);return {y:x.getUTCFullYear(),m:x.getUTCMonth()+1,d:x.getUTCDate()}};
function propDate(p,value){
 if(!p||!value)return null;
 const m=String(value).match(/^(\d{4})(\d\d)(\d\d)(?:T(\d\d)(\d\d)(\d\d)?(Z)?)?$/);
 if(!m)return null;
 const date={y:+m[1],m:+m[2],d:+m[3],h:+(m[4]||0),min:+(m[5]||0),sec:+(m[6]||0)};
 const check=new Date(Date.UTC(date.y,date.m-1,date.d));
 if(check.getUTCFullYear()!==date.y||check.getUTCMonth()!==date.m-1||check.getUTCDate()!==date.d||date.h>23||date.min>59||date.sec>59)return null;
 const allDay=!m[4],tz=m[7]?'UTC':(p.params.TZID||ATHENS);
 if(!allDay){try{new Intl.DateTimeFormat('en-US',{timeZone:tz})}catch(_){return null}}
 return {...date,allDay,tz,ms:allDay?Date.UTC(date.y,date.m-1,date.d):m[7]?Date.UTC(date.y,date.m-1,date.d,date.h,date.min,date.sec):zoneToMs(date,tz)};
}
function sourceInstance(base,day){
 const p={...day,h:base.h,min:base.min,sec:base.sec};
 return {...base,...p,ms:base.allDay?Date.UTC(day.y,day.m-1,day.d):base.tz==='UTC'?Date.UTC(day.y,day.m-1,day.d,p.h,p.min,p.sec):zoneToMs(p,base.tz)};
}
const textValue=s=>String(s||'').replace(/\\[nN]/g,'\n').replace(/\\([,;\\])/g,'$1');
function parseProperties(raw){
 const data={};for(const line of raw){
  const ix=line.indexOf(':');if(ix<0)continue;
  const left=line.slice(0,ix).split(';'),name=left.shift().toUpperCase(),params={};
  for(const bit of left){const i=bit.indexOf('=');if(i>0)params[bit.slice(0,i).toUpperCase()]=bit.slice(i+1).replace(/^"|"$/g,'')}
  (data[name]??=[]).push({value:line.slice(ix+1),params});
 }return data;
}
function parseRule(raw){
 if(!raw)return null;
 const o={};for(const item of raw.split(';')){const i=item.indexOf('=');if(i>0)o[item.slice(0,i).toUpperCase()]=item.slice(i+1)}
 if(!['DAILY','WEEKLY','MONTHLY','YEARLY'].includes(o.FREQ))return null;
 if(Object.keys(o).some(k=>!['FREQ','INTERVAL','COUNT','UNTIL','WKST','BYDAY','BYMONTHDAY','BYMONTH'].includes(k)))return null;
 if(o.WKST&&o.WKST!=='MO')return null;
 const interval=o.INTERVAL==null?1:Number(o.INTERVAL),count=o.COUNT==null?null:Number(o.COUNT);
 if(!Number.isInteger(interval)||interval<1||interval>365||count!==null&&(!Number.isInteger(count)||count<1||count>50000))return null;
 const days=o.BYDAY?o.BYDAY.split(',').map(x=>x.toUpperCase()):[];
 if(days.some(x=>!/^(?:[+-]?\d{1,2})?(?:SU|MO|TU|WE|TH|FR|SA)$/.test(x)))return null;
 if(o.FREQ==='WEEKLY'&&days.some(x=>!DOW.includes(x)))return null;
 const months=o.BYMONTH?o.BYMONTH.split(',').map(Number):[];
 const monthDays=o.BYMONTHDAY?o.BYMONTHDAY.split(',').map(Number):[];
 if(months.some(x=>!Number.isInteger(x)||x<1||x>12)||monthDays.some(x=>!Number.isInteger(x)||x===0||Math.abs(x)>31))return null;
 return {freq:o.FREQ,interval,count,days,months,monthDays,until:o.UNTIL||null};
}
function ordinalMatch(day,token){
 const m=token.match(/^([+-]?\d+)?(SU|MO|TU|WE|TH|FR|SA)$/);
 if(!m||DOW[new Date(Date.UTC(day.y,day.m-1,day.d)).getUTCDay()]!==m[2])return false;
 if(!m[1])return true;
 const n=Number(m[1]);if(!n||Math.abs(n)>5)return false;
 const last=new Date(Date.UTC(day.y,day.m,0)).getUTCDate();
 return n>0?Math.ceil(day.d/7)===n:Math.ceil((last-day.d+1)/7)===-n;
}
function followsRule(base,day,rule){
 const days=dayNumber(day)-dayNumber(base);if(days<0)return false;
 const monthDiff=(day.y-base.y)*12+day.m-base.m;
 const firstWeek=Math.floor((dayNumber(base)-(new Date(Date.UTC(base.y,base.m-1,base.d)).getUTCDay()+6)%7)/7);
 const currentWeek=Math.floor((dayNumber(day)-(new Date(Date.UTC(day.y,day.m-1,day.d)).getUTCDay()+6)%7)/7);
 if(rule.freq==='DAILY'&&days%rule.interval!==0)return false;
 if(rule.freq==='WEEKLY'&&(currentWeek-firstWeek)%rule.interval!==0)return false;
 if(rule.freq==='MONTHLY'&&(monthDiff<0||monthDiff%rule.interval!==0))return false;
 if(rule.freq==='YEARLY'&&((day.y-base.y)%rule.interval!==0))return false;
 if(rule.months.length&&!rule.months.includes(day.m))return false;
 const last=new Date(Date.UTC(day.y,day.m,0)).getUTCDate();
 if(rule.monthDays.length&&!rule.monthDays.some(x=>x>0?day.d===x:day.d===last+x+1))return false;
 if(rule.days.length&&!rule.days.some(x=>ordinalMatch(day,x)))return false;
 if(!rule.days.length&&!rule.monthDays.length){
  if(rule.freq==='WEEKLY'&&DOW[new Date(Date.UTC(day.y,day.m-1,day.d)).getUTCDay()]!==DOW[new Date(Date.UTC(base.y,base.m-1,base.d)).getUTCDay()])return false;
  if(rule.freq==='MONTHLY'&&day.d!==base.d)return false;
  if(rule.freq==='YEARLY'&&(day.d!==base.d||day.m!==base.m))return false;
 }else if(rule.freq==='YEARLY'&&!rule.months.length&&rule.days.length&&day.m!==base.m)return false;
 return true;
}
function parse(input,opts={}){
 if(typeof input!=='string'||input.length>2e6)throw Error('Choose an .ics file smaller than 2 MB.');
 if(!/BEGIN:VCALENDAR/i.test(input)||!/BEGIN:VEVENT/i.test(input))throw Error('This file does not contain iCalendar events.');
 const windowStart=opts.windowStart||'2026-05-01',windowEnd=opts.windowEnd||'2027-11-30',limit=Math.min(opts.limit||400,600);
 const startN=dayNumber({y:+windowStart.slice(0,4),m:+windowStart.slice(5,7),d:+windowStart.slice(8,10)});
 const endN=dayNumber({y:+windowEnd.slice(0,4),m:+windowEnd.slice(5,7),d:+windowEnd.slice(8,10)});
 if(endN<startN||endN-startN>800)throw Error('Import range must be within 800 days.');
 const lines=input.replace(/\r\n[ \t]/g,'').replace(/\n[ \t]/g,'').split(/\r?\n/),blocks=[];let inside=false,raw=[];
 for(const line of lines){
  const v=line.trim();
  if(v==='BEGIN:VEVENT'){inside=true;raw=[];continue}
  if(v==='END:VEVENT'){if(inside)blocks.push(parseProperties(raw));inside=false;continue}
  if(inside)raw.push(line);
 }
 const warnings=[],events=[],seen=new Set(),overrides=new Map(),masters=[];
 for(const props of blocks){
  const uid=props.UID?.[0]?.value?.trim();
  if(!uid){warnings.push('An event without a UID was skipped.');continue}
  const start=propDate(props.DTSTART?.[0],props.DTSTART?.[0]?.value);
  if(!start){warnings.push('An event has an invalid or unsupported date or timezone and was skipped.');continue}
  const end=propDate(props.DTEND?.[0],props.DTEND?.[0]?.value);
  const rid=props['RECURRENCE-ID']?.[0];
  const status=(props.STATUS?.[0]?.value||'').toUpperCase();
  const item={uid,props,start,end,status};
  if(rid){
   const original=propDate(rid,rid.value);
   if(!original){warnings.push('A recurrence exception has an unsupported date and was skipped.');continue}
   overrides.set(uid+'|'+(original.allDay?iso(original):original.ms),{...item,original});
  }else masters.push(item);
 }
 function add(item,instance,sourceKey){
  if(item.status==='CANCELLED')return;
  let local=instance.allDay?instance:partsInZone(instance.ms,ATHENS);
  let date=iso(local);if(dayNumber(local)<startN||dayNumber(local)>endN)return;
  const key=String(item.uid).slice(0,250)+'|'+sourceKey;
  if(seen.has(key))return;
  seen.add(key);
  const title=textValue(item.props.SUMMARY?.[0]?.value||'Untitled event').trim().slice(0,250)||'Untitled event';
  const duration=item.end&&item.start?(item.end.ms-item.start.ms):instance.allDay?86400000:3600000;
  const endMs=instance.ms+Math.max(0,Math.min(duration,14*86400000));
  const endLocal=instance.allDay?null:partsInZone(endMs,ATHENS);
  events.push({source_key:key,title,details:textValue(item.props.DESCRIPTION?.[0]?.value||'').slice(0,3000),
   location:textValue(item.props.LOCATION?.[0]?.value||'').slice(0,300),event_date:date,
   start_time:instance.allDay?null:String(local.h).padStart(2,'0')+':'+String(local.min).padStart(2,'0')+':00',
   end_time:endLocal?String(endLocal.h).padStart(2,'0')+':'+String(endLocal.min).padStart(2,'0')+':00':null,
   all_day:!!instance.allDay});
 }
 for(const item of masters){
  if(item.status==='CANCELLED')continue;
  const ruleRaw=item.props.RRULE?.[0]?.value;
  const rule=ruleRaw?parseRule(ruleRaw):null;
  if(ruleRaw&&!rule){warnings.push('An event with a complex recurrence rule was skipped: '+textValue(item.props.SUMMARY?.[0]?.value||'Untitled').slice(0,60));continue}
  const ex=new Set();
  for(const prop of item.props.EXDATE||[])for(const v of prop.value.split(',')){
   const d=propDate(prop,v);if(d)ex.add(d.allDay?iso(d):String(d.ms));
  }
  const candidates=[];
  if(rule){
   const baseN=dayNumber(item.start);
   const maxDay=Math.min(endN,baseN+15000),until=rule.until?propDate(item.props.DTSTART?.[0],rule.until):null;
   // If UNTIL is in UTC it is parsed using its own Z suffix.
   if(rule.until&&!until){warnings.push('An event with an invalid recurrence end was skipped.');continue}
   let found=0;
   for(let n=baseN;n<=maxDay;n++){
    const day=ymdNum(n);
    if(!followsRule(item.start,day,rule))continue;
    const inst=sourceInstance(item.start,day);
    if(until&&(item.start.allDay?n>dayNumber(until):inst.ms>until.ms))break;
    found++;
    if(rule.count&&found>rule.count)break;
    if(n>=startN&&n<=endN)candidates.push(inst);
    if(rule.count&&found>=rule.count)break;
   }
   if(baseN+15000<endN&&!rule.count&&!rule.until)warnings.push('A very old repeating series was truncated for safety.');
  }else candidates.push(item.start);
  for(const p of item.props.RDATE||[])for(const v of p.value.split(',')){const d=propDate(p,v);if(d)candidates.push(d)}
  for(const inst of candidates){
   const origin=inst.allDay?iso(inst):String(inst.ms);
   const override=overrides.get(item.uid+'|'+origin);
   if(ex.has(origin)&&!override)continue;
   const selected=override||item;
   if(override&&override.status==='CANCELLED')continue;
   const actual=override?override.start:inst;
   add(selected,actual,origin);
   if(events.length>=limit)break;
  }
  if(events.length>=limit){warnings.push('Preview capped at '+limit+' events; choose a smaller calendar or date range.');break}
 }
 for(const [key,override] of overrides)if(!masters.some(x=>x.uid===override.uid)){
  if(override.status!=='CANCELLED')add(override,override.start,key.split('|').slice(1).join('|'));
 }
 events.sort((a,b)=>(a.event_date+(a.start_time||'')).localeCompare(b.event_date+(b.start_time||''))||a.title.localeCompare(b.title));
 return {events,warnings,totalComponents:blocks.length,range:{start:windowStart,end:windowEnd}};
}
g.HouseholdICS={parse};
})(typeof globalThis!=='undefined'?globalThis:this);
