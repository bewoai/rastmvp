"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { PageHeader, EmptyState } from "@/components/ui";
import { Button } from "@/components/form";
import { FilterChips, PageLoading, SearchBox, Tabs, Toolbar, useListSearch, useOpenIntent, usePersistentState } from "@/components/list";
import TaskRow from "@/components/TaskRow";
import { useStore, useHydrated } from "@/lib/store";
import { useQuickAdd } from "@/lib/quickAdd";
import { useToday } from "@/lib/useToday";
import { addDaysKey, bucketTasks, groupTasks, sortTasks } from "@/lib/taskLogic";
import type { TaskView } from "@/lib/taskLogic";
import { assignableMembers, createAssigneeResolver, filterByOwner } from "@/lib/assignee-logic";

const VIEWS: { id: TaskView; label: string }[] = [
  { id: "today", label: "Bugün" },
  { id: "upcoming", label: "Yaklaşan" },
  { id: "all", label: "Tümü" },
  { id: "completed", label: "Tamamlanan" },
];
const VIEW_IDS = VIEWS.map((v) => v.id);

type Owner = "all" | "mine";
const OWNERS: readonly Owner[] = ["all", "mine"];

const EMPTY: Record<TaskView, { title: string; hint: string }> = {
  today: { title: "Bugün için görev yok", hint: "Q'ya basıp yeni görev ekleyebilirsin." },
  upcoming: { title: "Yaklaşan görev yok", hint: "Tarihi ileride olan görevler burada görünür." },
  all: { title: "Açık görev yok", hint: "Q'ya basıp ilk görevini ekle." },
  completed: { title: "Tamamlanan görev yok", hint: "Tamamladığın görevler burada görünür." },
};

// `?ac=<görev id>` (Ctrl/⌘K kayıt araması) için useSearchParams → statik sayfada Suspense sınırı gerekir.
export default function TasksPage() {
  return (
    <Suspense fallback={<PageLoading title="Görevler" rows={8} />}>
      <TasksList />
    </Suspense>
  );
}

function TasksList() {
  const hydrated = useHydrated(["tasks", "projects", "profiles"]);
  const tasks = useStore((s) => s.tasks);
  const projects = useStore((s) => s.projects);
  const team = useStore((s) => s.profiles);
  const userId = useStore((s) => s.userId);
  const openComposer = useQuickAdd((s) => s.openComposer);
  const today = useToday();
  // "Tümü" varsayılan: tarihsiz dahil her açık görev görünür (başka sayfadan Q ile eklenen de).
  // Seçilen görünüm ve sorumlu süzgeci hatırlanır: başka sayfaya gidip dönünce aynı yerde kalınır.
  const [view, setView] = usePersistentState<TaskView>("tasks-view", "all", VIEW_IDS);
  const [owner, setOwner] = usePersistentState<Owner>("tasks-owner", "all", OWNERS);
  const [query, setQuery] = useState("");

  // Aramadan gelinen görev (`?ac=`): görünür olacağı görünüme geçilir, süzgeçler geçici olarak açılır, satır vurgulanır.
  const intent = useOpenIntent(tasks);
  const target = hydrated ? intent.target : undefined;
  const [handledId, setHandledId] = useState<string | null>(null);
  const [focusView, setFocusView] = useState<TaskView | null>(null);
  const [everyone, setEveryone] = useState(false);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  if (target && handledId !== target.id) {
    setHandledId(target.id);
    setFocusView(target.status === "done" ? "completed" : "all");
    setEveryone(true);
    setQuery("");
    setHighlightId(target.id);
  } else if (!target && intent.openId === null && handledId !== null) {
    setHandledId(null); // aynı görev yeniden aranırsa tekrar vurgulansın
  }
  const activeView = focusView ?? view;

  const members = useMemo(() => assignableMembers(team), [team]);
  const resolve = useMemo(() => createAssigneeResolver(team), [team]);
  // Oturum bilinmiyorsa (userId yok) sorumlu süzgeci gösterilmez.
  const ownerMode: Owner = !userId || everyone ? "all" : owner;

  // O(1) proje adı araması
  const projectMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of projects) map.set(p.id, p.name);
    return map;
  }, [projects]);

  const ownerCounts = useMemo(() => {
    const open = tasks.filter((t) => t.status !== "done");
    return { all: open.length, mine: filterByOwner(open, "mine", userId, team).length };
  }, [tasks, userId, team]);

  // Tüm görünümler tek O(N) geçişte; yalnızca aktif görünüm sıralanır/gruplanır.
  const scoped = useMemo(() => filterByOwner(hydrated ? tasks : [], ownerMode, userId, team), [hydrated, tasks, ownerMode, userId, team]);
  const buckets = useMemo(() => bucketTasks(scoped, today), [scoped, today]);
  // Arama yalnızca aktif görünümü süzer (sekme sayıları etkilenmez); yazarken TaskRow'lar memo ile korunur.
  const searched = useListSearch(buckets[activeView], query, (t) => `${t.title} ${t.project_id ? projectMap.get(t.project_id) ?? "" : ""} ${t.assignee ?? ""}`);
  const groups = useMemo(
    () => groupTasks(activeView, sortTasks(activeView, searched), today),
    [searched, activeView, today],
  );

  // Quick Add: varsayılan son tarih görünüme göre; "Bana atanan" görünümünde yeni görev bana atanır (listeden kaybolmasın).
  useEffect(() => {
    const due = activeView === "today" ? today : activeView === "upcoming" ? addDaysKey(today, 1) : "";
    const qa = useQuickAdd.getState();
    qa.setDefaultDue(due);
    qa.setDefaultAssignee(ownerMode === "mine" && userId ? userId : "");
    return () => {
      const s = useQuickAdd.getState();
      s.setDefaultDue("");
      s.setDefaultAssignee("");
    };
  }, [activeView, today, ownerMode, userId]);

  // Vurgulanan göreve kaydır, `?ac=` parametresini kaldır, 2,5 sn sonra vurguyu söndür.
  const dismissRef = useRef(intent.dismiss);
  useEffect(() => {
    dismissRef.current = intent.dismiss;
  });
  useEffect(() => {
    if (!highlightId) return;
    const el = document.getElementById(`task-${highlightId}`);
    el?.scrollIntoView({ block: "center" });
    el?.querySelector<HTMLElement>("button[title]")?.focus({ preventScroll: true });
    dismissRef.current();
    const timer = setTimeout(() => setHighlightId(null), 2500);
    return () => clearTimeout(timer);
  }, [highlightId]);

  if (!hydrated) return <PageLoading title="Görevler" rows={8} />;

  return (
    <>
      <PageHeader
        title="Görevler"
        subtitle="Hızlı ekle için Q'ya bas. Başlığa tıklayarak düzenle, daireye tıklayarak tamamla."
        action={
          <Button className="max-md:hidden" onClick={openComposer}>
            <span className="flex items-center gap-1.5">
              <Plus className="h-4 w-4" /> Yeni Görev
              <kbd className="ml-1 rounded border border-black/25 px-1 text-[11px] font-semibold leading-4">Q</kbd>
            </span>
          </Button>
        }
      />

      <Toolbar>
        <Tabs
          label="Görev görünümleri"
          value={activeView}
          onChange={(v) => { setFocusView(null); setView(v); }}
          className="w-full sm:w-auto"
          tabs={VIEWS.map((v) => ({ id: v.id, label: v.label, count: buckets[v.id].length }))}
        />
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          {userId && (
            <FilterChips
              label="Sorumlu"
              value={ownerMode}
              onChange={(o) => { setEveryone(false); setOwner(o); }}
              options={[
                { id: "all", label: "Herkes", count: ownerCounts.all },
                { id: "mine", label: "Bana atanan", count: ownerCounts.mine },
              ]}
            />
          )}
          <SearchBox value={query} onChange={setQuery} placeholder="Görev ara…" label="Görev ara" />
        </div>
      </Toolbar>

      {groups.length === 0 ? (
        query ? (
          <EmptyState title="Eşleşen görev yok" hint="Aramayı değiştir veya başka bir görünüme bak." />
        ) : ownerMode === "mine" ? (
          <EmptyState title="Sana atanmış görev yok" hint="“Herkes”e geçerek ekibin görevlerini gör ya da Q ile kendine görev ekle." action={{ label: "Herkesi göster", onClick: () => setOwner("all") }} />
        ) : (
          <EmptyState title={EMPTY[activeView].title} hint={EMPTY[activeView].hint} action={activeView !== "completed" ? { label: "Yeni Görev", onClick: openComposer } : undefined} />
        )
      ) : (
        <div role="tabpanel" aria-label="Görev listesi" className="space-y-5 pb-24 md:pb-4">
          {groups.map((g) => (
            <section key={g.id} aria-label={g.label || undefined}>
              {g.label && (
                <h2 className="mb-1 flex items-baseline gap-2 px-2 text-xs font-semibold text-foreground">
                  {g.label}
                  <span className="font-normal text-muted">{g.tasks.length}</span>
                </h2>
              )}
              <ul className="divide-y divide-border/40">
                {g.tasks.map((t) => (
                  <TaskRow
                    key={t.id}
                    task={t}
                    projectName={t.project_id ? projectMap.get(t.project_id) : undefined}
                    today={today}
                    assignee={resolve(t)}
                    members={members}
                    highlight={t.id === highlightId}
                  />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {/* Mobil: klavye/Q yok — sabit + Yeni Görev */}
      <button
        type="button"
        onClick={openComposer}
        aria-label="Yeni görev"
        className="btn-accent fixed bottom-5 right-5 z-30 flex items-center gap-2 rounded-full px-5 py-3.5 text-sm font-semibold md:hidden"
      >
        <Plus className="h-5 w-5" /> Yeni Görev
      </button>
    </>
  );
}
