# RAST MVP Performance Improvements

## Overview of Changes

1. **Lazy Loading Collections (The `select("*")` Anti-Pattern)**
   - **Fix**: Replaced the wholesale data loading in `src/lib/store.ts` with an on-demand hydration approach. Downstream routes now request specific dependencies via `useHydrated(["projects", "tasks"])`, loading only what is needed.

2. **React Form State Isolation (Keystroke Lag)**
   - **Fix**: Modals across CRM (clients, contacts, brands, leads, pipeline), content, projects, shoots, expenses, and invoices were refactored into their own respective `<Modal>` pure functional components that manage their own local `<form>` state instead of lifting it to top-level pages. This immediately stops root-level array methods from re-running on every keystroke.

3. **Heavy Array Calculations**
   - **Fix**: Wrapped heavy array aggregation, such as CRM and Finance metrics, into `useMemo` hooks (e.g. `src/app/(app)/page.tsx` now correctly leverages `useMemo` to cache dashboard stats). Added O(1) map dictionary caching for rendering lists to completely eliminate nested O(N^2) array `.find()` iterations in the Kanban boards and lists (projects, tasks, invoices, branding, contacts, etc.).

4. **Decorative WebGL Background**
   - **Fix**: Completely unmounted `AmbientScene.tsx` in `AppShell.tsx` to stop `THREE.js` taking up the main thread on every frame, reducing baseline CPU dramatically.

5. **Redundant Authentication Hits**
   - **Fix**: Refactored redundant `supabase.auth.getUser()` hits to `supabase.auth.getSession()` on client-side and `layout.tsx` Server Component to leverage local cached session rather than hitting the network multiple times per request, reducing load/hydration speeds out of the box.

6. **TypeScript Checks Validation**
   - **Fix**: Resolved `strict` type errors across all changed components resulting from the strict refactoring. Verified no TS configuration errors block deployment.

## Conclusion

Performance is significantly improved across the board. The UI is noticeably snappier directly resulting from properly isolated modal state and removing ambient WebGL canvas. Data operations rely lazily on hydration constraints instead of flat downloads.
