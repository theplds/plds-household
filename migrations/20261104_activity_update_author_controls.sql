-- An activity announcement can be revised or deleted only by its author.
-- Other household members retain read-only access.
alter policy activity_updates_update on public.activity_updates
 using (created_by=(select auth.uid()) and public.is_household_member(household_id)
  and exists(select 1 from public.activities a where a.id=activity_id and a.household_id=activity_updates.household_id))
 with check (created_by=(select auth.uid()) and public.is_household_member(household_id)
  and exists(select 1 from public.activities a where a.id=activity_id and a.household_id=activity_updates.household_id));
alter policy activity_updates_delete on public.activity_updates
 using (created_by=(select auth.uid()) and public.is_household_member(household_id)
  and exists(select 1 from public.activities a where a.id=activity_id and a.household_id=activity_updates.household_id));
