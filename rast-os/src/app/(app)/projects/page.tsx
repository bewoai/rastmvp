"use client";

import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { PageHeader, Badge, EmptyState } from "@/components/ui";
import { FormModal, Field, Input, Select, Textarea, MoreFields, Button, useFormState } from "@/components/form";
import { DataTable, FilterChips, PageLoading, RowActions, SearchBox, StatusSelect, Toolbar, useListSearch, useNewIntent, usePersistentState } from "@/components/list";
import type { Column } from "@/components/list";
import { useDeleteConfirm } from "@/components/confirm";
import { useStore, useHydrated, uid, nowISO } from "@/lib/store";
import { patchRecord } from "@/lib/mutate";
import { projectStatus, priority as prioMap, TRY, dateTR } from "@/lib/labels";
import type { Project, ProjectStatus, Priority, Client, Brand } from "@/lib/types";

const empty: Project = {
  id: "", client_id: "", brand_id: "", name: "", type: "", owner: "",
  start_date: "", end_date: "", budget: undefined, status: "planning",
  priority: "medium", notes: "", created_at: "",
};

const statusOptions = (Object.keys(projectStatus) as ProjectStatus[]).map((value) => ({ value, ...projectStatus[value] }));
const ACTIVE: ProjectStatus[] = ["planning", "active", "on_hold", "review"];
type Scope = "active" | "closed" | "all";
const SCOPES: readonly Scope[] = ["active", "closed", "all"];

/** Form state'i burada yaşar: yazarken sayfa listesi render olmaz; her açılışta temiz başlar. */
function ProjectModal({ initial, clients, brands, onClose }: {
  initial: Project | null; clients: Client[]; brands: Brand[]; onClose: () => void;
}) {
  const f = useFormState<Project>(initial ?? empty);
  const editing = Boolean(initial?.id);
  const { form } = f;

  async function submit() {
    if (!form.name.trim()) return { ok: false, error: "Proje adı zorunludur." };
    const payload = { ...form, name: form.name.trim() };
    const s = useStore.getState();
    return editing
      ? s.update("projects", form.id, payload)
      : s.add("projects", { ...payload, id: uid(), created_at: nowISO() });
  }

  return (
    <FormModal
      title={editing ? "Proje düzenle" : "Yeni proje"}
      onClose={onClose}
      onSubmit={submit}
      successMessage={editing ? "Proje güncellendi" : "Proje eklendi"}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field label="Proje adı *"><Input {...f.text("name")} autoComplete="off" /></Field>
        </div>
        <Field label="Müşteri">
          <Select value={form.client_id ?? ""} onChange={(e) => { f.set("client_id", e.target.value); f.set("brand_id", ""); }}>
            <option value="">Seçin</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
        <Field label="Marka">
          <Select {...f.text("brand_id")}>
            <option value="">Seçin</option>
            {brands.filter((b) => !form.client_id || b.client_id === form.client_id).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
        </Field>
        <Field label="Durum">
          <Select {...f.text("status")}>
            {statusOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
        </Field>
        <Field label="Bitiş"><Input type="date" {...f.text("end_date")} /></Field>
        <MoreFields label="Ek alanlar (tür, sorumlu, bütçe, öncelik…)" defaultOpen={editing}>
          <Field label="Tür"><Input {...f.text("type")} placeholder="Aylık yönetim, video…" /></Field>
          <Field label="Sorumlu"><Input {...f.text("owner")} /></Field>
          <Field label="Başlangıç"><Input type="date" {...f.text("start_date")} /></Field>
          <Field label="Bütçe (₺)"><Input type="number" inputMode="decimal" min="0" {...f.num("budget")} /></Field>
          <Field label="Öncelik">
            <Select {...f.text("priority")}>
              {(Object.keys(prioMap) as Priority[]).reverse().map((p) => <option key={p} value={p}>{prioMap[p].label}</option>)}
            </Select>
          </Field>
          <div className="sm:col-span-2"><Field label="Notlar"><Textarea {...f.text("notes")} /></Field></div>
        </MoreFields>
      </div>
    </FormModal>
  );
}

export default function ProjectsPage() {
  const hydrated = useHydrated(["projects", "clients", "tasks", "brands"]);
  const projects = useStore((s) => s.projects);
  const clients = useStore((s) => s.clients);
  const brands = useStore((s) => s.brands);
  const tasks = useStore((s) => s.tasks);

  const wantNew = useNewIntent();
  const [modal, setModal] = useState<{ initial: Project | null } | null>(() => (wantNew ? { initial: null } : null));
  const [scope, setScope] = usePersistentState<Scope>("projects-scope", "active", SCOPES);
  const [query, setQuery] = useState("");
  const del = useDeleteConfirm();

  // O(1) lookups
  const { clientMap, taskCounts } = useMemo(() => {
    const _clientMap = new Map<string, string>();
    for (const c of clients) _clientMap.set(c.id, c.name);
    const _taskCounts = new Map<string, number>();
    for (const t of tasks) {
      if (t.status !== "done" && t.project_id) _taskCounts.set(t.project_id, (_taskCounts.get(t.project_id) ?? 0) + 1);
    }
    return { clientMap: _clientMap, taskCounts: _taskCounts };
  }, [clients, tasks]);

  const counts = useMemo(() => {
    let active = 0;
    for (const p of projects) if (ACTIVE.includes(p.status)) active++;
    return { active, closed: projects.length - active, all: projects.length };
  }, [projects]);

  const scoped = useMemo(
    () => (scope === "all" ? projects : projects.filter((p) => ACTIVE.includes(p.status) === (scope === "active"))),
    [projects, scope],
  );
  const visible = useListSearch(scoped, query, (p) => `${p.name} ${clientMap.get(p.client_id ?? "") ?? ""} ${p.type ?? ""} ${p.owner ?? ""}`);

  const columns = useMemo<Column<Project>[]>(() => [
    {
      key: "name", header: "Proje", tone: "primary", mobile: "title",
      sort: (p) => p.name,
      cell: (p) => (
        <>
          <span className="block max-w-[26rem] truncate">{p.name}</span>
          <span className="block max-w-[26rem] truncate text-xs font-normal text-muted">{clientMap.get(p.client_id ?? "") || "Müşterisiz"}{p.type ? ` · ${p.type}` : ""}</span>
        </>
      ),
    },
    {
      key: "status", header: "Durum", mobile: "badge",
      sort: (p) => Object.keys(projectStatus).indexOf(p.status),
      cell: (p) => (
        <StatusSelect value={p.status} options={statusOptions} label={`Durum: ${p.name}`} onChange={(status) => patchRecord("projects", p.id, { status }, "Durum güncellenemedi")} />
      ),
    },
    {
      key: "priority", header: "Öncelik", mobile: "hide",
      sort: (p) => ["low", "medium", "high", "urgent"].indexOf(p.priority),
      cell: (p) => <Badge tone={prioMap[p.priority].tone}>{prioMap[p.priority].label}</Badge>,
    },
    { key: "budget", header: "Bütçe", tone: "strong", sort: (p) => p.budget, cell: (p) => (p.budget ? TRY(p.budget) : "—") },
    { key: "end", header: "Bitiş", sort: (p) => p.end_date, cell: (p) => dateTR(p.end_date) },
    {
      key: "tasks", header: "Açık görev", sort: (p) => taskCounts.get(p.id) ?? 0,
      cell: (p) => taskCounts.get(p.id) ?? 0,
    },
  ], [clientMap, taskCounts]);

  if (!hydrated) return <PageLoading title="Projeler" />;

  return (
    <>
      <PageHeader
        title="Projeler"
        subtitle="Müşteri projeleri, durum, bütçe ve teslim takibi"
        action={
          <Button onClick={() => setModal({ initial: null })}>
            <Plus className="h-4 w-4" aria-hidden /> Yeni Proje
          </Button>
        }
      />

      <Toolbar>
        <FilterChips
          label="Proje kapsamı"
          value={scope}
          onChange={setScope}
          options={[
            { id: "active", label: "Aktif", count: counts.active },
            { id: "closed", label: "Kapanan", count: counts.closed },
            { id: "all", label: "Tümü", count: counts.all },
          ]}
        />
        <SearchBox value={query} onChange={setQuery} placeholder="Proje, müşteri ara…" label="Proje ara" />
      </Toolbar>

      <DataTable
        columns={columns}
        rows={visible}
        rowKey={(p) => p.id}
        onOpen={(p) => setModal({ initial: p })}
        openLabel={(p) => `Düzenle: ${p.name}`}
        actions={(p) => (
          <RowActions
            label={p.name}
            onEdit={() => setModal({ initial: p })}
            onDelete={() => del.ask({ key: "projects", id: p.id, label: p.name, warning: "Projeye bağlı tüm görevler (tamamlananlar dahil) de silinir." })}
          />
        )}
        empty={
          projects.length === 0 ? (
            <EmptyState title="Henüz proje yok" hint="İlk müşteri projesini ekleyerek başla." action={{ label: "Yeni Proje", onClick: () => setModal({ initial: null }) }} />
          ) : (
            <EmptyState title="Eşleşen proje yok" hint={query ? "Aramayı veya filtreyi değiştir." : "Bu kapsamda proje bulunmuyor."} />
          )
        }
      />

      {modal && <ProjectModal initial={modal.initial} clients={clients} brands={brands} onClose={() => setModal(null)} />}
      {del.dialog}
    </>
  );
}
