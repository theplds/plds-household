-- A copied calendar appointment is a standalone, nonbillable Household event.
-- Status affects only this imported occurrence, never the recurring lesson/billing model.
alter table public.calendar_import_events
  add column if not exists event_status text not null default 'scheduled',
  add column if not exists replacement_date date,
  add column if not exists replacement_start_time time without time zone,
  add column if not exists replacement_end_time time without time zone;

alter table public.calendar_import_events
  drop constraint if exists calendar_import_event_status_valid,
  add constraint calendar_import_event_status_valid check (
    event_status in ('scheduled','cancelled','rescheduled') and
    (event_status <> 'rescheduled' or (
      replacement_date is not null and (all_day or replacement_start_time is not null)
    )) and
    (event_status = 'rescheduled' or (
      replacement_date is null and replacement_start_time is null and replacement_end_time is null
    )) and
    (not all_day or (replacement_start_time is null and replacement_end_time is null))
  );

grant update (event_status,replacement_date,replacement_start_time,replacement_end_time)
  on public.calendar_import_events to authenticated;

-- Defend live subscription records: status controls are for copied / local events only.
create or replace function private.guard_household_calendar_changes()
returns trigger language plpgsql set search_path='' as $$
begin
 if old.source_id is not null and (select auth.uid()) is not null and
   (new.title,new.details,new.location,new.event_date,new.start_time,
    new.end_time,new.all_day,new.event_status,new.replacement_date,
    new.replacement_start_time,new.replacement_end_time)
   is distinct from
   (old.title,old.details,old.location,old.event_date,old.start_time,
    old.end_time,old.all_day,old.event_status,old.replacement_date,
    old.replacement_start_time,old.replacement_end_time)
 then
   raise exception 'This event is controlled by its live calendar subscription. Import a local copy to edit it.'
     using errcode='42501';
 end if;
 new.updated_at:=clock_timestamp();
 return new;
end $$;
