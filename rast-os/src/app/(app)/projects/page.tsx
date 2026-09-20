"use client";

import { useState, useMemo, memo } from "react";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { PageHeader, Badge } from "@/components/ui";
import { Modal, Field, Input, Select, Button } from "@/components/form";
import { useStore, useHydrated, uid, nowISO } from "@/lib/store";
import { projectStatus, priority as prioMap, TRY, dateTR } from "@/lib/labels";
import type { Project, ProjectStatus, Priority, Client, Brand } from "@/lib/types";

const empty: Project = {
  id: "", client_id: "", brand_id: "", name: "", type: "", owner: "",
  start_date: "", end_date: "", budget: undefined, status: "planning",
  priority: "medium", notes: "", created_at: "",
};

const ProjectModal = memo(function ProjectModal({
  open, onClose, initial, clients, brands
}: {
  open: boolean, onClose: () => void, initial: Project | null, clients: Client[], brands: Brand[]
}) {
  const [form, setForm] = useState<Project>(empty);
  const editing = Boolean(form.id);
  
  // Update local form state when initial changes
  useMemo(() => {
    if (open) setForm(initial || empty);
  }, [open, initial]);

  const add = useStore((s) => s.add);
  const update = useStore((s) => s.update);

  function save() {
    if (!form.name.trim()) return;
    if (editing) update("projects", form.id, form);
    else add("projects", { ...form, id: uid(), created_at: nowISO() });
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? "Proje düzenle" : "Yeni proje"}
      footer={<><Button variant="ghost" onClick={onClose}>Vazgeç</Button><Button onClick={save}>Kaydet</Button></>}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field label="Proje adı *"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
        </div>
        <Field label="Müşteri">
          <Select value={form.client_id} onChange={(e) => setForm({ ...form, client_id: e.target.value, brand_id: "" })}>
            <option value="">Seçin</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
        <Field label="Marka">
          <Select value={form.brand_id} onChange={(e) => setForm({ ...form, brand_id: e.target.value })}>
            <option value="">Seçin</option>
            {brands.filter((b) => !form.client_id || b.client_id === form.client_id).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
        </Field>
        <Field label="Tür"><Input value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} placeholder="Aylık yönetim, video…" /></Field>
        <Field label="Sorumlu"><Input value={form.owner} onChange={(e) => setForm({ ...form, owner: e.target.value })} /></Field>
        <Field label="Başlangıç"><Input type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} /></Field>
        <Field label="Bitiş"><Input type="date" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} /></Field>
        <Field label="Bütçe (₺)"><Input type="number" value={form.budget ?? ""} onChange={(e) => setForm({ ...form, budget: e.target.value ? Number(e.target.value) : undefined })} /></Field>
        <Field label="Durum">
          <Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as ProjectStatus })}>
            {Object.entries(projectStatus).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </Select>
        </Field>
        <Field label="Öncelik">
          <Select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value as Priority })}>
            <option value="low">Düşük</option><option value="medium">Orta</option><option value="high">Yüksek</option><option value="urgent">Acil</option>
          </Select>
        </Field>
      </div>
    </Modal>
  );
});

export default function ProjectsPage() {
  const hydrated = useHydrated(["projects", "clients", "tasks", "brands"]);
  const projects = useStore((s) => s.projects);
  const clients = useStore((s) => s.clients);
  const brands = useStore((s) => s.brands);
  const tasks = useStore((s) => s.tasks);
  const remove = useStore((s) => s.remove);

  const [open, setOpen] = useState(false);
  const [initialForm, setInitialForm] = useState<Project | null>(null);

  // O(1) lookups
  const { clientMap, taskCounts } = useMemo(() => {
    const _clientMap = new Map<string, string>();
    for (const c of clients) _clientMap.set(c.id, c.name);

    const _taskCounts = new Map<string, number>();
    for (const t of tasks) {
      if (t.status !== "done") {
        _taskCounts.set(t.project_id || "", ((t.project_id ? _taskCounts.get(t.project_id) : 0) || 0) + 1);
      }
    }
    return { clientMap: _clientMap, taskCounts: _taskCounts };
  }, [clients, tasks]);

  if (!hydrated) return <PageHeader title="Projeler" subtitle="Yükleniyor…" />;

  return (
    <>
      <PageHeader
        title="Projeler"
        subtitle="Müşteri projeleri, durum, bütçe ve teslim takibi"
        action={
          <Button onClick={() => { setInitialForm(empty); setOpen(true); }}>
            <span className="flex items-center gap-1.5"><Plus className="h-4 w-4" /> Yeni Proje</span>
          </Button>
        }
      />

      <div className="grid gap-3 md:grid-cols-2">
        {projects.map((p) => {
          const clientName = clientMap.get(p.client_id || "") || "—";
          const openTasks = taskCounts.get(p.id) || 0;
          return (
            <div key={p.id} className="card p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold text-foreground">{p.name}</p>
                  <p className="mt-0.5 text-xs text-muted">{clientName} · {p.type || "—"}</p>
                </div>
                <Badge tone={projectStatus[p.status].tone}>{projectStatus[p.status].label}</Badge>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                <span className="text-muted">Bütçe: <span className="text-foreground">{p.budget ? TRY(p.budget) : "—"}</span></span>
                <span className="text-muted">Bitiş: <span className="text-foreground">{dateTR(p.end_date)}</span></span>
                <Badge tone={prioMap[p.priority].tone}>{prioMap[p.priority].label}</Badge>
                <span className="text-muted">{openTasks} açık görev</span>
              </div>
              <div className="mt-3 flex justify-end gap-1 border-t border-border pt-2">
                <button onClick={() => { setInitialForm(p); setOpen(true); }} className="rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-foreground"><Pencil className="h-4 w-4" /></button>
                <button onClick={() => remove("projects", p.id)} className="rounded-md p-1.5 text-muted hover:bg-danger/15 hover:text-danger"><Trash2 className="h-4 w-4" /></button>
              </div>
            </div>
          );
        })}
        {projects.length === 0 && <p className="col-span-full py-10 text-center text-muted">Henüz proje yok.</p>}
      </div>

      <ProjectModal open={open} onClose={() => setOpen(false)} initial={initialForm} clients={clients} brands={brands} />
    </>
  );
}
