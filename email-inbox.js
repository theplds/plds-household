/* Household forwarded-mail review. No app account is replaced and
 * incoming email never modifies schedules without an explicit click. */
let emailIntakeState=null,emailInboxBusy=false;
const emailEl=id=>document.getElementById(id);
const emailFmtDate=d=>/^(\d{4})-(\d{2})-(\d{2})$/.test(d||'')?
 d.split('-').reverse().join('/'):d;
function emailOptions(items,selected,noneLabel='Choose activity'){
 return '<option value="">'+noneLabel+'</option>'+items.map(o=>
  '<option value="'+esc(o.id)+'"'+(o.id===selected?' selected':'')+'>'+esc(o.name)+'</option>').join('');
}
async function openForwardedEmailInbox(){
 if(!user||!HOUSE){msg('Sign in to a household first.');return;}
 if(emailInboxBusy)return;
 if(emailEl('settingsDialog')?.open)emailEl('settingsDialog').close();
 const dlg=emailEl('emailIntakeDialog');
 dlg.showModal();
 await refreshForwardedEmailInbox();
}
async function refreshForwardedEmailInbox(){
 if(!user||!HOUSE||!emailEl('emailIntakeDialog').open)return;
 const household=HOUSE,uid=user.id;
 const status=emailEl('emailIntakeStatus');
 emailInboxBusy=true;status.textContent='Loading email forwarding settings…';
 emailEl('emailIntakeSave').disabled=true;
 try{
  const [configuration,providerStatus]=await Promise.all([
   db.rpc('ensure_household_email_intake',{p_household_id:household}),
   fetch(URL+'/functions/v1/household-inbound-email',{method:'GET',
    headers:{apikey:KEY},cache:'no-store'}).then(r=>r.ok?r.json():{configured:false,domain:null})
    .catch(()=>({configured:false,domain:null}))
  ]);
  if(configuration.error)throw configuration.error;
  if(HOUSE!==household||user?.id!==uid)throw Error('Household session changed.');
  emailIntakeState=configuration.data;
  const domain=providerStatus?.configured&&providerStatus.domain?String(providerStatus.domain):'';
  const addr=domain?emailIntakeState.inbox_token+'@'+domain:'Provider not connected';
  emailEl('emailIntakeAddress').value=addr;
  emailEl('emailIntakeAddress').dataset.ready=domain?'true':'false';
  emailEl('emailIntakeProviderStatus').textContent=domain?
   'Receiving service configured. Complete the Gmail forwarding rule below.':
   'Receiving service not configured. An administrator must first connect Resend and set its webhook credentials in Supabase. Incoming mail is not yet monitored.';
  emailEl('emailIntakeSender').value=emailIntakeState.allowed_sender||'';
  emailEl('emailIntakeActivity').innerHTML=emailOptions(activities.filter(x=>x.active!==false),
   emailIntakeState.activity_id);
  emailEl('emailIntakeChild').innerHTML=emailOptions(children,emailIntakeState.child_id,
   'Use activity’s assigned children');
  emailEl('emailIntakeEnabled').checked=Boolean(emailIntakeState.enabled);
  emailEl('emailIntakeEnabled').disabled=!domain;
  emailEl('emailIntakeSave').disabled=!domain;
  const [m,p]=await Promise.all([
   db.from('household_email_inbox').select('*').eq('household_id',household)
    .order('received_at',{ascending:false}).limit(30),
   db.from('household_email_proposals').select('*').eq('household_id',household)
    .order('created_at',{ascending:false}).limit(150)
  ]);
  if(m.error)throw m.error;if(p.error)throw p.error;
  const inboxById=new Map((m.data||[]).map(x=>[x.id,x]));
  const pending=(p.data||[]).filter(x=>x.status==='pending');
  emailEl('emailIntakePendingCount').textContent=
   pending.length?pending.length+' training session(s) to review':'No new schedule proposals';
  const activityList=activities.filter(x=>x.active!==false),childList=children;
  emailEl('emailIntakeProposals').innerHTML=pending.length?pending.map(item=>{
   const mail=inboxById.get(item.inbox_id);
   return '<section class="email-proposal" data-id="'+esc(item.id)+'">'+
    '<strong>'+esc(emailFmtDate(item.proposed_date))+' · '+
       esc(String(item.start_time).slice(0,5))+'–'+esc(String(item.end_time).slice(0,5))+'</strong>'+
    (item.venue?'<p class="email-proposal-venue">'+esc(item.venue)+'</p>':'')+
    '<small>'+esc(mail?.subject||'Forwarded timetable')+
    (mail?.sender?' · '+esc(mail.sender):'')+'</small>'+
    '<div class="email-proposal-controls"><label>Activity<select class="email-proposal-activity">'+
      emailOptions(activityList,item.activity_id)+'</select></label>'+
    '<label>Child<select class="email-proposal-child">'+
      emailOptions(childList,item.child_id,'Use activity’s children')+'</select></label></div>'+
    '<div class="email-proposal-actions">'+
      '<button type="button" data-email-action="dismiss">Dismiss</button>'+
      '<button type="button" class="primary" data-email-action="approve">Approve session</button></div>'+
    '</section>';
  }).join(''):'<p class="muted">Nothing to review yet. Forwarded emails are not automatically added to the calendar.</p>';
  const unparsed=(m.data||[]).filter(x=>x.status==='unparsed');
  emailEl('emailIntakeUnparsed').innerHTML=unparsed.length?
   '<details><summary>'+unparsed.length+' email(s) without a recognized timetable</summary>'+
   unparsed.map(x=>'<p class="muted">'+esc(x.subject)+' · '+
    esc(new Date(x.received_at).toLocaleDateString('en-GB'))+
    ' — No schedule created. Check the original email manually.</p>').join('')+'</details>':'';
  status.textContent=domain?'Ready.':'Email receiving needs provider setup.';
 }catch(err){
  status.textContent='Cannot load email inbox: '+(err?.message||String(err));
 }finally{emailInboxBusy=false;}
}
emailEl('openEmailIntake').onclick=openForwardedEmailInbox;
emailEl('emailIntakeClose').onclick=()=>emailEl('emailIntakeDialog').close();
emailEl('emailIntakeRefresh').onclick=refreshForwardedEmailInbox;
emailEl('emailIntakeCopy').onclick=()=>{
 if(emailEl('emailIntakeAddress').dataset.ready!=='true')return;
 const address=emailEl('emailIntakeAddress').value;
 if(navigator.clipboard?.writeText){
  navigator.clipboard.writeText(address).then(()=>emailEl('emailIntakeStatus').textContent='Forwarding address copied.')
   .catch(()=>emailEl('emailIntakeStatus').textContent='Select and copy the address manually.');
 }else{emailEl('emailIntakeAddress').select();document.execCommand('copy');}
};
emailEl('emailIntakeSave').onclick=async()=>{
 if(emailInboxBusy||!emailIntakeState||!HOUSE)return;
 const sender=emailEl('emailIntakeSender').value.trim().toLowerCase(),
  activityId=emailEl('emailIntakeActivity').value||null,
  childId=emailEl('emailIntakeChild').value||null,
  enabled=emailEl('emailIntakeEnabled').checked;
 if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(sender)){
  emailEl('emailIntakeStatus').textContent='Enter the exact sender email address (not the displayed name).';return;
 }
 if(enabled&&!activityId){
  emailEl('emailIntakeStatus').textContent='Choose an activity before enabling forwarding.';return;
 }
 const b=emailEl('emailIntakeSave');b.disabled=true;
 try{
  const r=await db.from('household_email_intake').update({
   allowed_sender:sender,activity_id:activityId,child_id:childId,enabled
  }).eq('household_id',HOUSE).select('*');
  if(r.error)throw r.error;
  if(r.data?.length!==1)throw Error('The settings were not updated. Please reload.');
  emailIntakeState=r.data[0];
  emailEl('emailIntakeStatus').textContent='Forwarding settings saved. Gmail must also have a matching forwarding filter.';
 }catch(e){emailEl('emailIntakeStatus').textContent='Could not save: '+(e.message||String(e))}
 finally{b.disabled=false;}
};
emailEl('emailIntakeProposals').addEventListener('click',async e=>{
 const button=e.target.closest('[data-email-action]');if(!button||emailInboxBusy)return;
 const card=button.closest('[data-id]'),id=card?.dataset.id,action=button.dataset.emailAction;
 if(!id||!['approve','dismiss'].includes(action))return;
 const activityId=card.querySelector('.email-proposal-activity').value||null,
  childId=card.querySelector('.email-proposal-child').value||null;
 if(action==='approve'){
  const activity=activities.find(a=>a.id===activityId);
  if(!activity){emailEl('emailIntakeStatus').textContent='Choose the activity first.';return;}
  const rate=Number(activity.price)||0;
  const chargeNotice=rate>0?' This may generate a '+euro(rate)+' lesson charge (or affect the existing monthly fee).':'';
  if(!confirm('Approve this one-time session for '+activity.name+'?'+chargeNotice+
     ' It will create a normal Household activity session. Any conflicting existing appointment must be resolved manually.'))return;
 }else if(!confirm('Dismiss this proposed session?'))return;
 emailInboxBusy=true;button.disabled=true;
 try{
  const r=await db.rpc('review_household_email_proposal',{
   p_proposal_id:id,p_action:action,p_activity_id:action==='approve'?activityId:null,
   p_child_id:action==='approve'?childId:null
  });
  if(r.error)throw r.error;
  emailEl('emailIntakeStatus').textContent=action==='approve'?
   'Session approved. Check the calendar and Budget.':'Suggestion dismissed.';
  await load();
  await refreshForwardedEmailInbox();
 }catch(err){
  emailEl('emailIntakeStatus').textContent='Review failed: '+(err.message||String(err));
 }finally{emailInboxBusy=false;button.disabled=false;}
});
