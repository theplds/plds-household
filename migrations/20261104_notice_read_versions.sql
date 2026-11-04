alter table public.household_notice_reads add column seen_version timestamptz;
comment on column public.household_notice_reads.seen_version is 'Updated-at version of the content explicitly viewed by this user; distinct from read receipt time.';
