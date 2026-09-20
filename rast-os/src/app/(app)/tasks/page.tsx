"use client";

import { useState, useMemo, memo } from "react";
import { Plus } from "lucide-react";
import { PageHeader, Badge } from "@/components/ui";
import { Modal, Field, Input, Select, Button } from "@/components/form";
import { useStore, useHydrated, uid, nowISO } from "@/lib/store";
import { taskStatus, taskBoard, priority as prioMap, dateTR } from "@/lib/labels";
import type { Task, TaskStatus, Priority, Project } from "@/lib/types";

const empty: Task = {
  id: "", project_id: "", title: "", assignee: "", due_date: "",
  priority: "medium", status: "todo", created_at: "",
};

const NewTaskModal = memo(function NewTaskModal({ open, onClose, projects }: { open: boolean, onClose: () => void, projects: Project[] }) {
  const [form, setForm] = useState<Task>(empty);
  const add = useStore((s) => s.add);

  function save() {
    if (!form.title.trim()) return;
    add("tasks", { ...form, id: uid(), created_at: nowISO() });
    setForm({ ...empty });
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Yeni görev"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Vazgeç</Button>
          <Button onClick={save}>Kaydet</Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field label="Görev başlığı *">
            <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </Field>
        </div>
        <Field label="Proje">
          <Select value={form.project_id} onChange={(e) => setForm({ ...form, project_id: e.target.value })}>
            <option value="">Seçin</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </Field>
        <Field label="Sorumlu">
          <Input value={form.assignee} onChange={(e) => setForm({ ...form, assignee: e.target.value })} />
        </Field>
        <Field label="Son tarih">
          <Input type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} />
        </Field>
        <Field label="Öncelik">
          <Select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value as Priority })}>
            <option value="low">Düşük</option>
            <option value="medium">Orta</option>
            <option value="high">Yüksek</option>
            <option value="urgent">Acil</option>
          </Select>
        </Field>
      </div>
    </Modal>
  );
});

export default function TasksPage() {
  const hydrated = useHydrated(["tasks", "projects"]);
  const tasks = useStore((s) => s.tasks);
  const projects = useStore((s) => s.projects);
  const update = useStore((s) => s.update);

  const [open, setOpen] = useState(false);

  // O(1) project lookups
  const projectMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of projects) {
      map.set(p.id, p.name);
    }
    return map;
  }, [projects]);
  
  // O(N) grouping by column before render
  const columns = useMemo(() => {
    const cols: Record<string, Task[]> = {};
    for (const col of taskBoard) cols[col] = [];
    if (hydrated) {
      for (const t of tasks) {
        if (cols[t.status]) {
           cols[t.status].push(t);
        }
      }
    }
    return cols;
  }, [tasks, hydrated]);

  if (!hydrated) return <PageHeader title="Görevler" subtitle="Yükleniyor…" />;

  return (
    <>
      <PageHeader
        title="Görevler"
        subtitle="Bekliyor → Yapılıyor → İç kontrol → Müşteri onayı → Revize → Tamamlandı"
        action={
          <Button onClick={() => setOpen(true)}>
            <span className="flex items-center gap-1.5"><Plus className="h-4 w-4" /> Yeni Görev</span>
          </Button>
        }
      />

      <div className="flex gap-3 overflow-x-auto pb-4">
        {taskBoard.map((col) => {
          const items = columns[col] || [];
          return (
            <div key={col} className="flex w-64 shrink-0 flex-col">
              <div className="mb-2 flex items-center justify-between px-1">
                <span className="text-xs font-semibold text-foreground">{taskStatus[col as keyof typeof taskStatus].label}</span>
                <span className="text-xs text-muted">{items.length}</span>
              </div>
              <div className="flex-1 space-y-2 rounded-lg bg-surface/40 p-2">
                {items.map((t) => {
                  const projectName = projectMap.get(t.project_id || "");
                  return (
                    <div key={t.id} className="card p-3">
                      <p className="text-sm font-medium text-foreground">{t.title}</p>
                      {projectName && <p className="mt-0.5 text-xs text-muted">{projectName}</p>}
                      <div className="mt-2 flex items-center justify-between">
                        <Badge tone={prioMap[t.priority as keyof typeof prioMap].tone}>{prioMap[t.priority as keyof typeof prioMap].label}</Badge>
                        <span className="text-[11px] text-muted">{dateTR(t.due_date)}</span>
                      </div>
                      <select
                        value={t.status}
                        onChange={(e) => update("tasks", t.id, { status: e.target.value as TaskStatus })}
                        className="mt-2 w-full rounded-md border border-border bg-background px-2 py-1 text-xs text-muted outline-none focus:border-amber/60"
                      >
                        {taskBoard.map((st) => (
                          <option key={st} value={st}>{taskStatus[st as keyof typeof taskStatus].label}</option>
                        ))}
                      </select>
                    </div>
                  );
                })}
                {items.length === 0 && <p className="px-1 py-4 text-center text-xs text-muted">—</p>}
              </div>
            </div>
          );
        })}
      </div>

      <NewTaskModal open={open} onClose={() => setOpen(false)} projects={projects} />
    </>
  );
}
