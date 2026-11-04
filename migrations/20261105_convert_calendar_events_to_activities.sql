-- Safely promote one-time imported calendar events into genuine Household activities.
-- Source records remain as hidden, idempotent provenance; no Google writes.
alter table public.calendar_import_events
 add column if not exists converted_activity_id uuid references public.activities(id) on delete set null,
 add column if not exists converted_schedule_id uuid references public.schedules(id) on delete set null,
 add column if not exists converted_at timestamptz;

create or replace function public.convert_calendar_events_to_activities(
 p_household_id uuid,
 p_groups jsonb
) returns jsonb
language plpgsql
security definer
set search_path=''
as $fn$
declare
 v_uid uuid := (select auth.uid());
 v_group jsonb;
 v_ids uuid[];
 v_all_ids uuid[] := array[]::uuid[];
 v_group_count integer;
 v_valid integer;
 v_total integer := 0;
 v_groups_done integer := 0;
 v_activities_created integer := 0;
 v_schedules_created integer := 0;
 v_existing_activity_id uuid;
 v_activity_id uuid;
 v_assigned_child uuid;
 v_name text;
 v_price numeric;
 v_color text;
 v_run record;
 v_id uuid;
 v_first date;
 v_last date;
begin
 if v_uid is null or p_household_id is null or not exists(
   select 1 from public.household_members m
   where m.household_id=p_household_id and m.user_id=v_uid
 ) then
   raise exception 'You do not have access to this household' using errcode='42501';
 end if;

 if jsonb_typeof(p_groups) is distinct from 'array' or
    jsonb_array_length(p_groups) < 1 or jsonb_array_length(p_groups) > 30 then
   raise exception 'Select 1 to 30 event groups per conversion' using errcode='22023';
 end if;
 -- Serialize concurrent imports/conversions in the same household.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_household_id::text,5927));

 for v_group in select value from pg_catalog.jsonb_array_elements(p_groups)
 loop
  if pg_catalog.jsonb_typeof(v_group) is distinct from 'object'
     or pg_catalog.jsonb_typeof(v_group->'event_ids') is distinct from 'array'
     or pg_catalog.jsonb_array_length(v_group->'event_ids') not between 1 and 500 then
   raise exception 'Each activity must contain 1 to 500 selected events' using errcode='22023';
  end if;

  v_name:=pg_catalog.btrim(v_group->>'name');
  if v_name is null or pg_catalog.length(v_name) not between 1 and 80 then
   raise exception 'Activity name must be 1 to 80 characters' using errcode='22023';
  end if;

  begin
   v_price:=(v_group->>'price')::numeric;
   v_existing_activity_id:=nullif(v_group->>'existing_activity_id','')::uuid;
   v_assigned_child:=nullif(v_group->>'child_id','')::uuid;
   v_ids:=array(select (value #>> '{}')::uuid
     from pg_catalog.jsonb_array_elements(v_group->'event_ids'));
  exception when invalid_text_representation or numeric_value_out_of_range or invalid_parameter_value then
   raise exception 'Conversion contains an invalid ID or amount' using errcode='22023';
  end;
  if v_price is null or v_price < 0 or v_price > 10000 then
   raise exception 'Price must be between 0 and 10000 EUR' using errcode='22023';
  end if;
  if coalesce(pg_catalog.array_length(v_ids,1),0) <>
     (select count(distinct value #>> '{}') from pg_catalog.jsonb_array_elements(v_group->'event_ids')) then
   raise exception 'An appointment appears more than once in one group' using errcode='22023';
  end if;
  if v_all_ids && v_ids then
   raise exception 'An appointment was selected in multiple groups' using errcode='22023';
  end if;
  v_total:=v_total+pg_catalog.array_length(v_ids,1);
  if v_total>500 then
   raise exception 'Convert at most 500 appointments at a time' using errcode='22023';
  end if;
  v_all_ids:=v_all_ids||v_ids;

  if v_assigned_child is not null and not exists(
   select 1 from public.children c
   where c.id=v_assigned_child and c.household_id=p_household_id
  ) then
   raise exception 'The selected child does not belong to this household' using errcode='42501';
  end if;
  -- Lock source rows, refuse live-feed events, stale selections and all-day
  -- entries (the Household lesson model requires explicit start/end times).
  perform 1 from public.calendar_import_events e
   where e.household_id=p_household_id and e.id=any(v_ids) for update;
  select count(*) into v_valid
   from public.calendar_import_events e
   where e.id=any(v_ids) and e.household_id=p_household_id
     and e.source_id is null and e.hidden=false and e.removed_from_source=false
     and e.converted_at is null and e.converted_activity_id is null
     and e.all_day=false and e.start_time is not null
     and e.end_time is not null and e.end_time>e.start_time;
  if v_valid<>pg_catalog.array_length(v_ids,1) then
   raise exception 'One or more appointments are already converted, inaccessible, all-day, or missing a valid end time. Refresh the preview.'
    using errcode='22023';
  end if;

  if v_existing_activity_id is not null then
   select a.id into v_activity_id from public.activities a
    where a.id=v_existing_activity_id and a.household_id=p_household_id and a.active=true;
   if v_activity_id is null then
    raise exception 'Selected activity is not available in this household' using errcode='42501';
   end if;
   -- Do not create duplicate paid lessons for an existing weekly slot.
   if exists(
    select 1 from public.calendar_import_events e join public.schedules s
     on s.activity_id=v_activity_id
     and s.weekday=extract(dow from e.event_date)::integer
     and s.start_time=e.start_time and s.end_time=e.end_time
     and e.event_date>=s.valid_from
     and (s.valid_until is null or e.event_date<=s.valid_until)
    where e.id=any(v_ids) and e.household_id=p_household_id
   ) then
    raise exception 'An existing activity already schedules at least one selected appointment. Deselect duplicates before converting.'
     using errcode='23505';
   end if;
  else
   if exists(select 1 from public.activities a where a.household_id=p_household_id
     and pg_catalog.lower(pg_catalog.btrim(a.name))=pg_catalog.lower(v_name)) then
    raise exception 'An activity already uses this name. Choose that existing activity in the conversion preview.'
     using errcode='23505';
   end if;
   v_color:=nullif(v_group->>'color','');
   if v_color is not null and v_color !~ '^#[0-9a-fA-F]{6}$' then
    raise exception 'Invalid activity color' using errcode='22023';
   end if;
   insert into public.activities(household_id,name,price,billing_period,color,active,updated_by)
   values(p_household_id,v_name,v_price,'session',v_color,true,v_uid)
   returning id into v_activity_id;
   v_activities_created:=v_activities_created+1;
  end if;

  -- Merge only truly consecutive occurrences of the same weekly slot.
  -- A skipped week becomes a separate bounded schedule, not a fabricated
  -- lesson, so conversion cannot charge for missing Google appointments.
  for v_run in
   with source as (
    select e.id,e.event_date,e.start_time,e.end_time,
      extract(dow from e.event_date)::integer as weekday,
      coalesce(v_assigned_child,e.child_id) as child_id,
      pg_catalog.lag(e.event_date) over(
       partition by extract(dow from e.event_date)::integer,
         e.start_time,e.end_time,coalesce(v_assigned_child,e.child_id)
       order by e.event_date,e.id
      ) as prev_date
    from public.calendar_import_events e
    where e.id=any(v_ids) and e.household_id=p_household_id
   ), marked as (
    select *,
      sum(case when prev_date is null or event_date<>prev_date+7 then 1 else 0 end)
      over(partition by weekday,start_time,end_time,child_id
        order by event_date,id rows unbounded preceding) as run_id
    from source
   )
   select min(event_date) as first_day,max(event_date) as last_day,
     weekday,start_time,end_time,child_id,
     array_agg(id order by event_date,id) as occurrence_ids
   from marked
   group by weekday,start_time,end_time,child_id,run_id
   order by first_day,weekday,start_time
  loop
   insert into public.schedules(
    activity_id,weekday,start_time,end_time,valid_from,valid_until,use_activity_children
   ) values(
    v_activity_id,v_run.weekday,v_run.start_time,v_run.end_time,
    v_run.first_day,v_run.last_day,false
   ) returning id into v_id;
   v_schedules_created:=v_schedules_created+1;

   if v_run.child_id is not null then
    insert into public.activity_children(activity_id,child_id)
     values(v_activity_id,v_run.child_id) on conflict do nothing;
    insert into public.schedule_children(schedule_id,child_id)
     values(v_id,v_run.child_id) on conflict do nothing;
   end if;

   insert into public.session_overrides(
    schedule_id,session_date,status,new_date,new_time,updated_by,updated_at
   )
   select v_id,e.event_date,
     case when e.event_status='cancelled' then 'cancelled_free' else 'rescheduled' end,
     case when e.event_status='rescheduled' then e.replacement_date else null end,
     case when e.event_status='rescheduled' then e.replacement_start_time else null end,
     v_uid,now()
   from public.calendar_import_events e
   where e.id=any(v_run.occurrence_ids)
      and e.event_status in ('cancelled','rescheduled');

   update public.calendar_import_events e
    set hidden=true,converted_activity_id=v_activity_id,
      converted_schedule_id=v_id,converted_at=now()
    where e.id=any(v_run.occurrence_ids) and e.household_id=p_household_id;
  end loop;
  v_groups_done:=v_groups_done+1;
 end loop;
 return pg_catalog.jsonb_build_object('groups',v_groups_done,
  'events',v_total,'created_activities',v_activities_created,
  'created_schedules',v_schedules_created);
end;
$fn$;
revoke all on function public.convert_calendar_events_to_activities(uuid,jsonb)
 from PUBLIC,anon,authenticated;
grant execute on function public.convert_calendar_events_to_activities(uuid,jsonb)
 to authenticated;
