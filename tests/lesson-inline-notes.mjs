import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script} from 'node:vm';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
for(const [,js] of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))new Script(js);

assert.match(html,/<details id="lessonNotesDetails" class="lesson-child-dropdown lesson-notes-dropdown">\s*<summary>Notes<\/summary>/);
assert.match(html,/<textarea id="lessonNoteText" class="lesson-notes-text" maxlength="4000"/);
assert.match(html,/<button type="button" id="lessonNoteSave" class="primary">Save note<\/button>/);
assert.match(html,/id="lessonNotesList"/);
assert.doesNotMatch(html,/>Manage activity notes<\/button>/);
assert.doesNotMatch(html,/No activity notes yet\./);
assert.doesNotMatch(html,/openActivityNotesForLesson/);
assert.match(html,/\.lesson-child-dropdown summary\{font-weight:400!important\}/);
assert.match(html,/\.lesson-notes-text\{width:100%/);
assert.match(html,/inlineNoteSave\.dataset\.sessionDate=date/);
assert.match(html,/button\.disabled=true;status\.textContent='Saving…'/);
assert.match(html,/const saved=await createHouseholdActivityNote\(activityId,sessionDate,details\)/);
assert.match(html,/document\.createElement\('p'\);text\.textContent=saved\.details/);
assert.match(html,/item\.appendChild\(text\)/,'Existing notes are appended as plain text, not unsafe HTML');
assert.match(html,/function openActivityNotes\(activityId,sessionDate=null\)/,'Standalone activity note editor remains usable');

const start=html.indexOf('async function createHouseholdActivityNote(');
const end=html.indexOf("$('activityNoteForm').onsubmit",start);
assert.ok(start>0&&end>start,'Shared note-save helper is present');
const payloads=[],history=[];
const db={from(table){
 assert.equal(table,'activity_updates');
 return {insert(row){payloads.push(row);return {select:async()=>({error:null,data:[{id:'N1',...row}]})}}};
}};
const save=new Function('activities','user','HOUSE','db','activityUpdates','noticeItems','markNoticeSeen',
 html.slice(start,end)+'\nreturn createHouseholdActivityNote;')(
 [{id:'A'}],{id:'user1'},'house1',db,history,()=>[],()=>Promise.resolve()
);
const note=await save('A','2026-11-04','Bring blue folder');
assert.equal(note.details,'Bring blue folder');
assert.deepEqual(payloads[0],{
 household_id:'house1',activity_id:'A',created_by:'user1',title:'Note',
 details:'Bring blue folder',session_date:'2026-11-04',practice_time:'',location:'',source:'manual'
});
assert.equal(history.length,1,'Saved notes update the current activity feed');
await assert.rejects(()=>save('A','2026-11-04',''),/Enter a note/);
assert.equal(payloads.length,1,'Empty notes must not be sent to the database');
console.log('PASS: Notes disclosure matches lesson controls; one inline textarea saves safe activity notes without a second modal or empty state.');
