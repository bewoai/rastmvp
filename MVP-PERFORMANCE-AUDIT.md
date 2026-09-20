# RAST MVP Performance Audit

## Critical bottlenecks

**1. The `select("*")` Anti-Pattern on App Startup**
- **Evidence**: On any page refresh, `init()` waits for 12 parallel `select("*")` queries over all collections (tasks, projects, leads, clients, invoices, etc.) without limits. `useHydrated()` blocks rendering until all 12 finish.
- **Root Cause**: The application tries to copy the entire relational database into a client-side Zustand store on boot.
- **Expected Impact**: Extremely slow initial load times that degrade linearly as the database grows. Network payload explosion and blank screens while waiting for data.
- **Exact File(s)**: `src/lib/store.ts`

**2. Heavy Array Calculations within Render Cycles**
- **Evidence**: UI routes calculate complex aggregations directly in the component body (e.g. `jobs.filter(...).reduce(...)` on the Dashboard, `brands.filter(...).length` in Clients).
- **Root Cause**: Lack of SQL joins or `useMemo` hooks. Data is flattened into arrays and recalculated on every single render.
- **Expected Impact**: Substantial CPU work on the client side, causing jank and frozen frames on lower-end devices.
- **Exact File(s)**: `src/app/(app)/page.tsx`, `src/app/(app)/finance/invoices/page.tsx`, `src/app/(app)/crm/clients/page.tsx`

## High-impact quick wins

**1. Isolate Form State from List Renders (The Keystroke Lag)**
- **Evidence**: Typing inside a "New" or "Edit" modal heavily lags on routes with many records.
- **Root Cause**: `useState` for modal forms (e.g., `[form, setForm]`) is defined at the very top level of the page components (`TasksPage`, `ProjectsPage`). Every keystroke triggers `setForm`, which re-renders the *entire* page, re-running all array `.filter` and `.find` operations.
- **Expected Impact**: Moving the modals and their states into separate components (or children) will instantly fix typing lag and 100% CPU spikes during data entry.
- **Exact File(s)**: `src/app/(app)/tasks/page.tsx`, `src/app/(app)/projects/page.tsx`, `src/app/(app)/finance/invoices/page.tsx`, `src/app/(app)/crm/clients/page.tsx`

**2. Decorative WebGL Background (Three.js)**
- **Evidence**: `AmbientScene` uses `THREE.WebGLRenderer` running on a continuous `requestAnimationFrame` loop.
- **Root Cause**: A heavy 3D rendering canvas is mounted globally behind the application shell.
- **Expected Impact**: Disabling or optimizing the ambient scene will drastically reduce baseline CPU/GPU usage, improving battery life and freeing the main thread for React's data mapping.
- **Exact File(s)**: `src/components/AmbientScene.tsx`, `src/components/AppShell.tsx`

## Supabase/query issues

**1. Redundant Authentication Hits**
- **Evidence**: `await supabase.auth.getUser()` is called sequentially in 3 different contexts per initial load.
- **Root Cause**: It runs inside `middleware.ts`, `layout.tsx` (server-side), and `init()` in `store.ts` (client-side). 
- **Expected Impact**: Unnecessary network latency to the Supabase Auth API delaying the server response and the client hydration.
- **Exact File(s)**: `src/lib/supabase/middleware.ts`, `src/app/(app)/layout.tsx`, `src/lib/store.ts`

**2. Missing Joins & Relational Fetches**
- **Evidence**: Foreign keys aren't resolved in Supabase queries. (e.g., matching a client to an invoice).
- **Root Cause**: Using flat `select("*")` on every table instead of `select("*, clients(name)")`. 
- **Expected Impact**: Results in O(N*M) lookups on the frontend using `Array.find` or `Array.filter` within React `.map` calls.
- **Exact File(s)**: `src/lib/store.ts`, individual route pages.

## Zustand/state issues

**1. God-Store Subscriptions**
- **Evidence**: Pages like `DashboardPage` invoke `const s = useStore();` without selector functions.
- **Root Cause**: Doing this subscribes the component to *every* change in the store. If a background job updates a task, the dashboard completely re-renders even if it only cares about invoices.
- **Expected Impact**: Unnecessary re-renders across the application when parallel state updates occur.
- **Exact File(s)**: `src/app/(app)/page.tsx`

## Bundle/component issues

**1. Dynamic Heavy Dependencies**
- **Evidence**: Libraries like `xlsx` and `pdfjs-dist` are used for imports.
- **Root Cause**: While `xlsx` is dynamically imported (`await import("xlsx")`), it poses a risk of locking the main thread during heavy Excel parsing on the client.
- **Expected Impact**: Safe for initial payload sizes, but could crash the tab during large file imports due to memory spikes.
- **Exact File(s)**: `src/app/(app)/import/page.tsx`, `src/app/api/content-files/extract/route.ts`

## Task-page specific issues

**1. Kanban Rendering Complexity**
- **Evidence**: The Kanban columns iterate through the same massive `tasks` array 6 separate times (once per `taskBoard` column).
- **Root Cause**: `taskBoard.map((col) => tasks.filter(t => t.status === col))`
- **Expected Impact**: Instead of grouping tasks in `O(N)` via `useMemo` once, it performs 6 full iterations per render. With the form state located in the root component, this happens on *every keystroke* when creating a new task.
- **Exact File(s)**: `src/app/(app)/tasks/page.tsx`

**2. Nested `.find` Locators**
- **Evidence**: Inside the task card loop, `projects.find((p) => p.id === t.project_id)` is invoked.
- **Root Cause**: Relational mappings should use HashMaps/Dictionaries (e.g., `{ [id]: Project }`), not array `.find()` in O(N) for every single card.
- **Expected Impact**: O(N*M) complexity on rendering delays the frame wildly when both projects and tasks arrays are large.
- **Exact File(s)**: `src/app/(app)/tasks/page.tsx`

## Recommended implementation order

1. **Immediate fix:** Extract modal form state (`useState<Task>`, etc.) into separate child components or decouple them from the main page render trees to immediately prevent keystroke lag across all CRM and Task routes.
2. **Immediate fix:** Turn off or heavily throttle `AmbientScene.tsx` when interacting with data-heavy pages.
3. **Mid-term:** Replace array `.find()` lookups with HashMaps (`useMemo`) or use Supabase `select` joins to relieve O(N*M) bottlenecks (e.g., Kanban boards).
4. **Mid-term:** Add proper selectors to `useStore` in `page.tsx` to stop unrelated data from triggering dashboard re-renders. Use `useMemo` for derived financial aggregations.
5. **Long-term (Refactor required):** Move away from the global `select("*")` on startup. Implement Server Components / React Server Functions to fetch only the paginated data required for the active route, shifting to a more standard Next.js App Router architecture.
