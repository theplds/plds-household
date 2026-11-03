-- Support multiple invited adults joining one pre-provisioned beta household,
-- regardless of registration order. Existing single-user beta invitations unchanged.
alter table public.household_beta_invites
 add column if not exists preassigned_household_id uuid
 references public.households(id) on delete restrict;

create index if not exists household_beta_invites_preassigned_household_idx
 on public.household_beta_invites(preassigned_household_id)
 where preassigned_household_id is not null;

create or replace function public.claim_household_beta_invite(p_name text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
 v_email text;
 v_invite public.household_beta_invites%rowtype;
 v_household uuid;
 v_role text;
begin
 if auth.uid() is null then
  raise exception 'Sign in required' using errcode='42501';
 end if;
 select lower(u.email) into v_email
 from auth.users u
 where u.id=auth.uid() and u.email_confirmed_at is not null;
 if v_email is null then
  raise exception 'Verified email required' using errcode='42501';
 end if;
 select * into v_invite
 from public.household_beta_invites
 where email=v_email and used_by is null
 for update;
 if not found then
  raise exception 'No unused invitation for this email' using errcode='42501';
 end if;
 if exists(select 1 from public.household_members where user_id=auth.uid()) then
  raise exception 'Account already belongs to a household' using errcode='42501';
 end if;

 if v_invite.preassigned_household_id is not null then
  -- Lock the household to serialize concurrent first registrations. Exactly
  -- one registrant becomes owner; subsequent invited registrants are members.
  select h.id into v_household
  from public.households h
  where h.id=v_invite.preassigned_household_id
  for update;
  if not found then
   raise exception 'Invited household is unavailable' using errcode='42501';
  end if;
  v_role:=case when exists(
   select 1 from public.household_members m
   where m.household_id=v_household
  ) then 'member' else 'owner' end;
 else
  -- Backward-compatible independent-household invitation (e.g. Carolina).
  insert into public.households(name) values(v_invite.household_name)
  returning id into v_household;
  v_role:='owner';
 end if;

 insert into public.household_members(household_id,user_id,display_name,role)
 values(v_household,auth.uid(),
 left(coalesce(nullif(trim(p_name),''),split_part(v_email,'@',1)),60),
 v_role);
 update public.household_beta_invites
 set used_by=auth.uid(),used_at=now()
 where id=v_invite.id;
 return v_household;
end $$;

revoke execute on function public.claim_household_beta_invite(text)
 from public,anon;
grant execute on function public.claim_household_beta_invite(text)
 to authenticated;
