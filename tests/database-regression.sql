-- Run in Supabase SQL Editor as database owner. All synthetic changes ROLLBACK.
-- Test 1: prices must be effective-dated.
begin;
do $t$
declare h uuid;a uuid;today_athens date:=(now() at time zone 'Europe/Athens')::date;
begin
 insert into public.households(name) values('PLDS temporary pricing QA') returning id into h;
 insert into public.activities(household_id,name,price) values(h,'QA',20) returning id into a;
 if private.activity_price_at(a,today_athens-1)<>20 then raise exception 'Baseline regression'; end if;
 update public.activities set price=25 where id=a;
 if private.activity_price_at(a,today_athens-1)<>20 then raise exception 'Historical price changed'; end if;
 if private.activity_price_at(a,today_athens)<>25 then raise exception 'New price not effective'; end if;
end $t$;
rollback;

-- Test 2: simulate household isolation using a real teacher and parent identity, but no tokens.
begin;
do $t$
declare h uuid;t uuid;owner_id uuid;a uuid;
begin
 select ta.teacher_id into t from public.teacher_assignments ta
 where not exists(select 1 from public.household_members m where m.user_id=ta.teacher_id) limit 1;
 select m.user_id into owner_id from public.household_members m where m.role='owner' limit 1;
 if t is null or owner_id is null then raise exception 'Independent test principals required'; end if;
 insert into public.households(name) values('PLDS temporary isolation QA') returning id into h;
 insert into public.household_members(household_id,user_id,display_name,role) values(h,t,'QA','owner');
 insert into public.activities(household_id,name,price) values(h,'QA',10) returning id into a;
 perform set_config('qa.house',h::text,true);
 perform set_config('qa.teacher',t::text,true);
 perform set_config('qa.owner',owner_id::text,true);
end $t$;
set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('qa.teacher'),true);
do $t$
declare seen integer;changed integer;
begin
 select count(*) into seen from public.activities;
 if seen<>1 then raise exception 'Foreign household SELECT exposure'; end if;
 update public.activities set price=99 where household_id<>current_setting('qa.house')::uuid;
 get diagnostics changed=row_count;
 if changed<>0 then raise exception 'Foreign household UPDATE exposure'; end if;
 if has_column_privilege('authenticated','public.household_members','role','UPDATE')
 then raise exception 'Role escalation privilege'; end if;
end $t$;
select set_config('request.jwt.claim.sub',current_setting('qa.owner'),true);
do $t$
begin
 if exists(select 1 from public.activities where household_id=current_setting('qa.house')::uuid)
 then raise exception 'Parent saw foreign household'; end if;
end $t$;
reset role;
rollback;

-- Test 3: a removed teacher must not accept a pending lesson reschedule.
begin;
do $t$
declare t uuid;s uuid;dow int;d date;request_id uuid;
begin
 select ta.teacher_id,ta.schedule_id,sc.weekday into t,s,dow
 from public.teacher_assignments ta join public.schedules sc on sc.id=ta.schedule_id limit 1;
 if t is null then raise exception 'Teacher assignment required'; end if;
 d:=date '2026-11-02'+((dow-extract(dow from date '2026-11-02')::int+7)%7);
 insert into public.lesson_reschedule_requests
 (schedule_id,session_date,teacher_id,proposed_date,proposed_time,status,proposed_by)
 values(s,d,t,d+7,time '14:00','pending_teacher','parent')
 returning id into request_id;
 perform set_config('qa.teacher',t::text,true);
 perform set_config('qa.request',request_id::text,true);
 delete from public.teacher_assignments where teacher_id=t and schedule_id=s;
end $t$;
set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('qa.teacher'),true);
do $t$
begin
 begin
  perform public.teacher_respond_reschedule(current_setting('qa.request')::uuid,'approve');
  raise exception 'Revoked teacher authorization regression';
 exception when insufficient_privilege then null;
 end;
end $t$;
reset role;
rollback;
