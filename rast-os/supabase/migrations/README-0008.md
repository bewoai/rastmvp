# Migration 0008 — Security hardening

> **Status: NOT applied anywhere.** This migration has not been run against
> local, staging or production databases. It was written and reviewed only.
> No Postgres instance was available to execute it, so run it on a staging /
> branch database first.

## What changes

1. **`profiles` privilege escalation fix**
   - `profiles_update_self` now has both `USING (id = auth.uid())` and
     `WITH CHECK (id = auth.uid())`.
   - Table-level `UPDATE` on `public.profiles` is revoked from `authenticated`
     (and `anon`). `authenticated` gets column-level `UPDATE` only on
     `full_name, avatar_url, phone, is_active`.
   - Result: a signed-in user can no longer run
     `update profiles set role = 'admin'` or move themselves into another
     organization (`organization_id`). Those columns are only writable by
     SECURITY DEFINER code, the service role or the SQL editor.
   - Note: `is_active` is still self-writable (as specified). The app does not
     currently enforce `is_active` anywhere; if it ever does, remove it from
     the grant.

2. **No more auto-join to the first organization**
   - 0001/0007 `handle_new_user()` attached *every* new auth user to the oldest
     organization, so anyone who could sign up got full access to Rast
     Creative data. This is replaced.
   - New table `public.organization_invites` (`organization_id`, `email`
     (lower-case, enforced by CHECK), `role` (`user_role` enum, default
     `editor`), `invited_by`, `accepted_at`, `created_at`,
     `unique(organization_id, email)`).
   - RLS: only users whose profile role is `admin` (there is no `owner` role)
     can `select` / `insert` / `delete` invites of **their own** organization.
     No client `update`.
   - New `handle_new_user()`:
     - always creates the profile with `organization_id = NULL`, role `editor`;
     - if the user's email is **confirmed** and a pending invite matches
       `lower(email)`, sets `organization_id`/`role` from the invite and marks
       it `accepted_at = now()`;
     - also runs when `auth.users.email_confirmed_at` goes from NULL to a
       value (trigger `on_auth_user_email_confirmed`), so email-confirmation
       sign-ups work;
     - never moves a profile that already has an organization.
   - New trigger `on_org_invite_created`: inviting an email that already has a
     confirmed account with `organization_id IS NULL` attaches it immediately.
   - Users with `organization_id = NULL` see nothing: every org policy is
     `organization_id = current_org_id()`, which evaluates to NULL (not true).
     They can still read their own profile row. The app already shows
     "Hesabınız bir organizasyona bağlı değil" on writes.

3. Existing data is **not** modified. Profiles already attached to an
   organization (including everyone auto-attached by 0007) keep access.

## How to apply

Either:

- Supabase CLI against a linked project: `supabase db push` (applies pending
  files in `supabase/migrations/`), or
- Dashboard → SQL Editor → paste `0008_security_hardening.sql` → Run.

The file is idempotent (`drop policy if exists`, `create or replace function`,
`create table if not exists`) and can be re-run.

### After applying

1. Review existing members — anyone who signed up before this fix was
   auto-attached:
   ```sql
   select p.id, u.email, p.role, p.organization_id, p.created_at
   from public.profiles p join auth.users u on u.id = p.id
   order by p.created_at;
   ```
   Detach unknown accounts:
   `update public.profiles set organization_id = null where id = '<uuid>';`
2. Make sure at least one trusted user has `role = 'admin'` (SQL editor):
   `update public.profiles set role = 'admin' where id = '<owner uuid>';`
3. Invite new teammates (as that admin via the API, or in the SQL editor):
   ```sql
   insert into public.organization_invites (organization_id, email, role)
   values ('<org uuid>', 'new.person@example.com', 'editor');
   ```

## Manual negative test plan

Run with two test accounts on a **staging** project. Use the app's anon key
with a user JWT (e.g. from the browser console with `supabase-js`) — not the
SQL editor, which runs as `postgres` and bypasses RLS.

| # | Action | Expected |
|---|--------|----------|
| 1 | User A: `supabase.from('profiles').update({ role: 'admin' }).eq('id', A)` | Error `permission denied for table profiles` (42501); role unchanged |
| 2 | User A: `.update({ organization_id: '<other org>' }).eq('id', A)` | Same permission error |
| 3 | User A: `.update({ full_name: 'X' }).eq('id', B)` | 0 rows updated (RLS `USING`) |
| 4 | User A: `.update({ full_name: 'X' }).eq('id', A)` | Succeeds |
| 5 | Sign up a brand-new email with no invite | `profiles.organization_id IS NULL`, role `editor`; all list pages are empty; inserts fail |
| 6 | Admin inserts invite for `c@example.com` (role `editor`), then C signs up and confirms email | C's profile gets the org, invite `accepted_at` set |
| 7 | Non-admin (editor) tries `.from('organization_invites').insert(...)` / `.select()` | Insert rejected by RLS; select returns 0 rows |
| 8 | Admin of org X inserts an invite with `organization_id` = org Y | Rejected by RLS |
| 9 | Sign up with an invited email but do **not** confirm it | `organization_id` stays NULL until confirmation |
| 10 | Insert invite with `Mixed@Case.com` | Rejected by CHECK constraint (store lower-case) |

## Rollback

Restores the pre-0008 behaviour (including the insecure auto-join). Only use
if 0008 breaks something critical, and re-fix immediately.

```sql
-- triggers / functions
drop trigger if exists on_org_invite_created on public.organization_invites;
drop function if exists public.apply_invite_to_existing_user();
drop trigger if exists on_auth_user_email_confirmed on auth.users;
-- re-run the `create or replace function public.handle_new_user()` block and
-- the `on_auth_user_created` trigger from 0007_backfill_user_organizations.sql

-- invites
drop table if exists public.organization_invites;

-- profiles privileges / policy
grant update on public.profiles to authenticated;
drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles for update
  using (id = auth.uid());
```

A safer partial rollback is to keep step 1 (profiles) and only revert step 2.
