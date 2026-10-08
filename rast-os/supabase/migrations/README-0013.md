# Migration 0013 — İçerik onayı (content_approvals)

> **Status: NOT applied anywhere.** Written and reviewed only; it has not been
> executed against any database (no Postgres instance was available). Apply
> **after `0012_activity_logs_triggers.sql`**, on a staging / branch database
> first. Requires **Postgres 15+** (`on delete set null (content_id)`); all
> current Supabase projects qualify.

## Why

The 2025 health-promotion regulation (md. 5/2) makes whoever *publishes* a
non-compliant promotion as liable as whoever *commissions* it. Every script /
video therefore needs a written approval from the physician (or client) with
the 8-item compliance checklist from
`04-Knowledge/Hekim-Sistemi/icerik-onay-formu.md`. This migration stores that
record and lets the approver decide through a secret link without an account.

## What changes

- `public.contents` gets `contents_id_org_unique unique (id, organization_id)`
  (composite FK target; `id` is already the PK, so this never fails).
- `public.content_approvals` — one row per *version* of an approval request:

  | column | notes |
  | --- | --- |
  | `content_id` | composite FK `(content_id, organization_id)` → `contents`, `on delete set null (content_id)`: deleting a content keeps the evidence |
  | `version` | 1, 2, 3… per content (`unique (content_id, version)`), computed by the app |
  | `token` | 64 hex chars = `gen_random_bytes(32)` (256 bit), unique, **always generated server-side** |
  | `title` | content title at send time (also the activity-log label) |
  | `checklist` | `[{key, label, basis, checked}]` × 8, from `approval_default_checklist()` |
  | `script_snapshot` | script at send time (immutable) |
  | `note` | approver's note (required for "değişiklik istiyorum") |
  | `status` | `pending | approved | changes_requested | expired` |
  | `sent_at`, `expires_at` | `expires_at = sent_at + 14 days` |
  | `decided_at`, `decided_by_name`, `decided_by_ip` | written only by `approval_decide` |
  | `created_by`, `created_at` | |

- Helper functions: `approval_new_token()` (pgcrypto; `search_path = public,
  extensions` so it works whether pgcrypto lives in `extensions` (Supabase) or
  `public`), `approval_default_checklist()` (the 8 items; the app copy in
  `src/lib/approval-logic.ts` is compared to it by `npm test`).
- `content_approvals_guard` (BEFORE INSERT/UPDATE) for the `anon` /
  `authenticated` roles:
  - INSERT must be `pending` with empty decision fields; `token`, `checklist`,
    `note`, `sent_at`, `expires_at`, `created_by`, `created_at` are overwritten
    with server values (a client cannot choose a weak token or alter the
    checklist text).
  - UPDATE: only `pending → expired` (withdraw / superseded), nothing else may
    change. Decided records are immutable.
  - The SECURITY DEFINER RPC and FK actions run as the owner and are exempt.
- RLS (`to authenticated`, `organization_id = current_org_id()`): select,
  insert, update; delete only while `status in ('pending','expired')` —
  decided records cannot be deleted. All table privileges revoked from `anon`.
- Public RPCs (`security definer`, `set search_path = public`, `execute`
  granted to `anon, authenticated`, revoked from `public`):
  - `approval_get(p_token text) → jsonb | null` — title, version, effective
    status (pending past `expires_at` or superseded by a newer version reads
    `expired`), `script_snapshot`, `checklist`, `note`, dates,
    `decided_by_name`, client / brand / agency name. Never returns ids, IP or
    creator.
  - `approval_decide(p_token, p_decision, p_name, p_note default null,
    p_checked text[] default null) → jsonb` — validates token format,
    decision (`approved | changes_requested`), name (3–120 chars), note
    (≤ 2000, required for changes), locks the row (`for update`), requires
    `pending`, not expired and not superseded (marks it `expired` otherwise),
    and for `approved` requires **all 8 checklist keys** in `p_checked`.
    Writes `status`, ticked `checklist`, `note`, `decided_at`,
    `decided_by_name`, `decided_by_ip` (first `x-forwarded-for` value from
    PostgREST's `request.headers`, else null). Returns
    `{ok:true,status,decided_at,version}` or `{ok:false,error:<code>}`.
- Activity log: the 0012 `log_activity()` trigger is attached
  (`content_approvals_activity_log`). Skipped with a NOTICE if 0012 is missing.

## Privacy / security notes

- **Token links are secrets.** Anyone holding `/onay/<token>` can read the
  script snapshot and decide. Send it only to the approver (WhatsApp / e-mail
  1:1, not group chats). 256-bit tokens are not guessable; the public page
  sends `Referrer-Policy: no-referrer` and `noindex`.
- **14-day expiry.** After `expires_at` the link only shows "süresi doldu";
  "Yeniden gönder" creates a new version + token and the older pending one is
  withdrawn (`expired`).
- `decided_by_ip` and `decided_by_name` are personal data (KVKK) kept as
  evidence for the regulation's shared-liability rule. Do not write the
  physician's phone / e-mail into the note (form rule). Retention period:
  to be set with legal counsel (template suggests ≥ 5 years after contract).
- The activity log (0012) stores the insert diff, which includes the token;
  only members of the same organization can read it (same as the table).

## Apply

Supabase Dashboard → SQL Editor → paste `0013_content_approvals.sql` → Run
(staging first). Idempotent: safe to run more than once.

Quick check (as an org member in the app): open a content → "Onay" →
"Onaya gönder", open the link in a private window, approve. Then:

```sql
select version, status, decided_by_name, decided_at, expires_at
from public.content_approvals order by created_at desc limit 5;
select public.approval_get('<token>');
```

## Rollback

```sql
drop function if exists public.approval_decide(text, text, text, text, text[]);
drop function if exists public.approval_get(text);
drop table if exists public.content_approvals;          -- deletes approval evidence!
drop function if exists public.content_approvals_guard();
drop function if exists public.approval_default_checklist();
drop function if exists public.approval_new_token();
alter table public.contents drop constraint if exists contents_id_org_unique;
```

Export the table first if any decision has been recorded.
