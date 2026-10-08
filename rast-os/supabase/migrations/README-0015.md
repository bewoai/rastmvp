# Migration 0015 — Aylık müşteri raporu (`client_reports`) + `projects.proposal_id`

> **Status: NOT applied anywhere.** Written only; it has not been executed
> against any database. Apply **after `0014_org_targets.sql`**, on a staging /
> branch database first. Requires **Postgres 15+**
> (`on delete set null (proposal_id)`, same as 0013).

## Why

1. The Hekim İçerik Sistemi promises "ay sonunda sade bir rapor". The app
   builds the monthly client report (`/raporlar/aylik`) from existing data
   (contents, shoots, content approvals). Only the hand-written parts — notes,
   highlights, ads/GİP note — need storage.
2. Accepting a proposal now creates a project (+ a draft invoice for the
   recurring items). The project remembers its proposal so the conversion is
   idempotent: a second click opens the existing project.

## What changes

- `public.clients` gets `clients_id_org_unique unique (id, organization_id)`
  (composite FK target; `id` is already the PK, so this never fails).
- `public.client_reports`:

  | column | notes |
  | --- | --- |
  | `client_id` | composite FK `(client_id, organization_id)` → `clients`, `on delete cascade` |
  | `period` | `date`, always the 1st of the month (CHECK) |
  | `notes` | free text, ≤ 10 000 chars |
  | `highlights` | `jsonb` object: `{ "points": string[], "ads_note": string }` |
  | `generated_at` | last time the report was saved / generated |
  | `created_at`, `updated_at` | `updated_at` via `set_updated_at()` (0011) |

  - `unique (organization_id, client_id, period)` — one report per client per month.
  - RLS: `client_reports_org_all` (`to authenticated`, `organization_id = current_org_id()`),
    all privileges revoked from `anon`.
  - The 0012 `log_activity()` trigger is attached (`client_reports_activity_log`);
    skipped with a NOTICE if 0012 is missing.
  - **No numbers are stored.** Counts (published / planned contents, approval
    distribution, shoots) are recomputed from the source tables every time the
    report is opened. There are deliberately **no ad metrics** (physician
    clients); `highlights.ads_note` is free text only.
- `public.projects.proposal_id uuid` (nullable):
  - composite FK `(proposal_id, organization_id)` → `proposals(id, organization_id)`
    (0011's `proposals_id_org_unique`), `on delete set null (proposal_id)` —
    deleting the proposal keeps the project.
  - partial unique index `projects_proposal_unique (proposal_id) where proposal_id is not null`:
    at most one project per proposal, even if two users convert at once.
  - Existing `projects_org_all` RLS policy (0001) is unchanged.

## App behaviour

- `src/lib/report-logic.ts` (pure, tested) computes the report;
  `/raporlar/aylik` edits the notes, `/raporlar/aylik/<clientId>/<yyyy-mm>/yazdir`
  is the A4 print view.
- `src/lib/proposal-convert.ts` (pure, tested) maps a proposal to a project and
  a draft invoice; `src/lib/proposalActions.ts → convertProposalToProject`
  writes them. The draft invoice (`status = 'draft'`, current month, KDV from
  the proposal's `vat_rate`, note `Teklif RC-…`) is created only for TRY
  proposals that have recurring items, and only when the project is created
  for the first time. It is linked with the existing `invoices.project_id`.

## Apply

Supabase Dashboard → SQL Editor → paste `0015_client_reports.sql` → Run
(staging first). Idempotent: safe to run more than once.

## Until it is applied

- Demo mode (no Supabase env): everything works in memory.
- Supabase without 0015: the report page shows the computed sections but saving
  notes fails with an error toast (`client_reports` missing). "Projeye
  dönüştür" fails with an error toast (`proposal_id` column missing); nothing
  is half-written because the project insert is the first write.

## Checks (as an org member, in the app — not the SQL editor, which bypasses RLS)

- Raporlar → Aylık rapor → pick a client + month → write notes → Kaydet →
  `select client_id, period, notes, highlights, generated_at from public.client_reports order by updated_at desc limit 5;`
- Saving the same client + month twice updates the same row (no duplicate).
- Teklif → status "Kabul edildi" → Kaydet → a project and (for recurring
  items) a draft invoice appear; clicking "Projeye dönüştür" again opens the
  same project:
  `select id, name, proposal_id from public.projects where proposal_id is not null;`

## Rollback

```sql
drop table if exists public.client_reports;   -- deletes saved report notes
drop index if exists public.projects_proposal_unique;
alter table public.projects drop constraint if exists projects_proposal_fk;
alter table public.projects drop column if exists proposal_id;
alter table public.clients drop constraint if exists clients_id_org_unique;
```
