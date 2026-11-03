-- Household fixed-monthly activity billing.
-- Existing activities and price history remain per-session by default.
-- Changes to a billing method and changes to monthly prices take effect
-- at the start of the following calendar month (Europe/Athens).
alter table public.activities
  add column billing_period text not null default 'session'
  constraint activities_billing_period_check check (billing_period in ('session','monthly'));

alter table public.activity_price_history
  add column billing_period text not null default 'session'
  constraint activity_price_history_billing_period_check check (billing_period in ('session','monthly'));

create or replace function public.record_activity_price_change()
returns trigger language plpgsql security definer set search_path = ''
as $function$
declare
  local_today date := (now() at time zone 'Europe/Athens')::date;
  following_month date := (date_trunc('month', now() at time zone 'Europe/Athens') + interval '1 month')::date;
  effective date;
begin
  if tg_op = 'INSERT' then
    insert into public.activity_price_history(activity_id,effective_from,price,billing_period)
    values (new.id, date '0001-01-01', new.price, new.billing_period)
    on conflict (activity_id,effective_from) do nothing;
  elsif new.price is distinct from old.price
     or new.billing_period is distinct from old.billing_period then
    -- Avoid mixing session and flat-fee prices within the same month.
    effective := case when new.billing_period = 'monthly'
                         or new.billing_period is distinct from old.billing_period
                      then following_month else local_today end;
    insert into public.activity_price_history(activity_id,effective_from,price,billing_period)
    values (new.id,effective,new.price,new.billing_period)
    on conflict (activity_id,effective_from)
      do update set price=excluded.price,billing_period=excluded.billing_period,recorded_at=now();
    -- If a future billing-mode change is already scheduled, a later
    -- session-price edit must not leave its pending price stale.
    if effective=local_today then
      update public.activity_price_history
      set price=new.price,recorded_at=now()
      where activity_id=new.id and effective_from=following_month;
    end if;
  end if;
  return new;
end $function$;

drop trigger if exists trg_record_activity_price on public.activities;
create trigger trg_record_activity_price
after insert or update of price,billing_period on public.activities
for each row execute function public.record_activity_price_change();

-- All three money paths share effective-dated rates and billing methods:
-- individual sessions, replacement sessions, and one recurring monthly fee.
-- The household-membership filter continues to guard access to the ledger.
create or replace function public.household_ledger(p_through date)
returns jsonb language sql stable set search_path = ''
as $function$
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
    coalesce((select h.price from public.activity_price_history h
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