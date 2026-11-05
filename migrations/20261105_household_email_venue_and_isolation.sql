-- Defense in depth: never accept mixed-household email metadata, even if a
-- future ingestion code path makes a routing mistake.
create or replace function private.guard_household_email_proposal()
returns trigger language plpgsql set search_path='' as $$
begin
 if not exists(
  select 1 from public.household_email_inbox i
   where i.id=new.inbox_id and i.household_id=new.household_id
 ) then raise exception 'Email proposal household mismatch' using errcode='42501'; end if;
 if new.activity_id is not null and not exists(
  select 1 from public.activities a
   where a.id=new.activity_id and a.household_id=new.household_id
 ) then raise exception 'Email proposal activity household mismatch' using errcode='42501'; end if;
 if new.child_id is not null and not exists(
  select 1 from public.children c
   where c.id=new.child_id and c.household_id=new.household_id
 ) then raise exception 'Email proposal child household mismatch' using errcode='42501'; end if;
 return new;
end $$;
drop trigger if exists guard_household_email_proposal on public.household_email_proposals;
create trigger guard_household_email_proposal
 before insert or update on public.household_email_proposals for each row
 execute function private.guard_household_email_proposal();

-- Venue is a note attached to the *approved* session, never a separate input.
-- No message body is copied to calendar or financial records.
create or replace function private.note_approved_email_venue()
returns trigger language plpgsql set search_path='' as $$
begin
 if old.status='pending' and new.status='approved' and new.venue<>'' and
  new.activity_id is not null and new.reviewed_by is not null then
  insert into public.activity_updates(
   household_id,activity_id,title,details,session_date,practice_time,location,source,created_by
  ) values(
   new.household_id,new.activity_id,'Training venue',
   'Venue: '||new.venue,new.proposed_date,'',new.venue,'copied_email',new.reviewed_by
  );
 end if;
 return new;
end $$;
drop trigger if exists note_approved_email_venue on public.household_email_proposals;
create trigger note_approved_email_venue
 after update of status on public.household_email_proposals for each row
 execute function private.note_approved_email_venue();
