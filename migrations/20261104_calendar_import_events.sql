-- Read-only one-time calendar imports. Independent of paid activities and weekly lessons.
create table if not exists public.calendar_import_events (
 id uuid primary key default gen_random_uuid(),
 household_id uuid not null references public.households(id) on delete cascade,
 source_key text not null check (length(source_key) between 1 and 450),
 title text not null check (length(btrim(title)) between 1 and 250),
 details text not null default '' check (length(details)<=3000),
 location text not null default '' check (length(location)<=300),
 event_date date not null,
 start_time time without time zone,
 end_time time without time zone,
 all_day boolean not null default false,
 child_id uuid references public.children(id) on delete set null,
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 unique (household_id,source_key),
 constraint calendar_import_time_valid check (all_day or start_time is not null)
);
create index if not exists calendar_import_month_idx
 on public.calendar_import_events(household_id,event_date);
alter table public.calendar_import_events enable row level security;
revoke all on public.calendar_import_events from anon;
grant select,insert,delete on public.calendar_import_events to authenticated;

create policy calendar_import_household_read on public.calendar_import_events for select to authenticated
 using (public.is_household_member(household_id));
create policy calendar_import_household_insert on public.calendar_import_events for insert to authenticated
 with check (public.is_household_member(household_id)
  and created_by=(select auth.uid())
  and (child_id is null or exists(select 1 from public.children c
   where c.id=child_id and c.household_id=calendar_import_events.household_id)));
create policy calendar_import_household_delete on public.calendar_import_events for delete to authenticated
 using (public.is_household_member(household_id));
