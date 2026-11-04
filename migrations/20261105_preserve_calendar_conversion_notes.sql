-- Preserve imported descriptions and locations as session-linked Household activity notes.
-- Trigger runs inside the same atomic conversion transaction.
create or replace function private.preserve_converted_calendar_notes()
returns trigger language plpgsql set search_path='' as $$
begin
 if old.converted_at is null and new.converted_at is not null
  and new.converted_activity_id is not null and new.source_id is null
  and (pg_catalog.btrim(new.details)<>'' or pg_catalog.btrim(new.location)<>'') then
   insert into public.activity_updates(
    household_id,activity_id,title,details,session_date,practice_time,
    location,source,created_by
   ) values (
    new.household_id,new.converted_activity_id,
    pg_catalog.left('Calendar import · '||new.title,120),
    new.details,new.event_date,'',
    pg_catalog.left(new.location,250),'manual',
    coalesce((select auth.uid()),new.created_by)
   );
 end if;
 return new;
end $$;
drop trigger if exists preserve_converted_calendar_notes
 on public.calendar_import_events;
create trigger preserve_converted_calendar_notes
 after update of converted_at on public.calendar_import_events
 for each row execute function private.preserve_converted_calendar_notes();
