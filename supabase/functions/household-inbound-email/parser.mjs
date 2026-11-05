// Deterministic, conservative myTeam-style timetable parser.
// No external AI service, no invented sessions, and no automatic calendar edits.
const englishMonths={january:1,february:2,march:3,april:4,may:5,june:6,july:7,
 august:8,september:9,october:10,november:11,december:12};
const greekMonths={ιανουαριου:1,φεβρουαριου:2,μαρτιου:3,απριλιου:4,μαιου:5,ιουνιου:6,
 ιουλιου:7,αυγουστου:8,σεπτεμβριου:9,οκτωβριου:10,νοεμβριου:11,δεκεμβριου:12};
const days='monday|tuesday|wednesday|thursday|friday|saturday|sunday|δευτερα|τριτη|τεταρτη|πεμπτη|παρασκευη|σαββατο|κυριακη';
const escText=s=>String(s||'').replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/gi,'&')
 .replace(/&lt;/gi,'<').replace(/&gt;/gi,'>').replace(/&quot;/gi,'"')
 .replace(/&#39;|&apos;/gi,"'").replace(/&#(\d{1,6});/g,(_,n)=>{
 const cp=Number(n);return cp>0&&cp<=0x10ffff?String.fromCodePoint(cp):'';})
 .replace(/&#x([0-9a-f]{1,6});/gi,(_,hex)=>{
 const cp=parseInt(hex,16);return cp>0&&cp<=0x10ffff?String.fromCodePoint(cp):'';});
const flatten=s=>escText(s).replace(/[\u00a0\u200b]/g,' ').replace(/[ \t]+/g,' ').trim();
const fold=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
function validDate(y,m,d){
 if(y<2020||y>2100||m<1||m>12||d<1||d>31)return null;
 const test=new Date(Date.UTC(y,m-1,d));
 if(test.getUTCFullYear()!==y||test.getUTCMonth()!==m-1||test.getUTCDate()!==d)return null;
 return [y,String(m).padStart(2,'0'),String(d).padStart(2,'0')].join('-');
}
function dateFromHeading(text){
 const line=fold(flatten(text));
 const regex=new RegExp('(?:'+days+')\\s*[,·:\\-]?\\s*(\\d{1,2})\\s+([\\p{L}]+)\\s+(20\\d{2})','iu');
 const match=regex.exec(line);
 if(match){
  const name=match[2].toLowerCase(),m=englishMonths[name]||greekMonths[name];
  return m?validDate(Number(match[3]),m,Number(match[1])):null;
 }
 const iso=/\b(20\d{2})-(\d{2})-(\d{2})\b/.exec(line);
 return iso?validDate(Number(iso[1]),Number(iso[2]),Number(iso[3])):null;
}
export function htmlToScheduleText(html){
 let s=String(html||'').slice(0,160000).replace(/<!--[\s\S]*?-->/g,'')
  .replace(/<(script|style|svg)[^>]*>[\s\S]*?<\/\1>/gi,'');
 s=s.replace(/<(br|\/p|\/div|\/h[1-6]|\/li|\/tr|\/table|\/section|\/article)\b[^>]*>/gi,'\n')
  .replace(/<\/t[dh]\s*>/gi,' | ')
  .replace(/<[^>]+>/g,'');
 return escText(s).replace(/\r/g,'').split('\n').map(flatten).filter(Boolean).join('\n');
}
const timePattern=/\b([01]?\d|2[0-3]):([0-5]\d)\s*(?:-|–|—|έως|to)\s*([01]?\d|2[0-3]):([0-5]\d)\b/i;
function timeValue(h,m){return String(Number(h)).padStart(2,'0')+':'+m}
function findRange(s){
 const match=timePattern.exec(s);
 if(!match)return null;
 const start=timeValue(match[1],match[2]),end=timeValue(match[3],match[4]);
 if(start>=end)return null; // Never infer overnight practices.
 return {start,end,match};
}
function cleanVenue(text){
 return flatten(text).replace(/^\|+|\|+$/g,'').trim()
  .replace(/\b(?:j-?\d+|training|practice|match|game)\b[\s\S]*$/i,'').trim()
  .replace(/\b(?:αγορια|κοριτσια|προπονηση)\b[\s\S]*$/i,'').trim()
  .replace(/[|\-,;]+$/,'').trim().slice(0,200);
}
function lineCandidate(line,following){
 const range=findRange(line);if(!range)return null;
 const head=line.slice(0,range.match.index),tail=line.slice(range.match.index+range.match[0].length);
 const negative=fold(line).match(/cancelled|canceled|postponed|ακυρ|αναβολ/);
 if(negative)return null; // These require an explicit change/cancellation workflow.
 let venue=tail.split('|').map(cleanVenue).find(Boolean)||'';
 if(!venue&&!head.trim()&&following)venue=cleanVenue(following);
 if(!venue&&head.trim())venue=cleanVenue(head);
 return {...range,venue,description:flatten(line).slice(0,330)};
}
export function parseSportsEmail({text='',html=''}={}){
 const source=String(text||'').trim()||htmlToScheduleText(html);
 const lines=source.slice(0,150000).split(/\r?\n/).map(flatten).filter(Boolean);
 const found=[],seen=new Set();
 let day=null;
 for(let i=0;i<lines.length&&found.length<40;i++){
  const line=lines[i];
  const date=dateFromHeading(line);
  if(date){
   day=date;
   if(!findRange(line))continue;
  }
  if(!day)continue;
  const candidate=lineCandidate(line,lines[i+1]||'');
  if(!candidate)continue;
  const key=[day,candidate.start,candidate.end].join('|');
  if(seen.has(key))continue;
  seen.add(key);
  found.push({
   proposed_date:day,
   start_time:candidate.start,
   end_time:candidate.end,
   venue:candidate.venue,
   description:candidate.description
  });
 }
 return found;
}
export function normalizeEmailAddress(s){
 const txt=String(s||'').trim().toLowerCase();
 const m=/<([^<>\s@]+@[^<>\s@]+)>/.exec(txt);
 return m?m[1]:txt.replace(/^.*?\s+/,'');
}
