-- Existing auth users can predate the profile trigger or have no organization.
-- Without an organization_id, RLS correctly rejects every CRM/finance insert.

insert into public.organizations (name)
select 'Rast Creative'
where not exists (select 1 from public.organizations);

do $$
declare
  default_org uuid;
begin
  select id into default_org
  from public.organizations
  order by created_at, id
  limit 1;

  if default_org is null then
    raise exception 'Rast Creative organization could not be created';
  end if;

  -- Users created before the profile trigger need to be attached manually.
  update public.profiles
  set organization_id = default_org
  where organization_id is null;

  -- Create missing profiles for users that already exist in Auth.
  insert into public.profiles as profile (id, organization_id, full_name, role)
  select
    u.id,
    default_org,
    coalesce(u.raw_user_meta_data->>'full_name', u.email),
    'editor'::user_role
  from auth.users u
  left join public.profiles p on p.id = u.id
  where p.id is null
  on conflict (id) do nothing;
end $$;

-- Keep future users attached to the same default organization and repair an
-- existing profile if it was created without an organization.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  default_org uuid;
begin
  select id into default_org
  from public.organizations
  order by created_at, id
  limit 1;

  insert into public.profiles as profile (id, organization_id, full_name, role)
  values (
    new.id,
    default_org,
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    'editor'
  )
  on conflict (id) do update
    set organization_id = coalesce(profile.organization_id, excluded.organization_id);

  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
