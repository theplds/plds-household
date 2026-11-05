-- Household inbox v1: narrowly allowed forwarders, review-only proposals,
-- and explicit user approval before creating bounded native activity sessions.
-- No incoming email can directly edit lessons, prices or Google Calendar.
create table if not exists public.household_email_intake (
 household_id uuid primary key references public.households(id) on delete cascade,
 inbox_token text not null unique default
    (replace(gen_random_uuid()::text,'-','') || replace(gen_random_uuid()::text,'-','')),
 allowed_sender text,
 activity_id uuid references public.activities(id) on delete set null,
 child_id uuid references public.children(id) on delete set null,
 enabled boolean not null default false,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 constraint household_email_sender_valid check (
   allowed_sender is null or
   (length(allowed_sender) between 5 and 254 and
    allowed_sender = lower(btrim(allowed_sender)) and
    allowed_sender ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')
 ),
 constraint household_email_enabled_configured check
   (not enabled or (allowed_sender is not null and activity_id is not null))
);

create table if not exists public.household_email_inbox (
 id uuid primary key default gen_random_uuid(),
 household_id uuid not null references public.households(id) on delete cascade,
 provider_email_id text not null unique,
 sender text not null,
 subject text not null,
 excerpt text not null default '',
 received_at timestamptz not null default now(),
 status text not null default 'new'
  check(status in ('new','reviewed','unparsed')),
 created_at timestamptz not null default now(),
 constraint household_email_provider_key_limit check(length(provider_email_id) between 8 and 180),
 constraint household_email_subject_limit check(length(subject)<=350),
 constraint household_email_excerpt_limit check(length(excerpt)<=800)
);

create table if not exists public.household_email_proposals (
 id uuid primary key default gen_random_uuid(),
 household_id uuid not null references public.households(id) on delete cascade,
 inbox_id uuid not null references public.household_email_inbox(id) on delete cascade,
 proposed_date date not null,
 start_time time not null,
 end_time time not null,
 venue text not null default '',
 description text not null default '',
 status text not null default 'pending'
  check(status in ('pending','approved','dismissed')),
 activity_id uuid references public.activities(id) on delete set null,
 child_id uuid references public.children(id) on delete set null,
 schedule_id uuid unique references public.schedules(id) on delete set null,
 created_at timestamptz not null default now(),
 reviewed_at timestamptz,
 reviewed_by uuid,
 constraint household_email_proposal_time check(end_time>start_time),
 constraint household_email_proposal_venue check(length(venue)<=250),
 constraint household_email_proposal_description check(length(description)<=350),
 unique(inbox_id,proposed_date,start_time,end_time)
);

create index if not exists household_email_inbox_by_household
 on public.household_email_inbox(household_id,received_at desc);
create index if not exists household_email_pending_by_household
 on public.household_email_proposals(household_id,created_at desc)
 where status='pending';

alter table public.household_email_intake enable row level security;
alter table public.household_email_inbox enable row level security;
alter table public.household_email_proposals enable row level security;

drop policy if exists "Household members can read email intake" on public.household_email_intake;
create policy "Household members can read email intake"
 on public.household_email_intake for select to authenticated
 using(exists(select 1 from public.household_members m
  where m.household_id=household_email_intake.household_id and m.user_id=(select auth.uid())));
drop policy if exists "Household members can update intake options" on public.household_email_intake;
create policy "Household members can update intake options"
 on public.household_email_intake for update to authenticated
 using(exists(select 1 from public.household_members m
  where m.household_id=household_email_intake.household_id and m.user_id=(select auth.uid())))
 with check(exists(select 1 from public.household_members m
  where m.household_id=household_email_intake.household_id and m.user_id=(select auth.uid())));

drop policy if exists "Household members can read forwarded emails" on public.household_email_inbox;
create policy "Household members can read forwarded emails"
 on public.household_email_inbox for select to authenticated
 using(exists(select 1 from public.household_members m
  where m.household_id=household_email_inbox.household_id and m.user_id=(select auth.uid())));
drop policy if exists "Household members can read schedule suggestions" on public.household_email_proposals;
create policy "Household members can read schedule suggestions"
 on public.household_email_proposals for select to authenticated
 using(exists(select 1 from public.household_members m
  where m.household_id=household_email_proposals.household_id and m.user_id=(select auth.uid())));

revoke all on public.household_email_intake,public.household_email_inbox,public.household_email_proposals from anon,authenticated;
grant select on public.household_email_intake,public.household_email_inbox,public.household_email_proposals to authenticated;
grant update(allowed_sender,activity_id,child_id,enabled)
 on public.household_email_intake to authenticated;

-- Multi-household isolation for user configuration updates; RLS alone would
-- permit linking an activity from another household if its ID were guessed.
create or replace function private.guard_household_email_config()
returns trigger language plpgsql set search_path='' as $$
begin
 if new.activity_id is not null and not exists(
  select 1 from public.activities a where a.id=new.activity_id
   and a.household_id=new.household_id and a.active=true
 ) then raise exception 'Select an active activity from this household' using errcode='42501'; end if;
 if new.child_id is not null and not exists(
  select 1 from public.children c where c.id=new.child_id
   and c.household_id=new.household_id
 ) then raise exception 'Select a child from this household' using errcode='42501'; end if;
 if tg_op='UPDATE' and new.inbox_token<>old.inbox_token
 then raise exception 'Inbox address cannot be changed' using errcode='42501'; end if;
 new.updated_at=now();
 return new;
end $$;
drop trigger if exists guard_household_email_config on public.household_email_intake;
create trigger guard_household_email_config
 before insert or update on public.household_email_intake
 for each row execute function private.guard_household_email_config();

-- The inbox token is generated server-side and never chosen by the browser.
create or replace function public.ensure_household_email_intake(p_household_id uuid)
returns public.household_email_intake
language plpgsql security definer set search_path='' as $$
declare v_result public.household_email_intake;
begin
 if (select auth.uid()) is null or not exists(
  select 1 from public.household_members m
   where m.household_id=p_household_id and m.user_id=(select auth.uid())
 ) then raise exception 'Not authorized for this household' using errcode='42501'; end if;
 insert into public.household_email_intake(household_id)
 values(p_household_id) on conflict(household_id) do nothing;
 select * into strict v_result from public.household_email_intake
  where household_id=p_household_id;
 return v_result;
end $$;
revoke all on function public.ensure_household_email_intake(uuid) from public,anon;
grant execute on function public.ensure_household_email_intake(uuid) to authenticated;

create or replace function public.review_household_email_proposal(
 p_proposal_id uuid,p_action text,p_activity_id uuid default null,p_child_id uuid default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
 v public.household_email_proposals%rowtype;
 v_activity public.activities%rowtype;
 v_schedule uuid;
 v_weekday integer;
begin
 select * into v from public.household_email_proposals
  where id=p_proposal_id for update;
 if not found or (select auth.uid()) is null or not exists(
  select 1 from public.household_members m
   where m.household_id=v.household_id and m.user_id=(select auth.uid())
 ) then raise exception 'Proposal not available to this household' using errcode='42501'; end if;
 if v.status<>'pending' then
  raise exception 'This proposal has already been reviewed' using errcode='23505'; end if;
 if p_action='dismiss' then
  update public.household_email_proposals
   set status='dismissed',reviewed_at=now(),reviewed_by=(select auth.uid())
   where id=v.id;
  return jsonb_build_object('status','dismissed');
 end if;
 if p_action<>'approve' then
  raise exception 'Choose Approve or Dismiss' using errcode='22023'; end if;
 select * into v_activity from public.activities
  where id=p_activity_id and household_id=v.household_id and active=true;
 if not found then raise exception 'Choose a current Household activity' using errcode='42501'; end if;
 if p_child_id is not null and not exists(
  select 1 from public.children c
   where c.id=p_child_id and c.household_id=v.household_id
 ) then raise exception 'Choose a child from this household' using errcode='42501'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v.household_id::text,89431));
 v_weekday=extract(dow from v.proposed_date)::integer;
 -- An existing schedule covering the same date and overlapping time is a
 -- conflict, not an invitation to duplicate a lesson and charge it twice.
 if exists(
  select 1 from public.schedules s
  join public.activities a on a.id=s.activity_id
  where a.household_id=v.household_id and s.weekday=v_weekday
   and v.proposed_date>=s.valid_from
   and (s.valid_until is null or v.proposed_date<=s.valid_until)
   and s.start_time<v.end_time and s.end_time>v.start_time
 ) or exists(
  select 1 from public.calendar_import_events e
   where e.household_id=v.household_id and e.hidden=false
    and e.event_date=v.proposed_date and e.start_time<v.end_time and e.end_time>v.start_time
 ) then
  raise exception 'Schedule conflict on this date and time. Review the existing appointment before adding another.' using errcode='23505';
 end if;

 insert into public.schedules(
  activity_id,weekday,start_time,end_time,valid_from,valid_until,use_activity_children
 ) values (
  v_activity.id,v_weekday,v.start_time,v.end_time,
  v.proposed_date,v.proposed_date,p_child_id is null
 ) returning id into v_schedule;
 if p_child_id is not null then
  insert into public.schedule_children(schedule_id,child_id)
   values(v_schedule,p_child_id);
 end if;
 update public.household_email_proposals
 set status='approved',reviewed_at=now(),reviewed_by=(select auth.uid()),
  activity_id=v_activity.id,child_id=p_child_id,schedule_id=v_schedule
 where id=v.id;
 return jsonb_build_object('status','approved','schedule_id',v_schedule);
end $$;
revoke all on function public.review_household_email_proposal(uuid,text,uuid,uuid) from public,anon;
grant execute on function public.review_household_email_proposal(uuid,text,uuid,uuid) to authenticated;
