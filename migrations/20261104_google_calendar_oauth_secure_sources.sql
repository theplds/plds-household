-- Direct Google Calendar OAuth sources; feed connections remain unchanged.
alter table public.calendar_sync_sources
  add column if not exists connection_kind text not null default 'feed'
    check (connection_kind in ('feed','google_oauth')),
  add column if not exists google_calendar_id text;
create unique index if not exists calendar_unique_google_in_household
  on public.calendar_sync_sources(household_id,google_calendar_id)
  where connection_kind='google_oauth';
create table if not exists private.google_calendar_credentials (
  source_id uuid primary key references public.calendar_sync_sources(id) on delete cascade,
  vault_secret_id uuid not null
);
revoke all on private.google_calendar_credentials from public,anon,authenticated;
create or replace function private.cleanup_google_calendar_secret()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  delete from vault.secrets where id=old.vault_secret_id;
  return old;
end $$;
drop trigger if exists google_calendar_credential_cleanup on private.google_calendar_credentials;
create trigger google_calendar_credential_cleanup
  before delete on private.google_calendar_credentials
  for each row execute function private.cleanup_google_calendar_secret();

create or replace function public.save_google_calendar_refresh(p_source_id uuid,p_token text)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_secret uuid;
begin
  if current_setting('request.jwt.claim.role',true) is distinct from 'service_role' then
    raise exception 'Server authorization required' using errcode='42501';
  end if;
  if p_token is null or length(p_token) not between 20 and 2048 then
    raise exception 'Invalid Google refresh token' using errcode='22023';
  end if;
  if not exists(select 1 from public.calendar_sync_sources
    where id=p_source_id and provider='google' and connection_kind='google_oauth') then
    raise exception 'Unknown Google Calendar connection' using errcode='22023';
  end if;
  select vault_secret_id into v_secret from private.google_calendar_credentials where source_id=p_source_id;
  if v_secret is null then
    v_secret:=vault.create_secret(p_token,'household-google-calendar-'||p_source_id::text,
      'Google Calendar read-only OAuth refresh credential');
    insert into private.google_calendar_credentials(source_id,vault_secret_id)
      values(p_source_id,v_secret);
  else
    perform vault.update_secret(v_secret,p_token);
  end if;
  return true;
end $$;
revoke all on function public.save_google_calendar_refresh(uuid,text) from public,anon,authenticated;
grant execute on function public.save_google_calendar_refresh(uuid,text) to service_role;

create or replace function public.read_google_calendar_refresh(p_source_id uuid)
returns text language plpgsql security definer set search_path='' as $$
declare v_token text;
begin
  if current_setting('request.jwt.claim.role',true) is distinct from 'service_role' then
    raise exception 'Server authorization required' using errcode='42501';
  end if;
  select v.decrypted_secret into v_token
  from private.google_calendar_credentials c
  join vault.decrypted_secrets v on v.id=c.vault_secret_id
  where c.source_id=p_source_id;
  return v_token;
end $$;
revoke all on function public.read_google_calendar_refresh(uuid) from public,anon,authenticated;
grant execute on function public.read_google_calendar_refresh(uuid) to service_role;
