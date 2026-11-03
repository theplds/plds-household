-- PLDS Household pricing hardening (2026-11-03). Keep immutable historical rate dates.
-- This migration preserves existing audit evidence of previously changed prices.
create table if not exists public.activity_price_history (
 activity_id uuid not null references public.activities(id) on delete cascade,
 effective_from date not null,
 price numeric(12,2) not null check (price >= 0),
 recorded_at timestamptz not null default now(),
 primary key(activity_id,effective_from)
);
alter table public.activity_price_history enable row level security;
revoke all on table public.activity_price_history from public, anon, authenticated;
grant select on table public.activity_price_history to authenticated;
drop policy if exists activity_price_history_household_read on public.activity_price_history;
create policy activity_price_history_household_read
 on public.activity_price_history for select to authenticated
 using (public.is_household_member((select a.household_id from public.activities a where a.id=activity_id)));

-- Baseline the earliest audited rate (when available) instead of assuming today's price.
insert into public.activity_price_history(activity_id,effective_from,price)
select a.id,date '0001-01-01',coalesce((first_event.details->>'price')::numeric,a.price)
from public.activities a
left join lateral (
 select l.details from public.change_log l
 where l.entity_type='activities' and l.entity_id=a.id::text
 and l.details ? 'price' and jsonb_typeof(l.details->'price')='number'
 order by l.changed_at,l.id limit 1
) first_event on true
on conflict(activity_id,effective_from) do nothing;

-- The last audited rate of each Athens calendar day becomes that day's effective price.
insert into public.activity_price_history(activity_id,effective_from,price)
select changes.activity_id,changes.effective_from,changes.price
from (
 select distinct on (a.id,(l.changed_at at time zone 'Europe/Athens')::date)
 a.id as activity_id,(l.changed_at at time zone 'Europe/Athens')::date as effective_from,
 (l.details->>'price')::numeric as price
 from public.activities a
 join public.change_log l on l.entity_type='activities' and l.entity_id=a.id::text
 where l.details ? 'price' and jsonb_typeof(l.details->'price')='number'
 order by a.id,(l.changed_at at time zone 'Europe/Athens')::date,l.changed_at desc,l.id desc
) changes
on conflict(activity_id,effective_from) do update set price=excluded.price;

-- Ensure the current editable price is represented even if no audit entry survives.
insert into public.activity_price_history(activity_id,effective_from,price)
select a.id,(now() at time zone 'Europe/Athens')::date,a.price from public.activities a
on conflict(activity_id,effective_from) do update set price=excluded.price;

create or replace function public.record_activity_price_change()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
 if TG_OP='INSERT' then
  insert into public.activity_price_history(activity_id,effective_from,price)
  values (new.id,date '0001-01-01',new.price)
  on conflict(activity_id,effective_from) do nothing;
 elsif new.price is distinct from old.price then
  insert into public.activity_price_history(activity_id,effective_from,price)
  values (new.id,(now() at time zone 'Europe/Athens')::date,new.price)
  on conflict(activity_id,effective_from)
  do update set price=excluded.price,recorded_at=now();
 end if;
 return new;
end $$;
revoke execute on function public.record_activity_price_change() from public,anon,authenticated;
drop trigger if exists trg_record_activity_price on public.activities;
create trigger trg_record_activity_price
 after insert or update of price on public.activities
 for each row execute function public.record_activity_price_change();

-- Internal helper: not exposed over the Data API. The first audited rate covers
-- sessions preceding the first recorded effective date.
create schema if not exists private;
revoke all on schema private from public,anon,authenticated;
create or replace function private.activity_price_at(p_activity_id uuid,p_on date)
returns numeric language sql stable security invoker set search_path=''
as $$
 select coalesce(
 (select h.price from public.activity_price_history h
  where h.activity_id=p_activity_id and h.effective_from<=p_on
  order by h.effective_from desc limit 1),
 (select h.price from public.activity_price_history h
  where h.activity_id=p_activity_id order by h.effective_from limit 1),
 (select a.price from public.activities a where a.id=p_activity_id)
 )
$$;
revoke execute on function private.activity_price_at(uuid,date) from public,anon,authenticated;

-- Teachers see charges from their assigned lessons, priced on the ORIGINAL
-- session date even if the replacement falls in a different month.
create or replace function public.teacher_payment_summary(p_month date)
returns jsonb language sql stable security definer set search_path=''
as $$
with allowed as (
 select distinct a.id,a.name from public.teacher_assignments ta
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
 group by al.id
 union all
 select al.id,sum(coalesce(o.amount_override,private.activity_price_at(al.id,o.session_date)))
 from allowed al
 join public.schedules s on s.activity_id=al.id
 join public.teacher_assignments ta on ta.schedule_id=s.id and ta.teacher_id=auth.uid()
 join public.session_overrides o on o.schedule_id=s.id
 where o.status='rescheduled' and o.new_date>=p_month
 and o.new_date<(p_month+interval '1 month')::date
 group by al.id
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
$$;
