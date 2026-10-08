# Migration 0014 — Organizasyon hedefleri (MRR eşiği)

> **Status: NOT applied anywhere.** Written only. Apply after
> `0013_content_approvals.sql`, on a staging / branch database first.
> (Numbered 0014 to avoid colliding with the parallel 0013; the two are
> independent, but apply in numeric order — see `APPLY-ORDER.md`.)

## What changes

- `public.organizations.mrr_target numeric(14,2)` — target monthly recurring
  revenue in TRY, KDV hariç. `NULL` (default) = no target set; the dashboard
  then shows an "Eşik belirle" call to action.
- `public.organizations.mrr_target_label text` — default
  `'Hastaneden ayrılma eşiği'`, max 80 chars, not blank.
- CHECKs: `mrr_target >= 0`; label non-blank and <= 80 chars.
- RLS / grants:
  - SELECT unchanged (`org_select`: `id = current_org_id()`).
  - New policy `org_admin_update_targets`: UPDATE only for the `admin` role of
    the user's own organization (`current_role_name() = 'admin'`).
  - `revoke update on organizations from anon, authenticated`, then
    `grant update (mrr_target, mrr_target_label) to authenticated` — so even an
    admin cannot change `name` / `id` / `created_at` from the client.

## Design notes

- There is no org-settings table today (`organizations` only has id, name,
  created_at), so two columns are added to `organizations` instead of a new
  table. No new RLS surface.
- Before this migration `organizations` had **no** UPDATE policy; this is the
  first one, deliberately admin-only and column-scoped.
- The app reads/writes these columns directly (`src/lib/orgSettings.ts`).
  MRR itself is computed on the client from proposals / invoices
  (`src/lib/mrr.ts`); nothing is stored.

## Apply

Paste `0014_org_targets.sql` into the Supabase SQL editor (staging first).
Idempotent: safe to run more than once.

## Until it is applied

Demo mode (no Supabase env) keeps the target in the browser (localStorage).
With Supabase configured but 0014 not applied, the dashboard card shows
"Eşik belirle" and saving the target in Ayarlar fails with an error toast;
nothing else is affected.

## Rollback

```sql
drop policy if exists org_admin_update_targets on public.organizations;
alter table public.organizations
  drop constraint if exists organizations_mrr_target_check,
  drop constraint if exists organizations_mrr_target_label_check,
  drop column if exists mrr_target,
  drop column if exists mrr_target_label;
```
