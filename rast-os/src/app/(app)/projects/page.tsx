"use client";

import { useState } from "react";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { PageHeader, Badge } from "@/components/ui";
import { Modal, Field, Input, Select, Button } from "@/components/form";
import { useStore, useHydrated, uid, nowISO } from "@/lib/store";
import { projectStatus, priority as prioMap, TRY, dateTR } from "@/lib/labels";
import type { Project, ProjectStatus, Priority } from "@/lib/types";

const empty: Project = {
  id: "", client_id: "", brand_id: "", name: "", type: "", owner: "",
  start_date: "", end_date: "", budget: undefined, status: "planning",
  priority: "medium", notes: "", created_at: "",
};

export default function ProjectsPage() {
  const hydrated = useHydrated();
  const projects = useStore((s) => s.projects);
  const clients = useStore((s) => s.clients);
  const brands = useStore((s) => s.brands);
  const tasks = useStore((s) => s.tasks);
  const add = useStore((s) => s.add);
  const update = useStore((s) => s.update);
  const remove = useStore((s) => s.remove);

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Project>(empty);
  const editing = Boolean(form.id);

  function save() {
    if (!form.name.trim()) return;
    if (editing) update("projects", form.id, form);
    else add("projects", { ...form, id: uid(), created_at: nowISO() });
    setOpen(false);
  }

  return (
    <>
      <PageHeader
        title="Projeler"
        subtitle="Müşteri projeleri, durum, bütçe ve teslim takibi"
        action={
          <Button onClick={() => { setForm({ ...empty }); setOpen(true); }}>
            <span className="flex items-center gap-1.5"><Plus className="h-4 w-4" /> Yeni Proje</span>
          </Button>
        }
      />

      <div className="grid gap-3 md:grid-cols-2">
        {hydrated && projects.map((p) => {
          const client = clients.find((c) => c.id === p.client_id);
          const openTasks = tasks.filter((t) => t.project_id === p.id && t.status !== "done").length;
          return (
            <div key={p.id} className="card p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold text-foreground">{p.name}</p>
                  <p className="mt-0.5 text-xs text-muted">{client?.name || "—"} · {p.type || "—"}</p>
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
                <button onClick={() => { setForm({ ...p }); setOpen(true); }} className="rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-foreground"><Pencil className="h-4 w-4" /></button>
                <button onClick={() => remove("projects", p.id)} className="rounded-md p-1.5 text-muted hover:bg-danger/15 hover:text-danger"><Trash2 className="h-4 w-4" /></button>
              </div>
            </div>
          );
        })}
        {hydrated && projects.length === 0 && <p className="col-span-full py-10 text-center text-muted">Henüz proje yok.</p>}
      </div>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? "Proje düzenle" : "Yeni proje"}
        footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Vazgeç</Button><Button onClick={save}>Kaydet</Button></>}
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
    </>
  );
}
