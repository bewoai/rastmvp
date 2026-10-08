# Migration 0012 — İşlem geçmişi (activity_logs trigger'ları)

> **Status: NOT applied anywhere.** Written and reviewed only; it has not been
> executed against any database (no Postgres instance was available). Apply
> after `0011_proposals.sql`, on a staging / branch database first.

## What changes

- `public.log_activity()` — generic AFTER trigger function
  (`security definer`, `set search_path = public`). For every row change it
  writes one row to the existing `public.activity_logs` table (0001):

  | column         | value                                                             |
  | -------------- | ----------------------------------------------------------------- |
  | `organization_id` | from `NEW` (insert/update) or `OLD` (delete)                   |
  | `actor_id`     | `auth.uid()` if that user has a profile, else `NULL` (service role / SQL editor) |
  | `actor_name`   | **new column** — `profiles.full_name` at the time of the change   |
  | `entity`       | table name (`TG_TABLE_NAME`)                                      |
  | `entity_id`    | the row's `id`                                                    |
  | `record_label` | **new column** — first of `name, title, customer_name, invoice_no, proposal_no, description, vendor` (max 200 chars) |
  | `action`       | `insert` / `update` / `delete`                                    |
  | `diff`         | `{ "<column>": { "old": …, "new": … } }` for changed columns only |
  | `created_at`   | `now()` (column default)                                          |

  The 0001 column names (`entity`, `entity_id`, `diff`) are kept instead of
  renaming them to `table_name` / `record_id` / `changed`, so nothing
  existing breaks. `actor_name` and `record_label` are stored so the log stays
  readable after the record or the person is deleted.

- Excluded from `diff`: `id`, `organization_id`, `created_at`, `updated_at`.
  An UPDATE that only touches excluded columns (e.g. the 0011
  `set_updated_at` trigger) writes nothing. Insert/delete diffs omit `null`
  fields.
- Triggers `<table>_activity_log` (AFTER INSERT OR UPDATE OR DELETE, FOR EACH
  ROW) on: `clients, projects, jobs, tasks, invoices, payments, expenses,
  proposals, proposal_items`. A table that does not exist yet (e.g. 0011 not
  applied) is skipped with a NOTICE — re-run 0012 after applying it.
- When an organization is being deleted (cascade), logs are skipped (the FK
  to `organizations` would otherwise abort the delete).
- Indexes: `(organization_id, created_at desc)`, `(entity, entity_id)`.
- RLS on `activity_logs`: the 0001 `activity_logs_org_all` (FOR ALL) policy is
  dropped and replaced by `activity_logs_org_select` (SELECT,
  `organization_id = current_org_id()`). `INSERT/UPDATE/DELETE/TRUNCATE` are
  revoked from `anon` and `authenticated`; only the trigger (running as the
  function owner) writes.

## Notes

- Volume: one log row per changed row. The import RPC (0010) and cascades
  (e.g. deleting a proposal deletes its items) produce one row each.
- The app reads the newest 500 logs (`store.load`) and never writes them.
  Before 0012 is applied the table exists but stays empty, so the dashboard
  panel and `/settings/islem-gecmisi` simply show "Henüz işlem yok".
- `diff` can contain long text (e.g. `proposals.terms`); add a retention job
  later if the table grows.

## Apply

Supabase Dashboard → SQL Editor → paste `0012_activity_logs_triggers.sql` →
Run (staging first), after 0011. Idempotent: safe to run more than once.

Quick check: edit any client in the app, then in the SQL editor:

```sql
select entity, action, record_label, diff, created_at
from public.activity_logs order by created_at desc limit 10;
```

## Rollback

```sql
do $$
declare t text;
begin
  foreach t in array array['clients','projects','jobs','tasks','invoices',
                           'payments','expenses','proposals','proposal_items'] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop trigger if exists %I on public.%I;', t || '_activity_log', t);
    end if;
  end loop;
end $$;
drop function if exists public.log_activity();

drop policy if exists activity_logs_org_select on public.activity_logs;
create policy activity_logs_org_all on public.activity_logs for all
  using (organization_id = current_org_id())
  with check (organization_id = current_org_id());
grant insert, update, delete on public.activity_logs to authenticated;

drop index if exists public.idx_activity_logs_org_created;
drop index if exists public.idx_activity_logs_entity;
alter table public.activity_logs drop column if exists actor_name;
alter table public.activity_logs drop column if exists record_label;
-- Optional: delete from public.activity_logs;  (logs written while 0012 was active)
```
