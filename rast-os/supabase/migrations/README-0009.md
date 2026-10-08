# Migration 0009 — Expense FX snapshot

> **Status: NOT applied anywhere.** Written and reviewed only. Apply after
> `0008_security_hardening.sql`, on a staging / branch database first.

## What changes

- `expenses.fx_rate numeric(12,6)` — exchange rate used when the expense was
  entered (1 USD/EUR = `fx_rate` TL). `NULL` for TRY expenses. A CHECK keeps it
  positive when set.
- `expenses.amount_try numeric(14,2)` — `amount * fx_rate` (VAT excluded),
  frozen at entry time. `NULL` for TRY expenses and for all pre-0009 rows.

## App behaviour

- Expense form (create/update), currency ≠ TRY: stores `fx_rate` (current rate
  from Settings → localStorage at entry time) and `amount_try`. When editing a
  row that already has `fx_rate` and the currency did not change, the stored
  rate is kept (only `amount_try` is recomputed from the new amount). Switching
  to TRY clears both columns.
- Reports / dashboard: if `amount_try` is present the TL value is
  `amount_try + vat * fx_rate`; otherwise (old rows) the current rate is used
  exactly as before.
- Recurring USD/EUR templates use the template's snapshot for every monthly
  occurrence (no per-month historical rate exists yet).
- Until this migration is applied, the form detects the "unknown column" error
  and saves the expense without the two fields (old behaviour), so expense entry
  does not break in the meantime.

## Not done (later)

- **Rates belong in the DB, per organization.** The entry-time source is still
  the browser's localStorage rate (`src/lib/fx.ts`), so two users can enter with
  different rates. A follow-up should add an org-level `fx_rates` table (date,
  currency, rate) and read the entry-time rate from there (or from a daily
  rate feed).
- The Excel finance import does not set `fx_rate`/`amount_try` yet.

## Optional manual backfill (NOT automatic)

Only if you know the rate that should apply to old rows. Example: freeze all
existing USD rows at a single known rate (review the `select` first):

```sql
-- preview
select id, paid_at, amount, currency from public.expenses
where currency <> 'TRY' and fx_rate is null order by paid_at;

-- apply (example rate — replace with the real one, or run per month/date range)
update public.expenses
set fx_rate = 41.20, amount_try = round(amount * 41.20, 2)
where currency = 'USD' and fx_rate is null
  and paid_at between '2026-09-01' and '2026-09-30';
```

Rows left `NULL` keep using the current rate in the app.
