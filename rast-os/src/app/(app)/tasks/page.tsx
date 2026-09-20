"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { PageHeader, EmptyState } from "@/components/ui";
import { Button } from "@/components/form";
import { PageLoading, SearchBox, Tabs, Toolbar, useListSearch, usePersistentState } from "@/components/list";
import TaskRow from "@/components/TaskRow";
import { useStore, useHydrated } from "@/lib/store";
import { useQuickAdd } from "@/lib/quickAdd";
import { useToday } from "@/lib/useToday";
import { addDaysKey, bucketTasks, groupTasks, sortTasks } from "@/lib/taskLogic";
import type { TaskView } from "@/lib/taskLogic";

const VIEWS: { id: TaskView; label: string }[] = [
  { id: "today", label: "Bugün" },
  { id: "upcoming", label: "Yaklaşan" },
  { id: "all", label: "Tümü" },
  { id: "completed", label: "Tamamlanan" },
];
const VIEW_IDS = VIEWS.map((v) => v.id);

const EMPTY: Record<TaskView, { title: string; hint: string }> = {
  today: { title: "Bugün için görev yok", hint: "Q'ya basıp yeni görev ekleyebilirsin." },
  upcoming: { title: "Yaklaşan görev yok", hint: "Tarihi ileride olan görevler burada görünür." },
  all: { title: "Açık görev yok", hint: "Q'ya basıp ilk görevini ekle." },
  completed: { title: "Tamamlanan görev yok", hint: "Tamamladığın görevler burada görünür." },
};

export default function TasksPage() {
  const hydrated = useHydrated(["tasks", "projects"]);
  const tasks = useStore((s) => s.tasks);
  const projects = useStore((s) => s.projects);
  const openComposer = useQuickAdd((s) => s.openComposer);
  const today = useToday();
  // "Tümü" varsayılan: tarihsiz dahil her açık görev görünür (başka sayfadan Q ile eklenen de).
  // Seçilen görünüm hatırlanır: başka sayfaya gidip dönünce aynı sekmede kalınır.
  const [view, setView] = usePersistentState<TaskView>("tasks-view", "all", VIEW_IDS);
  const [query, setQuery] = useState("");

  // O(1) proje adı araması
  const projectMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of projects) map.set(p.id, p.name);
    return map;
  }, [projects]);

  // Tüm görünümler tek O(N) geçişte; yalnızca aktif görünüm sıralanır/gruplanır.
  const buckets = useMemo(() => bucketTasks(hydrated ? tasks : [], today), [tasks, hydrated, today]);
  // Arama yalnızca aktif görünümü süzer (sekme sayıları etkilenmez); yazarken TaskRow'lar memo ile korunur.
  const searched = useListSearch(buckets[view], query, (t) => `${t.title} ${t.project_id ? projectMap.get(t.project_id) ?? "" : ""}`);
  const groups = useMemo(
    () => groupTasks(view, sortTasks(view, searched), today),
    [searched, view, today],
  );

  // Quick Add, aktif görünümde anında görünsün diye varsayılan son tarihi görünüme göre ayarlar.
  useEffect(() => {
    const due = view === "today" ? today : view === "upcoming" ? addDaysKey(today, 1) : "";
    useQuickAdd.getState().setDefaultDue(due);
    return () => useQuickAdd.getState().setDefaultDue("");
  }, [view, today]);

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
              <kbd className="ml-1 rounded border border-black/25 px-1 text-[10px] font-semibold leading-4">Q</kbd>
            </span>
          </Button>
        }
      />

      <Toolbar>
        <Tabs
          label="Görev görünümleri"
          value={view}
          onChange={setView}
          className="w-full sm:w-auto"
          tabs={VIEWS.map((v) => ({ id: v.id, label: v.label, count: buckets[v.id].length }))}
        />
        <SearchBox value={query} onChange={setQuery} placeholder="Görev ara…" label="Görev ara" />
      </Toolbar>

      {groups.length === 0 ? (
        query ? (
          <EmptyState title="Eşleşen görev yok" hint="Aramayı değiştir veya başka bir görünüme bak." />
        ) : (
          <EmptyState title={EMPTY[view].title} hint={EMPTY[view].hint} action={view !== "completed" ? { label: "Yeni Görev", onClick: openComposer } : undefined} />
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
        className="btn-amber fixed bottom-5 right-5 z-30 flex items-center gap-2 rounded-full px-5 py-3.5 text-sm font-semibold md:hidden"
      >
        <Plus className="h-5 w-5" /> Yeni Görev
      </button>
    </>
  );
}
