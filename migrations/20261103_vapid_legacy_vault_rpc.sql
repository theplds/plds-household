-- Keep VAPID legacy signing material encrypted in Supabase Vault.
-- This endpoint is not exposed to anon/authenticated roles and returns no secret to browsers.
create or replace function public.get_legacy_push_signing_key()
returns text language sql stable security definer set search_path=''
as $$
 select v.decrypted_secret
 from vault.decrypted_secrets v
 where v.name='plds_push_vapid_legacy_v1'
 limit 1
$$;
revoke execute on function public.get_legacy_push_signing_key() from public,anon,authenticated;
grant execute on function public.get_legacy_push_signing_key() to service_role;