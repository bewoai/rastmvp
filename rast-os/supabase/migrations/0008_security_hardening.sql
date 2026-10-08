-- =====================================================================
-- Rast OS — Migration 0008: Security hardening
--
-- 1) profiles: a user may only update their OWN row and may never change
--    their own `role`, `organization_id`, `id` or `created_at`.
-- 2) Sign-up no longer auto-attaches every new auth user to the first
--    organization. Organization membership is granted only through an
--    explicit invite (public.organization_invites) created by an org admin.
--
-- Idempotent: safe to run more than once.
-- NOTE: NOT applied to any environment yet — see README-0008.md.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) profiles: self-update only, without privilege-bearing columns
-- ---------------------------------------------------------------------
-- 0001 created `profiles_update_self` with only a USING clause, so the new
-- row was never checked and any signed-in user could run
--   update profiles set role = 'admin', organization_id = '<any org>'
-- on their own row and escalate into another tenant. RLS policies cannot
-- compare OLD vs NEW values, so the column restriction is enforced with
-- column-level privileges instead: `authenticated` keeps UPDATE only on the
-- harmless profile columns. role / organization_id are changed exclusively
-- by SECURITY DEFINER code (handle_new_user below) or by the service role /
-- SQL editor.

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles for update
  using (id = auth.uid())
  with check (id = auth.uid());

revoke update on public.profiles from authenticated;
revoke update on public.profiles from anon;
grant update (full_name, avatar_url, phone, is_active)
  on public.profiles to authenticated;

-- ---------------------------------------------------------------------
-- 2) Invite-based organization membership
-- ---------------------------------------------------------------------
-- `role` uses the existing user_role enum (admin, manager, editor,
-- accountant, client) so an invite can never carry an invalid role.
create table if not exists public.organization_invites (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email           text not null,
  role            user_role not null default 'editor',
  invited_by      uuid default auth.uid() references public.profiles(id) on delete set null,
  accepted_at     timestamptz,
  created_at      timestamptz not null default now(),
  unique (organization_id, email)
);

-- Store emails normalised so matching against auth.users.email is exact.
alter table public.organization_invites
  drop constraint if exists organization_invites_email_lower_check;
alter table public.organization_invites
  add constraint organization_invites_email_lower_check
  check (email = lower(btrim(email)) and email <> '');

create index if not exists idx_org_invites_email_pending
  on public.organization_invites (email) where accepted_at is null;

alter table public.organization_invites enable row level security;

-- Only admins of an organization manage that organization's invites.
-- (There is no 'owner' role in user_role; 'admin' is the highest role.)
drop policy if exists org_invites_admin_select on public.organization_invites;
create policy org_invites_admin_select on public.organization_invites for select
  to authenticated
  using (organization_id = public.current_org_id() and public.current_role_name() = 'admin');

drop policy if exists org_invites_admin_insert on public.organization_invites;
create policy org_invites_admin_insert on public.organization_invites for insert
  to authenticated
  with check (
    organization_id = public.current_org_id()
    and public.current_role_name() = 'admin'
    and (invited_by is null or invited_by = auth.uid())
    and accepted_at is null
  );

drop policy if exists org_invites_admin_delete on public.organization_invites;
create policy org_invites_admin_delete on public.organization_invites for delete
  to authenticated
  using (organization_id = public.current_org_id() and public.current_role_name() = 'admin');

-- No UPDATE policy: invites are immutable for clients (delete + re-create).
-- accepted_at is set only by the SECURITY DEFINER trigger below.
revoke all on public.organization_invites from anon;
revoke update on public.organization_invites from authenticated;

-- ---------------------------------------------------------------------
-- New-user trigger (replaces 0001 + 0007 versions)
-- ---------------------------------------------------------------------
-- * Always creates the profile with organization_id = NULL, role 'editor'.
-- * If a pending invite matches the user's (lower-cased) email AND that email
--   is confirmed, the profile gets the invite's organization/role and the
--   invite is marked accepted. Requiring a confirmed email stops someone from
--   signing up with an invited address they do not own.
-- * If the email is confirmed later, the UPDATE trigger runs the same logic.
-- * A profile that already has an organization is never moved.
-- Users with organization_id NULL see nothing: every org policy compares
-- `organization_id = current_org_id()`, which is NULL -> not true.
-- This is a trigger function (returns trigger), so it is not callable via RPC.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  inv public.organization_invites%rowtype;
begin
  insert into public.profiles (id, organization_id, full_name, role)
  values (
    new.id,
    null,
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    'editor'
  )
  on conflict (id) do nothing;

  if new.email is null or new.email_confirmed_at is null then
    return new;
  end if;

  select * into inv
  from public.organization_invites
  where email = lower(btrim(new.email))
    and accepted_at is null
  order by created_at, id
  limit 1
  for update;

  if found then
    update public.profiles
    set organization_id = inv.organization_id,
        role = inv.role
    where id = new.id
      and organization_id is null;

    if found then
      update public.organization_invites
      set accepted_at = now()
      where id = inv.id;
    end if;
  end if;

  return new;
end $$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

drop trigger if exists on_auth_user_email_confirmed on auth.users;
create trigger on_auth_user_email_confirmed
  after update of email_confirmed_at on auth.users
  for each row
  when (old.email_confirmed_at is null and new.email_confirmed_at is not null)
  execute function public.handle_new_user();

-- If the invited person already has a confirmed account without an
-- organization (e.g. signed up before being invited), attach them as soon as
-- the invite is created.
create or replace function public.apply_invite_to_existing_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  target uuid;
begin
  select u.id into target
  from auth.users u
  join public.profiles p on p.id = u.id
  where lower(btrim(u.email)) = new.email
    and u.email_confirmed_at is not null
    and p.organization_id is null
  limit 1;

  if target is not null then
    update public.profiles
    set organization_id = new.organization_id,
        role = new.role
    where id = target
      and organization_id is null;

    if found then
      update public.organization_invites
      set accepted_at = now()
      where id = new.id;
    end if;
  end if;

  return new;
end $$;

revoke execute on function public.apply_invite_to_existing_user() from public, anon, authenticated;

drop trigger if exists on_org_invite_created on public.organization_invites;
create trigger on_org_invite_created
  after insert on public.organization_invites
  for each row execute function public.apply_invite_to_existing_user();

-- Existing data is intentionally left untouched: profiles already attached
-- to an organization (including those backfilled by 0007) keep their
-- membership. Review them manually (see README-0008.md).
