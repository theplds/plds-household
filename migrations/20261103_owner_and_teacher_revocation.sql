-- Households: only owner may rename shared household or finalize setup.
create or replace function public.update_my_household_setup(p_household_name text,p_complete boolean default false)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_household_id uuid;v_memberships integer;v_name text;v_saved public.households%rowtype;
begin
 if auth.uid() is null then raise exception 'Sign in required' using errcode='42501'; end if;
 select count(*),(array_agg(household_id))[1] into v_memberships,v_household_id
 from public.household_members where user_id=auth.uid() and role='owner';
 if v_memberships<>1 then raise exception 'Household owner required' using errcode='42501'; end if;
 v_name:=trim(coalesce(p_household_name,''));
 if length(v_name)<2 or length(v_name)>80 then raise exception 'Household name must be 2–80 characters'; end if;
 update public.households set name=v_name,
 onboarding_completed_at=case when coalesce(p_complete,false) then coalesce(onboarding_completed_at,now()) else onboarding_completed_at end
 where id=v_household_id returning * into v_saved;
 if not found then raise exception 'Household missing'; end if;
 return jsonb_build_object('id',v_saved.id,'name',v_saved.name,'onboarding_completed_at',v_saved.onboarding_completed_at);
end $$;

-- A teacher who has been removed must not approve a previously pending proposal.
create or replace function public.teacher_respond_reschedule(p_request_id uuid,p_decision text)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare r public.lesson_reschedule_requests%rowtype;
begin
 select * into r from public.lesson_reschedule_requests where id=p_request_id for update;
 if not found or r.status<>'pending_teacher' or r.teacher_id<>auth.uid()
 or not exists(select 1 from public.teacher_assignments ta where ta.teacher_id=auth.uid() and ta.schedule_id=r.schedule_id)
 then raise exception 'Not an assigned pending request' using errcode='42501'; end if;
 if p_decision='approve' then
  insert into public.session_overrides(schedule_id,session_date,status,new_date,new_time,updated_by)
  values(r.schedule_id,r.session_date,'rescheduled',r.proposed_date,r.proposed_time,auth.uid())
  on conflict(schedule_id,session_date)
  do update set status='rescheduled',new_date=excluded.new_date,new_time=excluded.new_time,updated_by=auth.uid(),updated_at=now();
  update public.lesson_reschedule_requests set status='approved',resolved_by=auth.uid(),updated_at=now() where id=r.id;
 elsif p_decision='deny' then
  update public.lesson_reschedule_requests set status='denied',resolved_by=auth.uid(),updated_at=now() where id=r.id;
 else raise exception 'Invalid decision'; end if;
 return jsonb_build_object('ok',true);
end $$;