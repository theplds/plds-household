/* Convert one-time imported calendar appointments into native Household activities.
 * Conversion is atomic in Postgres, never writes back to Google, and does not
 * change session pricing unless the user explicitly sets a nonzero price or
 * chooses an existing paid activity.
 */
let calendarConvertScopedTitle=null;
let calendarConvertBusy=false;
let calendarConvertPreview=[];
const calendarConvertEl=id=>document.getElementById(id);
const calendarConvertKey=t=>String(t||'').trim().toLocaleLowerCase('en');

function calendarConversionEligible(includePast=false){
 const today=localDate(new Date());
 return importedEvents.filter(e=>
  !e.hidden&&!e.removed_from_source&&!e.source_id&&!e.converted_at&&
  !e.converted_activity_id&&!String(e.source_key||'').startsWith('household:')&&
  !e.all_day&&String(e.start_time||'').slice(0,5).length===5&&
  String(e.end_time||'').slice(0,5)>String(e.start_time||'').slice(0,5)&&
  (includePast||e.event_date>=today)
 );
}
function calendarConversionGroups(){
 const includePast=calendarConvertEl('calendarConvertIncludePast').checked;
 const rows=calendarConversionEligible(includePast);
 const lookup=new Map();
 for(const event of rows){
  if(calendarConvertScopedTitle!==null&&
   calendarConvertKey(event.title)!==calendarConvertKey(calendarConvertScopedTitle))continue;
  const key=calendarConvertKey(event.title);
  if(!lookup.has(key))lookup.set(key,{name:String(event.title||'').trim(),events:[]});
  lookup.get(key).events.push(event);
 }
 return [...lookup.values()].sort((a,b)=>a.name.localeCompare(b.name));
}
function calendarConvertExistingOptions(){
 return '<option value="">Create a new activity</option>'+
  activities.filter(a=>a.active!==false)
  .map(a=>'<option value="'+esc(a.id)+'">'+esc(a.name)+' · '+euro(a.price)+(a.billing_period==='monthly'?'/month':'/session')+'</option>').join('');
}
function calendarConvertPreviewTotals(){
 const checked=[...document.querySelectorAll('.calendar-convert-group-toggle:checked')];
 let events=0,paid=0,past=0;
 const today=localDate(new Date());
 for(const cb of checked){
  const wrap=cb.closest('.calendar-convert-group');
  const group=calendarConvertPreview[Number(wrap?.dataset.index)];
  const chosen=[...wrap.querySelectorAll('.calendar-convert-occurrence:checked')];
  events+=chosen.length;
  const chosenActivity=wrap.querySelector('.calendar-convert-existing')?.value;
  const existing=activities.find(a=>a.id===chosenActivity);
  const rawPrice=existing?Number(existing.price):Number(wrap.querySelector('.calendar-convert-price')?.value);
  if(Number.isFinite(rawPrice)&&rawPrice>0)paid+=chosen.length;
  past+=chosen.filter(x=>group?.events[Number(x.value)]?.event_date<today).length;
 }
 calendarConvertEl('calendarConvertSummary').textContent=
  checked.length+' activity group(s), '+events+' selected appointment(s). '+
  (paid?paid+' may generate charges. ':'Default price is €0. ')+
  (past?past+' are in the past. ':'')+
  'Conversion is all-or-nothing: a failure leaves every source event unchanged.';
 calendarConvertEl('calendarConvertConfirm').disabled=calendarConvertBusy||!events||
  checked.length>30||events>500;
}
function renderCalendarConvertGroups(){
 const el=calendarConvertEl('calendarConvertGroups');
 calendarConvertPreview=calendarConversionGroups();
 if(!calendarConvertPreview.length){
  el.innerHTML='<p class="muted">No eligible timed imported appointments. Try “Include past”. All-day items, events from live subscriptions, already converted items and appointments without an end time cannot become lessons.</p>';
  calendarConvertPreviewTotals();return;
 }
 const options=calendarConvertExistingOptions();
 const palette=Array.isArray(ACTIVITY_PALETTE)?ACTIVITY_PALETTE:['#5065f5'];
 el.innerHTML=calendarConvertPreview.map((group,i)=>{
  const sortedDates=group.events.map(e=>e.event_date).sort(),
        first=sortedDates[0],last=sortedDates[sortedDates.length-1];
  const match=activities.find(a=>a.active!==false&&calendarConvertKey(a.name)===calendarConvertKey(group.name));
  const defaultColor=palette[i%palette.length]||'#5065f5';
  const occurrences=group.events.slice().sort((a,b)=>(a.event_date+a.start_time).localeCompare(b.event_date+b.start_time));
  // Render using original source indices so toggles and RPC payload remain stable.
  return '<section class="calendar-convert-group" data-index="'+i+'">'+
   '<label class="calendar-convert-head"><input class="calendar-convert-group-toggle" type="checkbox" '+
    (calendarConvertScopedTitle!==null?'checked':'')+'><span>'+esc(group.name)+'</span></label>'+
   '<p class="calendar-convert-meta muted">'+group.events.length+' appointment(s) · '+esc(displayDateDMY(first))+' – '+esc(displayDateDMY(last))+
    (match?' · A Household activity with this name already exists':'')+'</p>'+
   '<div class="calendar-convert-controls">'+
    '<label>Activity name<input class="calendar-convert-name" maxlength="80" value="'+esc(group.name.slice(0,80))+'"></label>'+
    '<label>Use an existing activity<select class="calendar-convert-existing">'+options+'</select></label>'+
    '<label>Price per session (€)<input class="calendar-convert-price" type="number" min="0" max="10000" step="0.01" value="0"></label>'+
    '<label>Assign sessions<select class="calendar-convert-child"><option value="">Preserve imported child assignments</option>'+
      children.map(c=>'<option value="'+esc(c.id)+'">'+esc(c.name)+'</option>').join('')+'</select></label>'+
    '<fieldset class="calendar-convert-color-field"><legend>New activity color</legend>'+
      '<div class="calendar-convert-palette color-palette" role="radiogroup" aria-label="Choose activity color for '+esc(group.name)+'">'+
       palette.map(c=>'<label class="color-option" title="'+esc(c.toUpperCase())+'">'+
        '<input class="calendar-convert-color" type="radio" name="calendarConvertColor'+i+'" value="'+esc(c)+'" '+
        (c===defaultColor?'checked':'')+' aria-label="'+esc(c.toUpperCase())+'">'+
        '<span class="color-swatch" style="background:'+esc(c)+'"></span></label>').join('')+
      '</div><small class="calendar-convert-color-hint muted" hidden>Existing activity keeps its current color.</small></fieldset>'+
   '</div>'+
   '<details class="calendar-convert-dates"><summary>Review and select individual dates ('+group.events.length+')</summary>'+
     occurrences.map(event=>{
      const index=group.events.indexOf(event);
      return '<label class="calendar-convert-occurrence-label"><input class="calendar-convert-occurrence" type="checkbox" value="'+index+'" checked>'+
       '<span>'+esc(displayDateDMY(event.event_date))+' · '+esc(String(event.start_time).slice(0,5))+
       '–'+esc(String(event.end_time).slice(0,5))+
       (event.event_status==='cancelled'?' · Cancelled':event.event_status==='rescheduled'?' · Rescheduled':'')+
       '</span></label>';
     }).join('')+
    '</details>'+
   '</section>';
 }).join('');
 for(const groupEl of el.querySelectorAll('.calendar-convert-group')){
  const group=calendarConvertPreview[Number(groupEl.dataset.index)];
  const select=groupEl.querySelector('.calendar-convert-existing');
  const match=activities.find(a=>a.active!==false&&calendarConvertKey(a.name)===calendarConvertKey(group.name));
  if(match)select.value=match.id; // preserve existing lesson rates; never create duplicate activity names
  function syncExisting(){
   const existing=activities.find(a=>a.id===select.value);
   const price=groupEl.querySelector('.calendar-convert-price');
   const colors=[...groupEl.querySelectorAll('.calendar-convert-color')];
   colors.forEach(color=>{color.disabled=Boolean(existing)});
   groupEl.querySelector('.calendar-convert-color-hint').hidden=!existing;
   if(existing){price.value=String(existing.price);price.disabled=true;}
   else {price.disabled=false;price.value='0';}
   calendarConvertPreviewTotals();
  }
  select.addEventListener('change',syncExisting);syncExisting();
 }
 calendarConvertPreviewTotals();
}
function openCalendarConvertDialog(title=null){
 if(!user||!HOUSE){msg('Sign in to a household before converting imported events.');return;}
 if(calendarConvertBusy)return;
 calendarConvertScopedTitle=title;
 calendarConvertEl('calendarConvertIncludePast').checked=false;
 calendarConvertEl('calendarConvertStatus').textContent='';
 calendarConvertEl('calendarConvertHeading').textContent=
  title?'Convert “'+String(title).slice(0,65)+'” to a Household activity':
  'Convert imported calendar events to Household activities';
 renderCalendarConvertGroups();
 calendarConvertEl('calendarConvertDialog').showModal();
}
calendarConvertEl('calendarConvertOpen').onclick=()=>openCalendarConvertDialog();
calendarConvertEl('calendarEventConvert').onclick=()=>{
 const event=importedEvents.find(e=>e.id===openImportedEventId);
 if(!event||event.source_id||event.converted_at||event.hidden)return;
 const title=event.title;
 calendarConvertEl('calendarEventDialog').close();
 openCalendarConvertDialog(title);
};
calendarConvertEl('calendarConvertIncludePast').onchange=renderCalendarConvertGroups;
calendarConvertEl('calendarConvertSelectAll').onclick=()=>{
 const checks=[...document.querySelectorAll('.calendar-convert-group-toggle')];
 const shouldSelect=checks.some(x=>!x.checked);
 for(const cb of checks)cb.checked=shouldSelect;
 calendarConvertEl('calendarConvertSelectAll').textContent=shouldSelect?'Clear selection':'Select all eligible';
 calendarConvertPreviewTotals();
};
calendarConvertEl('calendarConvertGroups').addEventListener('change',e=>{
 if(e.target.matches('.calendar-convert-group-toggle,.calendar-convert-occurrence,.calendar-convert-price,.calendar-convert-name,.calendar-convert-child,.calendar-convert-color')){
  calendarConvertPreviewTotals();
 }
});
calendarConvertEl('calendarConvertClose').onclick=()=>{
 if(!calendarConvertBusy)calendarConvertEl('calendarConvertDialog').close();
};
calendarConvertEl('calendarConvertConfirm').onclick=async()=>{
 if(calendarConvertBusy||!user||!HOUSE)return;
 const panel=calendarConvertEl('calendarConvertDialog'),
  status=calendarConvertEl('calendarConvertStatus'),button=calendarConvertEl('calendarConvertConfirm');
 const groups=[];
 const expectedHousehold=HOUSE,expectedUser=user.id,today=localDate(new Date());
 let past=0,positive=0;
 for(const el of panel.querySelectorAll('.calendar-convert-group')){
  if(!el.querySelector('.calendar-convert-group-toggle')?.checked)continue;
  const source=calendarConvertPreview[Number(el.dataset.index)];
  if(!source)continue;
  const selected=[...el.querySelectorAll('.calendar-convert-occurrence:checked')].map(x=>source.events[Number(x.value)]).filter(Boolean);
  if(!selected.length)continue;
  const name=el.querySelector('.calendar-convert-name').value.trim(),
   existingId=el.querySelector('.calendar-convert-existing').value||null,
   childId=el.querySelector('.calendar-convert-child').value||null,
   price=Number(el.querySelector('.calendar-convert-price').value);
  if(!name||name.length>80||!Number.isFinite(price)||price<0||price>10000||
    selected.some(e=>!e?.id)){
   status.textContent='Check activity names, prices and dates. Prices must be between €0 and €10,000.';return;
  }
  const existing=activities.find(a=>a.id===existingId);
  if(existingId&&!existing){status.textContent='The selected activity no longer exists.';return}
  past+=selected.filter(e=>e.event_date<today).length;
  if((existing?Number(existing.price):price)>0)positive+=selected.length;
  groups.push({
   name,price,existing_activity_id:existingId,child_id:childId,
   color:el.querySelector('.calendar-convert-color:checked')?.value||'',
   event_ids:selected.map(e=>e.id)
  });
 }
 const total=groups.reduce((n,g)=>n+g.event_ids.length,0);
 if(!groups.length){status.textContent='Select at least one event group and date.';return}
 if(groups.length>30||total>500){status.textContent='Convert at most 30 activity types and 500 appointments at a time.';return}
 if(past||positive){
  const warning='Convert '+total+' appointments into real Household activities?'+
   (positive?' The selected prices can create lesson charges.':'')+
   (past?' You have included '+past+' past appointment(s), which may affect historical balances.':'')+
   ' Google Calendar will not be changed. This conversion cannot be undone automatically.';
  if(!confirm(warning))return;
 }else if(!confirm('Convert '+total+' imported appointments to native Household activities at €0 per session? Original imported copies will be hidden.'))return;
 calendarConvertBusy=true;
 button.disabled=true;calendarConvertEl('calendarConvertClose').disabled=true;
 status.textContent='Converting '+total+' appointments into Household activities…';
 try{
  if(!user||user.id!==expectedUser||HOUSE!==expectedHousehold)
   throw Error('Household account changed; conversion cancelled.');
  const result=await db.rpc('convert_calendar_events_to_activities',{
   p_household_id:expectedHousehold,p_groups:groups
  });
  if(result.error)throw result.error;
  const data=result.data;
  if(!data||Number(data.events)!==total)throw Error('Conversion response is incomplete. Reload the app to verify before retrying.');
  panel.close();
  if(calendarConvertEl('calendarImportDialog').open)calendarConvertEl('calendarImportDialog').close();
  await load();
  msg('Converted '+data.events+' appointments into '+data.created_activities+
   ' new activities and '+data.created_schedules+' bounded weekly/one-off sessions. Review Activities and Budget.');
 }catch(e){
  status.textContent='Conversion failed; no partial changes should have been saved: '+(e.message||String(e));
 }finally{
  calendarConvertBusy=false;button.disabled=false;calendarConvertEl('calendarConvertClose').disabled=false;
 }
};
