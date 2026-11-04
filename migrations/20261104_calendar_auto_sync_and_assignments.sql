-- Calendar subscriptions are read-only. Linking an event to an activity never bills it.
alter table public.calendar_import_events
 add column if not exists activity_id uuid references public.activities(id) on delete set null,
 add column if not exists hidden boolean not null default false,
 add column if not exists removed_from_source boolean not null default false;

create table public.calendar_sync_sources (
 id uuid primary key default gen_random_uuid(),
 household_id uuid not null references public.households(id) on delete cascade,
 label text not null check (length(btrim(label)) between 1 and 80),
 provider text not null check(provider in ('google','outlook','apple')),
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 last_synced_at timestamptz,
 last_error text,
 last_event_count integer,
 active boolean not null default true
);
create index calendar_sync_sources_household_idx on public.calendar_sync_sources(household_id);
alter table public.calendar_sync_sources enable row level security;
revoke all on public.calendar_sync_sources from anon,authenticated;
grant select on public.calendar_sync_sources to authenticated;
create policy calendar_sync_source_member_read on public.calendar_sync_sources
 for select to authenticated using(public.is_household_member(household_id));

alter table public.calendar_import_events
 add column if not exists source_id uuid references public.calendar_sync_sources(id) on delete cascade;
create index calendar_import_events_source_idx on public.calendar_import_events(source_id,event_date);

-- Existing imported events may be individually reassigned. Cross-household links are rejected.
grant update on public.calendar_import_events to authenticated;
create policy calendar_import_household_update on public.calendar_import_events
 for update to authenticated
 using(public.is_household_member(household_id))
 with check(public.is_household_member(household_id)
   and (child_id is null or exists(select 1 from public.children c
     where c.id=child_id and c.household_id=calendar_import_events.household_id))
   and (activity_id is null or exists(select 1 from public.activities a
     where a.id=activity_id and a.household_id=calendar_import_events.household_id))
   and (source_id is null or exists(select 1 from public.calendar_sync_sources sc
     where sc.id=source_id and sc.household_id=calendar_import_events.household_id)));
alter policy calendar_import_household_insert on public.calendar_import_events
 with check(public.is_household_member(household_id)
   and created_by=(select auth.uid())
   and (child_id is null or exists(select 1 from public.children c
     where c.id=child_id and c.household_id=calendar_import_events.household_id))
   and (activity_id is null or exists(select 1 from public.activities a
     where a.id=activity_id and a.household_id=calendar_import_events.household_id))
   and source_id is null);

-- Calendar URLs are secrets, never returned in an ordinary source list.
create table private.calendar_feed_credentials(
 source_id uuid primary key references public.calendar_sync_sources(id) on delete cascade,
 vault_secret_id uuid not null
);
revoke all on private.calendar_feed_credentials from public,anon,authenticated;
create or replace function private.cleanup_calendar_feed_secret()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 delete from vault.secrets where id=old.vault_secret_id;
 return old;
end $$;
create trigger calendar_feed_cleanup before delete on private.calendar_feed_credentials
 for each row execute function private.cleanup_calendar_feed_secret();

create or replace function public.connect_calendar_feed(p_label text,p_provider text,p_url text)
returns uuid language plpgsql security definer set search_path='' as $$
declare
 v_user uuid:=(select auth.uid());
 v_household uuid;
 v_id uuid;
 v_secret uuid;
 v_hostname text;
begin
 if v_user is null then raise exception 'Sign in required' using errcode='42501';end if;
 if p_label is null or length(btrim(p_label)) not between 1 and 80 then
  raise exception 'Enter a calendar name (up to 80 characters)' using errcode='22023';
 end if;
 if p_provider is null or p_provider not in ('google','outlook','apple') then
  raise exception 'Choose Google, Outlook or Apple calendar' using errcode='22023';
 end if;
 if p_url is null or length(p_url)>1800 or p_url !~ '^https://[^[:space:]?#]+/[^[:space:]#]*$' then
  raise exception 'A valid HTTPS calendar subscription link is required' using errcode='22023';
 end if;
 v_hostname:=lower(split_part(p_url,'/',3));
 if v_hostname like '%@%' or v_hostname like '%:%' then
  raise exception 'Calendar links may not contain credentials or custom ports' using errcode='22023';
 end if;
 if not (
  (p_provider='google' and v_hostname in ('calendar.google.com','calendar.googleusercontent.com'))
  or (p_provider='outlook' and v_hostname in ('outlook.office365.com','outlook.live.com','outlook.office.com'))
  or (p_provider='apple' and (v_hostname='icloud.com' or v_hostname like '%.icloud.com'))
 ) then
  raise exception 'This calendar provider link is not supported' using errcode='22023';
 end if;
 select m.household_id into v_household from public.household_members m
 where m.user_id=v_user limit 1;
 if v_household is null or not public.is_household_member(v_household) then
  raise exception 'Household membership required' using errcode='42501';
 end if;
 if (select count(*) from public.calendar_sync_sources c where c.household_id=v_household)>=5 then
  raise exception 'Maximum five connected calendars per household' using errcode='22023';
 end if;
 insert into public.calendar_sync_sources(household_id,label,provider,created_by)
 values(v_household,btrim(p_label),p_provider,v_user) returning id into v_id;
 v_secret:=vault.create_secret(p_url,'household-feed-'||v_id::text,
   'Private read-only calendar feed for Household',null);
 insert into private.calendar_feed_credentials(source_id,vault_secret_id) values(v_id,v_secret);
 return v_id;
end $$;
revoke all on function public.connect_calendar_feed(text,text,text) from public,anon;
grant execute on function public.connect_calendar_feed(text,text,text) to authenticated;

create or replace function public.disconnect_calendar_feed(p_source_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_user uuid:=(select auth.uid());
begin
 if v_user is null then raise exception 'Sign in required' using errcode='42501';end if;
 if not exists(select 1 from public.calendar_sync_sources s
   where s.id=p_source_id and public.is_household_member(s.household_id)) then
  raise exception 'Calendar is not available to your household' using errcode='42501';
 end if;
 delete from public.calendar_sync_sources where id=p_source_id;
 return true;
end $$;
revoke all on function public.disconnect_calendar_feed(uuid) from public,anon;
grant execute on function public.disconnect_calendar_feed(uuid) to authenticated;

-- Only the service-role Edge Function may retrieve the decrypted feed URL.
create or replace function public.read_calendar_feed_secret(p_source_id uuid)
returns text language plpgsql security definer set search_path='' as $$
declare v_url text;
begin
 if (select auth.role()) is distinct from 'service_role' then
  raise exception 'Server authorization required' using errcode='42501';
 end if;
 select d.decrypted_secret into v_url
 from private.calendar_feed_credentials c
 join vault.decrypted_secrets d on d.id=c.vault_secret_id
 where c.source_id=p_source_id;
 return v_url;
end $$;
revoke all on function public.read_calendar_feed_secret(uuid) from public,anon,authenticated;
grant execute on function public.read_calendar_feed_secret(uuid) to service_role;
