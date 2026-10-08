# Migration 0011 — Teklifler (proposals)

> **Status: NOT applied anywhere.** Written and reviewed only. Apply after
> `0010_import_rpc.sql`, on a staging / branch database first.

## What changes

- `public.proposals` — proposal header: `client_id` (nullable FK → `clients`,
  `on delete set null`), `title`, `proposal_no` (unique per organization),
  `status` (`draft | sent | accepted | rejected | expired`, text + CHECK),
  `currency` (`TRY | USD | EUR`, default `TRY`), `vat_rate` (default 20),
  `valid_until`, `notes` (süreç / takvim), `terms` (sorumluluklar + ödeme
  koşulları), `created_by` (default `auth.uid()`), `created_at`, `updated_at`.
- `public.proposal_items` — line items: `position`, `name`, `description`,
  `qty` (default 1), `unit` (default `'ay'`), `unit_price`, `is_recurring`
  (default false), `created_at`.
- `public.set_updated_at()` trigger function + `proposals_set_updated_at`
  trigger (keeps `updated_at` correct even if a client forgets to send it).
- RLS: `proposals_org_all` / `proposal_items_org_all`, identical to the 0001
  org-scoped policy (`organization_id = current_org_id()` for USING and
  WITH CHECK).

## Design notes

- `proposal_items` also has `organization_id`. The app's shared store writes
  `organization_id` on every insert, and this keeps the RLS policy identical to
  every other table. The FK is composite — `(proposal_id, organization_id)` →
  `proposals(id, organization_id)` with `on delete cascade` — so an item can
  never point at another organization's proposal, and deleting a proposal
  deletes its items.
- `proposal_no` (`RC-YYYY-NNN`) is generated in the app
  (`src/lib/proposal-logic.ts → nextProposalNo`) from the organization's
  existing proposals; the DB only enforces uniqueness
  (`proposals_org_no_unique`). On a collision (two people creating at the same
  moment) the app retries with the next number.
- `client_id` follows the existing tables' pattern (plain FK, like
  `invoices.client_id`): the DB does not check that the client belongs to the
  same organization. RLS still hides other organizations' clients from the
  picker. A composite FK for all `client_id` columns could be a later,
  cross-table hardening migration.

## Apply

Paste `0011_proposals.sql` into the Supabase SQL editor (staging / branch DB
first), after 0010 has been applied. Idempotent: safe to run more than once.

## Until it is applied

The Teklifler screens work in demo mode (no Supabase env). With Supabase
configured but 0011 not applied, loading `/teklifler` returns an empty list
and saving fails with a "relation does not exist" error toast — nothing else
in the app is affected.

## Rollback

```sql
drop table if exists public.proposal_items;
drop table if exists public.proposals;
drop function if exists public.set_updated_at();
```
