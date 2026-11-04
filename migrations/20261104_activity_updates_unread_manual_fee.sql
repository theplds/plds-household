-- v0.3.134: activity updates, per-member read state, optional fixed-month fee overrides.
create table public.activity_updates (
 id uuid primary key default gen_random_uuid(),
 activity_id uuid not null references public.activities(id) on delete cascade,
 household_id uuid not null references public.households(id) on delete cascade,
 title text not null check (length(btrim(title)) between 1 and 120),
 details text not null default '' check (length(details)<=4000),
 session_date date,
 practice_time text not null default '' check (length(practice_time)<=120),
 location text not null default '' check (length(location)<=250),
 source text not null default 'manual' check (source in ('manual','copied_email')),
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index activity_updates_household_date_idx on public.activity_updates (household_id,created_at desc);
create index activity_updates_activity_date_idx on public.activity_updates (activity_id,session_date);
alter table public.activity_updates enable row level security;
revoke all on public.activity_updates from anon;
grant select,insert,update,delete on public.activity_updates to authenticated;
create policy activity_updates_read on public.activity_updates for select to authenticated
 using (public.is_household_member(household_id) and exists(
 select 1 from public.activities a where a.id=activity_id and a.household_id=activity_updates.household_id));
create policy activity_updates_insert on public.activity_updates for insert to authenticated
 with check (created_by=(select auth.uid()) and public.is_household_member(household_id) and exists(
 select 1 from public.activities a where a.id=activity_id and a.household_id=activity_updates.household_id));
create policy activity_updates_update on public.activity_updates for update to authenticated
 using (public.is_household_member(household_id) and exists(
 select 1 from public.activities a where a.id=activity_id and a.household_id=activity_updates.household_id))
 with check (created_by=(select auth.uid()) and public.is_household_member(household_id) and exists(
 select 1 from public.activities a where a.id=activity_id and a.household_id=activity_updates.household_id));
create policy activity_updates_delete on public.activity_updates for delete to authenticated
 using (public.is_household_member(household_id) and exists(
 select 1 from public.activities a where a.id=activity_id and a.household_id=activity_updates.household_id));

create table public.household_notice_reads (
 user_id uuid not null references auth.users(id) on delete cascade,
 household_id uuid not null references public.households(id) on delete cascade,
 notice_key text not null check (length(notice_key) between 1 and 180),
 seen_at timestamptz not null default now(),
 primary key (user_id,household_id,notice_key)
);
create index household_notice_reads_household_idx on public.household_notice_reads(household_id);
alter table public.household_notice_reads enable row level security;
revoke all on public.household_notice_reads from anon;
grant select,insert,update,delete on public.household_notice_reads to authenticated;
create policy notice_reads_select on public.household_notice_reads for select to authenticated
 using (user_id=(select auth.uid()) and public.is_household_member(household_id));
create policy notice_reads_insert on public.household_notice_reads for insert to authenticated
 with check (user_id=(select auth.uid()) and public.is_household_member(household_id));
create policy notice_reads_update on public.household_notice_reads for update to authenticated
 using (user_id=(select auth.uid()) and public.is_household_member(household_id))
 with check (user_id=(select auth.uid()) and public.is_household_member(household_id));
create policy notice_reads_delete on public.household_notice_reads for delete to authenticated
 using (user_id=(select auth.uid()) and public.is_household_member(household_id));

create table public.monthly_activity_adjustments (
 activity_id uuid not null references public.activities(id) on delete cascade,
 billing_month date not null check(extract(day from billing_month)=1),
 amount numeric(12,2) not null check(amount>=0),
 reason text not null default '' check(length(reason)<=500),
 updated_by uuid not null references auth.users(id),
 updated_at timestamptz not null default now(),
 primary key (activity_id,billing_month)
);
alter table public.monthly_activity_adjustments enable row level security;
revoke all on public.monthly_activity_adjustments from anon;
grant select,insert,update,delete on public.monthly_activity_adjustments to authenticated;
create policy monthly_adj_read on public.monthly_activity_adjustments for select to authenticated
 using (exists(select 1 from public.activities a where a.id=activity_id and public.is_household_member(a.household_id)));
create policy monthly_adj_insert on public.monthly_activity_adjustments for insert to authenticated
 with check(updated_by=(select auth.uid()) and exists(select 1 from public.activities a where a.id=activity_id
 and public.is_household_member(a.household_id)));
create policy monthly_adj_update on public.monthly_activity_adjustments for update to authenticated
 using (exists(select 1 from public.activities a where a.id=activity_id and public.is_household_member(a.household_id)))
 with check(updated_by=(select auth.uid()) and exists(select 1 from public.activities a where a.id=activity_id
 and public.is_household_member(a.household_id)));
create policy monthly_adj_delete on public.monthly_activity_adjustments for delete to authenticated
 using (exists(select 1 from public.activities a where a.id=activity_id and public.is_household_member(a.household_id)));

create or replace function public.set_activity_update_timestamp()
returns trigger language plpgsql set search_path='' as $function$
begin new.updated_at=now();return new;end $function$;
create trigger trg_activity_updates_time before update on public.activity_updates
for each row execute function public.set_activity_update_timestamp();

CREATE OR REPLACE FUNCTION public.household_ledger(p_through date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
with allowed as (
  select a.id,a.price,a.created_at
  from public.activities a
  where public.is_household_member(a.household_id)
),
months as (
  select generate_series(date '2020-01-01',p_through,interval '1 month')::date as m
  where p_through between date '2020-01-01' and date '2100-12-01'
),
session_charges as (
  select a.id,d.m,
    sum(case when o.status in ('rescheduled','cancelled_free') then 0
             else coalesce(o.amount_override,
                 (select h.price from public.activity_price_history h
                  where h.activity_id=a.id and h.effective_from<=x.day::date
                  order by h.effective_from desc limit 1),
                 a.price) end) as amount
  from allowed a
  join public.schedules s on s.activity_id=a.id
  cross join months d
  cross join lateral generate_series(d.m,d.m+interval '1 month'-interval '1 day',interval '1 day') x(day)
  left join public.session_overrides o on o.schedule_id=s.id and o.session_date=x.day::date
  where extract(dow from x.day)=s.weekday
    and x.day::date>=s.valid_from
    and (s.valid_until is null or x.day::date<=s.valid_until)
    and coalesce(
      (select h.billing_period from public.activity_price_history h
       where h.activity_id=a.id and h.effective_from<=d.m
       order by h.effective_from desc limit 1),'session')='session'
  group by a.id,d.m
),
replacement_charges as (
  select a.id,date_trunc('month',o.new_date)::date as m,
    sum(coalesce(o.amount_override,
      (select h.price from public.activity_price_history h
       where h.activity_id=a.id and h.effective_from<=o.session_date
       order by h.effective_from desc limit 1),a.price)) as amount
  from allowed a
  join public.schedules s on s.activity_id=a.id
  join public.session_overrides o on o.schedule_id=s.id
  where o.status='rescheduled'
    and o.new_date between date '2020-01-01' and
       (p_through+interval '1 month'-interval '1 day')::date
    and coalesce(
      (select h.billing_period from public.activity_price_history h
       where h.activity_id=a.id
         and h.effective_from<=date_trunc('month',o.session_date)::date
       order by h.effective_from desc limit 1),'session')='session'
  group by a.id,date_trunc('month',o.new_date)::date
),
monthly_charges as (
  select a.id,d.m,
    coalesce((select mo.amount from public.monthly_activity_adjustments mo
               where mo.activity_id=a.id and mo.billing_month=d.m),
             (select h.price from public.activity_price_history h
              where h.activity_id=a.id and h.effective_from<=d.m
              order by h.effective_from desc limit 1),a.price) as amount
  from allowed a cross join months d
  where d.m>=date_trunc('month',a.created_at at time zone 'Europe/Athens')::date
    and coalesce(
      (select h.billing_period from public.activity_price_history h
       where h.activity_id=a.id and h.effective_from<=d.m
       order by h.effective_from desc limit 1),'session')='monthly'
),
charges as (
  select id,m,amount from session_charges
  union all select id,m,amount from replacement_charges
  union all select id,m,amount from monthly_charges
),
payments as (
  select p.activity_id,pa.billing_month,sum(pa.amount) amount
  from public.payments p
  join public.payment_allocations pa on pa.payment_id=p.id
  join allowed a on a.id=p.activity_id
  where pa.billing_month<=p_through
  group by p.activity_id,pa.billing_month
)
select coalesce(jsonb_agg(jsonb_build_object(
  'activity_id',a.id,
  'charged',coalesce((select sum(c.amount) from charges c where c.id=a.id),0),
  'paid',coalesce((select sum(p.amount) from payments p where p.activity_id=a.id),0)
) order by a.id),'[]'::jsonb)
from allowed a
$function$;

CREATE OR REPLACE FUNCTION public.teacher_payment_summary(p_month date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
with allowed as (
 select distinct a.id,a.name,a.created_at
 from public.teacher_assignments ta
 join public.schedules s on s.id=ta.schedule_id
 join public.activities a on a.id=s.activity_id
 where ta.teacher_id=auth.uid()
),
charges as (
 select al.id,
  coalesce(sum(case
    when o.status in ('rescheduled','cancelled_free') then 0
    else coalesce(o.amount_override,private.activity_price_at(al.id,d.day::date))
  end),0) amount
 from allowed al
 join public.schedules s on s.activity_id=al.id
 join public.teacher_assignments ta on ta.schedule_id=s.id and ta.teacher_id=auth.uid()
 cross join lateral generate_series(p_month,p_month+interval '1 month'-interval '1 day',interval '1 day') d(day)
 left join public.session_overrides o on o.schedule_id=s.id and o.session_date=d.day::date
 where extract(dow from d.day)=s.weekday
  and d.day::date>=s.valid_from
  and (s.valid_until is null or d.day::date<=s.valid_until)
  and coalesce((select h.billing_period from public.activity_price_history h
    where h.activity_id=al.id and h.effective_from<=p_month
    order by h.effective_from desc limit 1),'session')='session'
 group by al.id
 union all
 select al.id,sum(coalesce(o.amount_override,private.activity_price_at(al.id,o.session_date)))
 from allowed al
 join public.schedules s on s.activity_id=al.id
 join public.teacher_assignments ta on ta.schedule_id=s.id and ta.teacher_id=auth.uid()
 join public.session_overrides o on o.schedule_id=s.id
 where o.status='rescheduled' and o.new_date>=p_month
  and o.new_date<(p_month+interval '1 month')::date
  and coalesce((select h.billing_period from public.activity_price_history h
    where h.activity_id=al.id
      and h.effective_from<=date_trunc('month',o.session_date)::date
    order by h.effective_from desc limit 1),'session')='session'
 group by al.id
 union all
 select al.id,coalesce(
    (select mo.amount from public.monthly_activity_adjustments mo
     where mo.activity_id=al.id and mo.billing_month=p_month),
    private.activity_price_at(al.id,p_month))
 from allowed al
 where p_month>=date_trunc('month',al.created_at at time zone 'Europe/Athens')::date
  and coalesce((select h.billing_period from public.activity_price_history h
    where h.activity_id=al.id and h.effective_from<=p_month
    order by h.effective_from desc limit 1),'session')='monthly'
),
pay as (
 select p.activity_id,sum(pa.amount) amount
 from public.payments p
 join public.payment_allocations pa on pa.payment_id=p.id
 join allowed al on al.id=p.activity_id
 where pa.billing_month=p_month group by p.activity_id
)
select coalesce(jsonb_agg(jsonb_build_object(
 'activity',al.name,
 'charged',coalesce((select sum(amount) from charges c where c.id=al.id),0),
 'paid',coalesce(pay.amount,0),
 'payments',coalesce(
  (select jsonb_agg(jsonb_build_object('date',p.paid_on,'amount',pa.amount) order by p.paid_on)
  from public.payments p join public.payment_allocations pa on pa.payment_id=p.id
  where p.activity_id=al.id and pa.billing_month=p_month),
  '[]'::jsonb))), '[]'::jsonb)
from allowed al left join pay on pay.activity_id=al.id
where auth.uid() is not null and p_month=date_trunc('month',p_month)::date
$function$;

