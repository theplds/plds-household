-- Dedicated, repeatable QA onboarding household.
-- Never permit a regular household or shared household to be reset.
create table if not exists private.qa_households (
 household_id uuid primary key references public.households(id) on delete cascade,
 created_at timestamptz not null default now(),
 purpose text not null default 'replay_first_use'
);
revoke all on private.qa_households from public, anon, authenticated;

create or replace function public.my_qa_household_status()
returns boolean language sql stable security definer set search_path = ''
as $fn$
 select (select auth.uid()) is not null and exists(
  select 1 from private.qa_households q
  join public.household_members m on m.household_id=q.household_id
  where m.user_id=(select auth.uid()) and m.role='owner'
 );
$fn$;
revoke all on function public.my_qa_household_status() from public, anon;
grant execute on function public.my_qa_household_status() to authenticated;

create or replace function public.reset_my_qa_household(p_confirmation text)
returns jsonb language plpgsql security definer set search_path = ''
as $fn$
declare
 v_household uuid;
 v_actor uuid := (select auth.uid());
begin
 if v_actor is null then
  raise exception 'Sign in is required' using errcode='42501';
 end if;
 if p_confirmation is distinct from 'RESET QA' then
  raise exception 'Type RESET QA to confirm the reset' using errcode='22023';
 end if;

 -- QA membership is provisioned by administrator, not user-editable UI metadata.
 select q.household_id into v_household
 from private.qa_households q
 join public.household_members m on m.household_id=q.household_id
 where m.user_id=v_actor and m.role='owner'
 for update of q;
 if v_household is null then
  raise exception 'This is not a resettable QA household' using errcode='42501';
 end if;

 -- The test account must not also have access to any real households, and
 -- the test household cannot have been shared with another family member.
 if (select count(*) from public.household_members where user_id=v_actor)<>1
    or (select count(*) from public.household_members where household_id=v_household)<>1 then
  raise exception 'QA reset refused: the account or household has other memberships' using errcode='42501';
 end if;

 -- A single transaction rolls back if anything fails. Cascading FKs remove
 -- session overrides, teachers' schedule assignments, bills/payments,
 -- historical rates, and homework metadata as part of activity deletion.
 delete from public.push_subscriptions where household_id=v_household;
 delete from public.household_member_invites where household_id=v_household;
 delete from public.household_notice_reads where household_id=v_household;
 delete from public.calendar_import_events where household_id=v_household;
 delete from public.activities where household_id=v_household;
 delete from public.children where household_id=v_household;
 delete from public.change_log where household_id=v_household;

 -- Don't touch account credentials or user-wide preferences.
 update public.households set
  name='Household QA Playground',
  onboarding_completed_at=null
 where id=v_household;

 return jsonb_build_object('reset',true,'household_id',v_household);
end
$fn$;
revoke all on function public.reset_my_qa_household(text) from public, anon;
grant execute on function public.reset_my_qa_household(text) to authenticated;
