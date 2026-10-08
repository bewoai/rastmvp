# Migration 0016 — `contents.script_source`

> **Status: NOT applied anywhere.** Written only; it has not been executed
> against any database. Apply **after `0015_client_reports.sql`**, on a
> staging / branch database first.

## Why

Scripts are **not** generated inside the app (there is no Anthropic API key
and there will not be one). The owner generates them in Claude Code with the
RAST-OS skill `08-Prompts/Skills/senaryo-uret` (uses the Claude subscription).
That command writes a `writing-draft` markdown file
(`09-Sources/Writing-Drafts/<date>/<time>-<client>-<format>.md`). In the app,
**İçerik → content → "Senaryo içe aktar"** takes that markdown (paste or
`.md` file), fills `hook` / `script` / `caption`, and records where the script
came from in `contents.script_source`.

## What changes

- `public.contents.script_source text` (nullable).
- `contents_script_source_check`: `null` or one of
  `'claude-code'`, `'rast-writer'`, `'manual'`. The app only writes
  `'claude-code'`.
- No RLS change (existing `contents` policy applies). Updates are logged by the
  0012 `log_activity()` trigger like any other `contents` change.

## Handoff contract (same as `crm_sync.py`)

| writing-draft | `contents` |
| --- | --- |
| `# Final Script` (up to `## Brief`) | `script` |
| `## Hook` | `hook` (only if present) |
| `## Caption` | `caption` (only if present) |
| `source: claude-code` | `script_source = 'claude-code'` |
| — | `status`: `brief` → `script_ready` only when there is no `## Verification Notes` section and `regulation_gate` ≠ `failed` |

Parser: `src/lib/writing-draft.ts` (pure, tested in
`scripts/writing-draft.test.mjs`; fixture = the vault's `ornek-cikti.md`).
Nothing is written until the user presses **Kaydet** in the content form;
approval still goes through **Onaya gönder** (0013).

## Apply

Supabase Dashboard → SQL Editor → paste `0016_script_source.sql` → Run
(staging first). Idempotent: safe to run more than once.

## Until it is applied

- Demo mode (no Supabase env): works in memory.
- Supabase without 0016: importing fills the form, but **Kaydet** fails with
  an error toast (`script_source` column missing; the message points to this
  migration). Contents that were never imported save normally, because the
  field is only sent once it has a value.

## Checks (as an org member, in the app)

- İçerik → open a content in status "Brief" → Senaryo içe aktar → paste the
  vault example (`08-Prompts/Skills/senaryo-uret/ornek-cikti.md`) → Alanlara
  aktar → Kaydet →
  `select title, status, script_source, left(script, 60) from public.contents order by updated_at desc limit 5;`
  → `status = script_ready`, `script_source = claude-code`.
- Same with a draft that has a `## Verification Notes` section → status stays
  `brief`.
- `update public.contents set script_source = 'x' where id = '…';` → fails
  with `contents_script_source_check`.

## Rollback

```sql
alter table public.contents drop constraint if exists contents_script_source_check;
alter table public.contents drop column if exists script_source;
```
