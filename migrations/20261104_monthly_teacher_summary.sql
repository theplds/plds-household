-- Keep the restricted teacher financial summary consistent with fixed-monthly activity fees.
-- The existing SECURITY DEFINER RPC remains restricted to the authenticated teacher's assigned schedules.
create or replace function public.teacher_payment_summary(p_month date)
returns jsonb language sql stable security definer set search_path = ''
as $function$
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
 select al.id,private.activity_price_at(al.id,p_month)
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