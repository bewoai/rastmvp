# RAST MVP — UX Audit & Improvement Pass

Scope: `rast-os/` only (branch `main`, no worktree). Product UX pass; no infrastructure, schema or deploy changes.
Not deployed. All verification below was done locally in **demo mode** (no Supabase env → seed data), never against production.

Baseline → result: `npm test` 10/10 → 10/10 · `tsc` clean → clean · `eslint` 13 errors / 4 warnings → **1 error / 2 warnings** (both remaining are pre-existing, `src/lib/useCollections.ts` and `store.ts` hook-deps) · `npm run build` OK.

---

## 1. Problems found

Severity: **H** = data loss / silent failure / broken flow · **M** = friction or misleading UI · **L** = polish.

### Forms & mutations

| # | Sev | Where | Problem |
|---|---|---|---|
| 1 | H | Projects, Jobs, Leads, Brands, Contacts, Shoots, Invoices, Expenses, Equipment modals | `save()` ignored the `add/update` result and called `onClose()` immediately. If the insert failed, the store rolled the row back and the modal was already gone: the record vanished, typed values were lost, no message. (Only `ClientModal` and Content handled errors.) |
| 2 | H | every trash button | Delete had **no confirmation**, and `store.remove` swallowed errors (no rollback, no feedback). Project→tasks and client→brands are `ON DELETE CASCADE`, so one mis-click removed related data silently. |
| 3 | H | `shoots/page.tsx` | `scheduled_at` is `timestamptz` (PostgREST returns `2026-08-09T10:00:00+00:00`) but `<input type="datetime-local">` only accepts `YYYY-MM-DDTHH:mm`. By inspection the edit form showed an empty date and saving wrote `null`, wiping the date. *(Found in code; not reproduced against prod data.)* |
| 4 | H | `crm/brands` | `brands.client_id` is `NOT NULL` but the form allowed "Seçin" (empty) → every such insert would fail (silently, see #1). |
| 5 | M | Invoices, Expenses | New records had no default date, but the default "Seçili Ay" view filters by date → a just-created invoice/expense **disappeared** from the list. |
| 6 | M | all modals | No autofocus, no Enter-to-submit, no focus trap, focus not returned on close, Escape closed *all* stacked dialogs (Content form + file preview). Form state was reset with `useMemo(() => setForm())` (setState during render — the source of most of the 13 lint errors). |
| 7 | M | Content | Whole form + upload state lived at page level → every keystroke re-rendered the full calendar list; `brands.find()` per row (O(N·M), a perf-audit anti-pattern that was still present). |
| 8 | M | Jobs, Pipeline, Invoices, Content, Equipment | Inline status `<select>` changes reverted silently on failure. |
| 9 | M | Expenses modal | "Ödeme yöntemi / durumu" label was ambiguous next to a separate "Ödeme durumu" field; 12 flat fields with no hierarchy. |
| 10 | M | Settings | `useStore(s => s.supabase)` without `useHydrated()` → if Settings was the first page opened it showed "Yerel (demo)" even when live. FX inputs were bound to the store and ignored empty/invalid input, so a value could not be cleared/retyped. |

### Navigation & shell

| # | Sev | Where | Problem |
|---|---|---|---|
| 11 | M | `Topbar` | Placeholder said "Müşteri, proje, içerik ara…" but it only filtered the 17 menu labels. Hidden entirely on mobile. |
| 12 | M | shell | Only sidebar clicks showed pending feedback; dashboard tiles, toast links etc. gave none (prefetch is off, so there *is* a network wait). |
| 13 | M | `AppShell` | Mobile drawer: no dialog semantics, no Escape, no close button, focus not managed. |
| 14 | M | all pages | One static page title ("Rast OS — …"); every tab/history entry looked identical. |
| 15 | M | `Modal` | Rendered inside `<main>` (`z-10` stacking context) while the sidebar is `z-20` → wide dialogs (Content, `size="xl"`) were **clipped under the sidebar** and the backdrop did not cover it. Latent before; obvious on the wide Content dialog. |
| 16 | L | `globals.css` | 420 ms `translateY` fade on every navigation delayed perceived paint. No global `:focus-visible` style. |

### Lists, filters, density

| # | Sev | Where | Problem |
|---|---|---|---|
| 17 | M | Jobs, Leads, Contacts, Invoices, Expenses, Equipment | Tables with `min-w-[720…1020px]` → horizontal scroll on phones. |
| 18 | M | all lists | No search, no filters (except Tasks/Invoices/Content tabs), no sorting, and chosen tab/filter forgotten on navigation. |
| 19 | M | Projects, Clients, Brands, Shoots | Big cards for 3–5 short fields; Shoots sorted oldest-first so upcoming shoots were buried under past ones. |
| 20 | M | Dashboard | "Tahsil edilen / Bu ay gider / Net" tiles duplicated the "Aylık net" panel; "Yaklaşan çekimler" listed **past and cancelled** shoots; open tasks were unsorted; quick actions only navigated to a list; blank page while loading. |
| 21 | L | list pages | 4 × `StatCard` (~130 px) pushed the data below the fold. |
| 22 | L | Invoices/Content/Tasks/MonthFilter | Four different tab/chip styles. |

### Accessibility / mobile

| # | Sev | Where | Problem |
|---|---|---|---|
| 23 | M | inputs | `text-sm` (14 px) → iOS Safari zooms the page on focus. |
| 24 | L | row actions | Icon buttons without `aria-label`, 28 px hit area; Tasks circle 20 px. |
| 25 | L | Toaster | Live region unmounted when empty (screen readers can miss the first toast). |
| 26 | L | Login | `<label>` not bound to inputs, no `autocomplete`. |
| 27 | L | Ads | Raw Supabase error text overflowed horizontally on 390 px. |

---

## 2. Changes made

Commits (in order): `c3c74fe` foundation/shell · `72e2bec` Dashboard+Tasks · `af24d69` Projects+Jobs · `17ae9ea` CRM · `a5e50c6` Content+Shoots · `d5ea402` Finance · `563def0` Equipment · `aacc91a` Settings/login · `2ce7230` modal portal + Ads wrap · (audit doc/last polish in the final commit).

### Shared building blocks (reuse, not a design system)

- `components/form.tsx`
  - **`Modal`**: `role=dialog|alertdialog`, `aria-labelledby`, focus in/out, Tab trap, Escape only closes the top-most dialog, mobile bottom sheet / desktop centred, portal to `body` (#15), `locked` while saving.
  - **`FormModal`**: the create/edit contract. `onSubmit` returns `{ok:false,error}` → modal **stays open, values preserved, error shown in the footer**; button shows `Kaydediliyor…`; second Enter/click while in flight is ignored; success toast; autofocus (skipped on touch devices so the keyboard doesn't cover the form). Validation errors use the same path.
  - **`useFormState`** (`f.text/num/bool`) — form state lives *inside* the modal; modals are mounted only while open (`{modal && <XModal/>}`), so state is fresh per open and typing never re-renders the page list.
  - `Button` (`loading`, default `type="button"`), `MoreFields` (native `<details>` for optional fields), inputs at 16 px on mobile.
- `components/list.tsx`: **`DataTable`** (compact table ≥ md, card list on mobile, click-to-sort headers with `aria-sort`, primary cell is a real button that opens edit), `RowActions`, `StatusSelect` (badge look + native select), `Tabs` (arrow-key nav), `FilterChips`, `SearchBox` (+`useListSearch`, `useDeferredValue`, Turkish-locale), `usePersistentState` (remembered tab/filter), `useNewIntent` (`?new=1`), `PageLoading` skeleton.
- `components/confirm.tsx`: `ConfirmDialog` (focus on "Vazgeç", cascade warning) + `useDeleteConfirm`; `store.remove` now returns a result and **restores the row on failure**.
- `lib/mutate.ts`: `patchRecord` for inline edits — failures now toast (#8).
- `ui.tsx`: `StatStrip` (compact summary, ~64 px vs ~130 px), `EmptyState` gets an in-page `action`, tighter `PageHeader`/`Panel`.

### Shell / navigation

- Mobile topbar shows the current section name; drawer is a proper dialog with close button + Escape.
- `NavProgress`: thin top bar for **any** internal link click (150 ms delay, disappears when the path changes). It only listens to clicks — **no prefetch, no extra requests**.
- Per-route `<title>` via `layout.tsx` metadata ("Görevler · Rast OS"); skip-to-content link; `aria-label` on nav; Topbar search renamed/behaves honestly ("Ekrana git…", Enter opens first match), popovers close on Escape, `LogOut` icon instead of a glyph.
- Page transition 420 ms → 140 ms, opacity only. Global `:focus-visible` ring. Toaster live region always mounted.
- Sidebar density: item height ≈ 42 → 38 px on desktop so more of the menu fits without scrolling (mobile keeps the taller targets).

### Pages

| Page | Changes |
|---|---|
| **Dashboard** | Skeleton instead of blank; removed 3 duplicate tiles (8 → 5); "Yaklaşan çekimler" = today-or-later & not completed/cancelled; open tasks sorted overdue-first with due labels and "N gecikmiş" in the title; quick actions open the *create* modal directly (`?new=1`) and "Yeni görev" opens Quick Add. |
| **Tasks** | Shared `Tabs` (arrow keys), remembered tab, search, in-page empty-state CTA, bigger touch targets on the completion circle/chips. Quick Add untouched. |
| **Projects** | Card grid → sortable table; scope chips Aktif/Kapanan/Tümü (remembered), search, inline status, delete warns about cascaded tasks; create form = name/client/brand/status/end date, rest under "Ek alanlar". |
| **Jobs** | Table + `StatStrip`, chips (Tümü/Devam eden/Tahsilat bekleyen), search, "Kalan ₺x" under paid amount, minimal form. |
| **CRM** | Leads: chips + search + overdue follow-up highlight + inline stage. Pipeline: click card to edit, "Yeni Lead" here too (shared `LeadModal`), follow-up dates, snap-scroll columns on mobile. Clients: table, contract-expiry warnings (≤ 30 days / expired), inline active toggle, brand-cascade warning. Brands (client now required), Contacts (`tel:`/`mailto:` links): tables + search. |
| **Content** | Form/upload isolated into `ContentModal`; `brandMap` (O(1)); calendar grouped by month, overdue marker, Aktif/Yayınlanan/Tümü chips + search; nested file-preview modal closes independently. |
| **Shoots** | Yaklaşan/Geçmiş/Tümü tabs (upcoming nearest-first), table, timestamptz edit fix (#3). |
| **Finance** | Tables + `StatStrip`; new records default to today (#5); invoice modal shows total/remaining + "Tamamı tahsil edildi"; expenses: one-click "Ödendi işaretle" for pending rows, merged TL-equivalent into the amount cell (9 → 7 columns), secondary fields collapsed, remembered period; empty states with CTA. |
| **Equipment** | Status chips + search, maintenance-due warnings, "Envantere al" with toast, delete confirm. |
| **Settings / Login / Ads** | Settings init fix + editable FX fields (#10); login labels/autocomplete/16 px inputs; Ads error wraps. |

---

## 3. Performance-sensitive decisions

- **No new hydration or loads.** Each page still calls `useHydrated([...same collections...])`. Settings now calls `useHydrated()` with *no* collections (session/mode init only).
- **Links**: every `<Link>` (incl. new dashboard/invoice/equipment ones) keeps `prefetch={false}`. `NavProgress` is a click listener, not a router hook.
- **Search** uses `useDeferredValue` + a single O(N) pass; **filters/tab counts** are single-pass `useMemo`s; sort is O(N log N) only for the clicked column.
- **DataTable renders one layout** (table *or* cards, via `matchMedia` + `useSyncExternalStore`) so the DOM is not doubled.
- **Form state isolation**: modals own their state and mount only while open → no page re-render per keystroke (also fixed for Content, which had regressed on this).
- **Persisted tab/filter** reads `localStorage` once in a `useState` initializer inside pages that render nothing but a skeleton until `hydrated` → no SSR/hydration mismatch, no effect-driven flash.
- **Modals wait for the server result** (≈ one Tokyo round-trip in prod) instead of closing optimistically, *deliberately*: otherwise a failed save cannot keep the user's values. The list underneath still updates optimistically (store unchanged), and inline edits/deletes remain fully optimistic. Quick Add keeps its optimistic path.
- Removed a 420 ms transform animation per navigation; modal backdrop no longer uses `backdrop-blur`. No WebGL / `AmbientScene` (file still exists, unused, as before).
- **Not measured on prod** (no prod login by policy). Local demo mode only; expect no change in request count, but timings were not re-measured.

---

## 4. Validation done

Real Chrome (1440 × ~790) against `next dev` in demo mode; mobile 375 / 390 / 430 px and 1240 px via a scratch iframe harness (Chrome window resizing was not honoured in this environment, so media queries were exercised through iframe width; `pointer: coarse` behaviour — e.g. skipping autofocus on touch — could **not** be tested this way).

- Navigated every page; opened/closed modals; typed; Enter to save; success toast; delete confirm; Escape; focus returned to the trigger.
- **Failure path** verified with a temporary store hook (removed before commit): button → `Kaydediliyor…`, then modal stays open, typed value preserved, error in footer.
- `?new=1` opens the create modal and strips the param; Invoice create shows the row immediately (default date).
- Tasks Quick Add: `Q` → type → Enter → task in list + "Görev eklendi · Görevlere git" toast.
- Scripted a11y sweep over 14 pages (Dashboard, Tasks, Jobs, Projects, CRM ×5, Content, Shoots, Expenses, Equipment, Settings): 0 buttons/links/inputs without an accessible name (only the intentionally `aria-hidden` date inputs inside `TaskRow`); one `<h1>` on the 5 pages where it was counted. Invoices was checked manually only.
- Console: `read_console_messages` (errors only) returned nothing when checked after the main flows.
- Mobile: scripted check at 375 px on **19 routes**: `main`/document horizontal overflow = 0 on all (Pipeline scrolls inside its own container by design). Drawer + bottom-sheet modal verified visually at 390/430; tables become cards.
- **No new automated tests** were added (UI-only; the 10 existing `taskLogic` tests still pass). The shared pieces (`FormModal`, `DataTable`, `usePersistentState`) are good candidates for component tests if a DOM test runner is ever added.

---

## 5. Deferred / remaining UX debt

**High impact**
1. **Notifications bell** (`Topbar`) derives from whichever collections happen to be loaded (invoices/expenses/tasks/contents), so it is empty until those pages have been visited. A real fix needs a lightweight server-side count/RPC — not a startup load, hence not done.
2. **Global record search** (customers/projects/content) does not exist; only screen-jump. Needs a server search endpoint.
3. **Schema discrepancy to confirm on prod:** `TASKS-UX.md` says `tasks.assignee` doesn't exist, but migration `0002` adds it as text. The dashboard no longer shows the assignee (it now shows the due date) so nothing depends on it, but the truth should be checked.
4. **Deleting a content item leaves its Storage files orphaned** (pre-existing; `remove` only deletes the row).

**Medium**
5. Ads and Import pages were only touched for error wrapping; they still use their own layouts/controls.
6. Files page is still a "yakında" placeholder in the main menu.
7. Client modal keeps text dates (`GG.AA.YYYY`) while every other form uses native date inputs.
8. Invoices: one-off job rows can only be edited on Tekil İşler (link provided); invoice status/paid amount are still independent (no auto-derivation, unchanged business logic).
9. Modal saves are not optimistic-close (see §3) — perceived ~300–400 ms wait on prod for creates.
10. No bulk actions, no column visibility, no saved multi-filter views; the month picker isn't persisted (mode is).
11. Legacy: `src/lib/useCollections.ts` (unused hook, 1 lint error) and `AmbientScene.tsx` (unused) could be deleted; not done to stay in scope.

**Low**
12. Keyboard shortcuts are still only `Q` and `Ctrl/⌘ K`; no "g then x" navigation.
13. Demo-mode "Kurulum bekliyor" banner is tall on mobile (demo only; not shown in prod).
14. `TaskRow` chips are 28 px on mobile (was 24); the row still packs many controls on 375 px.
