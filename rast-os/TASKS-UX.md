# Tasks UX — Todoist-style fast workflow

Branch: `worktree-tasks-ux` · Baseline: `ce03ce5` (MVP performance audit)

Acceptance flow: **Q → type task → Enter → task appears immediately** (measured 8–11 ms in a headless
Chrome run against the production build; the row is in the DOM before the Supabase insert returns).

## What changed

| Area | Implementation |
|---|---|
| Global Quick Add | `QuickAddHost` (mounted once in `AppShell`) listens for `Q` on `document`. Ignored when typing in input/textarea/select/contenteditable, with Ctrl/Cmd/Alt/Shift, on key repeat / IME composition, or while any `[aria-modal="true"]` dialog is open (`Modal` now carries `role="dialog" aria-modal="true"`). |
| Isolated form state | `Composer` owns all form state. The title input is **uncontrolled**; only "empty ↔ non-empty" causes a render. Verified: 0 DOM mutations under `<main>` while typing. Open/close lives in a tiny zustand store (`lib/quickAdd.ts`). |
| Optimistic creation | `createTask()` → existing `store.add`, which writes state synchronously and inserts in the background, rolling back on error. Failure → danger toast. **No refetch.** |
| Duplicate-submit protection | Input is cleared synchronously on submit, so a same-tick second Enter / double-click sees an empty title and no-ops. Also ignores `e.repeat`, IME confirm (`isComposing` / keyCode 229), and the button is disabled when empty. Tested: 3× Enter in one tick and double-click → exactly 1 task. |
| Keys | `Enter` add & close · `Shift+Enter` add & keep open · `Esc` close (document-level, so it works from any control; focus returns to the previous element). |
| Compact rows | `TaskRow` (memoized): circle, title, project, status, due, priority. Secondary chips (`Bekliyor`, empty date) appear on hover/focus on desktop, always visible on touch. |
| Complete / reopen | Circle toggles `status` `done` ⇄ `todo` (one click, optimistic). |
| Inline title edit | Click title → input (text preselected). `Enter`/blur saves, `Esc` cancels. Uncontrolled input; empty/unchanged = no mutation. |
| Priority / due date | Native `<select>` / date input behind chips (`low/medium/high/urgent`, `YYYY-MM-DD`). Due date has a ✕ to clear. |
| Status | Row chip is a `<select>` over the existing `taskBoard` statuses so the agency workflow (`in_progress`, `internal_review`, `client_review`, `revision`) is still editable now that the Kanban board is gone. |
| Views | `Bugün` (open, due ≤ today; split into *Gecikmiş* / *Bugün*), `Yaklaşan` (open, due > today; grouped by date), `Tümü` (every open task incl. undated — default), `Tamamlanan` (`status = done`). All four are bucketed in **one O(N) pass** (`bucketTasks`); only the active view is sorted/grouped. |
| View-aware default date | Tasks page sets Quick Add's default due date: Bugün → today, Yaklaşan → tomorrow, else none — so a task added in a view is always visible in that view immediately. |
| Mobile | Fixed `+ Yeni Görev` button (`md:hidden`); header button is desktop-only and shows the `Q` hint. |
| Toasts | Small `lib/toast.ts` + `Toaster`. Success toast (“Görev eklendi · Görevlere git”) only when adding from a page other than `/tasks`; errors always. |

## Existing schema values reused — nothing invented, **no migrations**

- `tasks.status` → `task_status` enum: `todo | in_progress | internal_review | client_review | revision | done`.
  Complete = `done`; reopen = `todo`.
- `tasks.priority` → `priority` enum: `low | medium | high | urgent` (default `medium`, as before).
- `tasks.due_date` → `date`; `''` is sent to clear it (the store's `clean()` turns `''` into `null`).
- Labels come from `lib/labels.ts` (`taskStatus`, `priority`, `taskBoard`).

## Existing mutation / audit behavior (inspected)

- `store.add` / `store.update` were already optimistic with rollback + error return; reused as-is.
- **There is no audit trail anywhere in the app**: nothing writes to `activity_logs`, and `tasks.updated_at`
  has no trigger, so it doesn't change on update. I did not add any. If audit is wanted it should be a
  deliberate, separate change (trigger or store-level hook) — flagging it, not fixing it here.
- `assignee`: the DB has `assignee_id uuid`, **no `assignee` column**, but the old modal sent `assignee: ""`
  (→ `null`), which PostgREST rejects. Quick Add doesn't send `assignee` at all. (Seed/demo data still has
  `assignee` text; the Dashboard still reads `task.assignee`.)

## Performance guarantees preserved

- **No global hydration.** Tasks page still uses `useHydrated(["tasks","projects"])`. The composer, which can
  open on any page, uses `useHydrated(["projects"])` only (for the optional project picker).
- **No refetch after mutations.** Only `add`/`update` on the store.
- **No per-keystroke page renders.** Composer state is local; row edit state is local; the page subscribes to
  `tasks`/`projects` only. `TaskRow` is `memo`'d and the store replaces only the changed task object.
- **No O(N·M) lookups.** `projectMap` (`Map`) as before; buckets computed in one pass.
- No `AmbientScene`/WebGL.

## Store change (small, needed for global Q)

`store.load()` used to overwrite a collection with the fetched rows. With global Q a task can be added
*before* `tasks` has ever been loaded (e.g. from the Dashboard); a later `load(["tasks"])` could then wipe
that optimistic row if the insert hadn't committed yet. `load()` now keeps local rows not present in the
fetched result and builds `loadedCollections` from the freshest state (previously from a stale snapshot,
which concurrent loads could clobber). `MutationResult` is now exported. No extra fetches.

## Files

New: `components/QuickAddTask.tsx`, `components/TaskRow.tsx`, `components/Toaster.tsx`,
`lib/taskLogic.ts` (pure), `lib/taskActions.ts`, `lib/quickAdd.ts`, `lib/toast.ts`, `lib/useToday.ts`,
`scripts/tasks-logic.test.mjs`.
Changed: `app/(app)/tasks/page.tsx` (rewritten; Kanban board replaced by list views), `components/AppShell.tsx`,
`components/form.tsx` (dialog aria attrs), `lib/store.ts` (`load` merge), `package.json` (`npm test`).

## Verification

- `npm run build` — passes (all 25 routes; `/tasks` prerenders).
- `npx tsc --noEmit` — clean.
- `npm test` — 10/10 (`node:test` on `taskLogic.ts`: local-date keys, rollover, bucketing, sort, grouping).
- `npm run lint` — **13 errors / 4 warnings, identical to the pre-change baseline** (all pre-existing in
  other files: CRM/finance/jobs/projects/shoots pages, `EquipmentManager`, `useCollections`, `store.ts` warning).
  None in any file added or rewritten here.
- Headless-Chrome run (ad-hoc Playwright script against `next start`, demo mode, 41 checks, all passing):
  Q open/focus, zero DOM mutations while typing, immediate appearance, triple-Enter and double-click dedupe,
  blank submit, Esc, Shift+Enter, Q ignored inside inline editor, inline edit (Enter/blur/Esc), priority, due
  date set/clear, complete/reopen, status, Bugün/Yaklaşan default dates, global Q from Dashboard + toast +
  presence after client-side navigation, mobile FAB, no console errors. That script is not committed.

## Not verified / known limits

- **Supabase mode was not exercised** (no credentials/`.env.local` here); only demo/seed mode. The Supabase
  path is the existing `store.add/update` plus the `load` merge above.
- The native date-picker popup (`showPicker()`) can't be observed headless; the fallback (`focus()+click()`) is in place.
- No `completed_at` column, so `Tamamlanan` is ordered by `created_at` (newest first), not completion time.
- Reopen always returns to `todo` (the pre-completion status isn't stored).
- Tasks page no longer offers a Kanban board; statuses remain editable per row.
- Default view is `Tümü` (not `Bugün`) so undated tasks — including ones added from other pages — are visible.
