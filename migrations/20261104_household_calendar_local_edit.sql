-- Allow household members to edit locally owned calendar events.
-- Google is now a one-time copy. Do not grant edits to provider-owned feed metadata.
alter table public.calendar_import_events
 add column if not exists updated_at timestamptz not null default now();
grant update (title,details,location,event_date,start_time,end_time,all_day)
 on public.calendar_import_events to authenticated;

create or replace function private.guard_household_calendar_changes()
returns trigger language plpgsql set search_path='' as $$
begin
 -- Provider subscription events may be edited by the feed service, but
 -- ordinary users can only assign/hide them, not rewrite synced metadata.
 if old.source_id is not null and (select auth.uid()) is not null and
    (new.title,new.details,new.location,new.event_date,new.start_time,new.end_time,new.all_day)
    is distinct from
    (old.title,old.details,old.location,old.event_date,old.start_time,old.end_time,old.all_day)
 then
   raise exception 'Connected calendar events cannot be changed here. Disconnect or import a local copy first.'
   using errcode='42501';
 end if;
 new.updated_at:=clock_timestamp();
 return new;
end $$;
drop trigger if exists guard_household_calendar_changes on public.calendar_import_events;
create trigger guard_household_calendar_changes
 before update on public.calendar_import_events
 for each row execute function private.guard_household_calendar_changes();
