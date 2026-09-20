"use client";

import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { PageHeader, EmptyState } from "@/components/ui";
import { FormModal, Field, Input, Select, Textarea, MoreFields, Button, useFormState } from "@/components/form";
import { DataTable, PageLoading, RowActions, SearchBox, StatusSelect, Tabs, Toolbar, useListSearch, useNewIntent, usePersistentState } from "@/components/list";
import type { Column } from "@/components/list";
import { useDeleteConfirm } from "@/components/confirm";
import { useStore, useHydrated, uid, nowISO } from "@/lib/store";
import { useToday } from "@/lib/useToday";
import { dateKey } from "@/lib/taskLogic";
import { patchRecord } from "@/lib/mutate";
import { shootStatus } from "@/lib/labels";
import type { Shoot, ShootStatus, Brand } from "@/lib/types";

const empty: Shoot = {
  id: "", client_id: "", brand_id: "", title: "", shoot_type: "",
  scheduled_at: "", location: "", status: "planned", notes: "", created_at: "",
};

const statusOptions = (Object.keys(shootStatus) as ShootStatus[]).map((value) => ({ value, ...shootStatus[value] }));

const dt = (s?: string) =>
  s ? new Date(s).toLocaleString("tr-TR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";

/**
 * `scheduled_at` veritabanında timestamptz ("2026-08-09T10:00:00+00:00" döner) ama <input type="datetime-local">
 * yalnızca "YYYY-MM-DDTHH:mm" kabul eder: eskiden düzenleme formu tarihi boş gösteriyor ve kaydedince silinmesine
 * yol açıyordu. Yüklerken yerel saate çevrilir, kaydederken ISO'ya (saat dilimiyle) çevrilir.
 */
function toLocalInput(value?: string): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fromLocalInput(value?: string): string {
  if (!value) return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
}

type View = "upcoming" | "past" | "all";
const VIEWS: readonly View[] = ["upcoming", "past", "all"];

function ShootModal({ initial, brands, onClose }: { initial: Shoot | null; brands: Brand[]; onClose: () => void }) {
  const f = useFormState<Shoot>(initial ? { ...initial, scheduled_at: toLocalInput(initial.scheduled_at) } : empty);
  const editing = Boolean(initial?.id);
  const { form } = f;

  async function submit() {
    if (!form.title.trim()) return { ok: false, error: "Çekim adı zorunludur." };
    const payload = { ...form, title: form.title.trim(), scheduled_at: fromLocalInput(form.scheduled_at) };
    const s = useStore.getState();
    return editing ? s.update("shoots", form.id, payload) : s.add("shoots", { ...payload, id: uid(), created_at: nowISO() });
  }

  return (
    <FormModal
      title={editing ? "Çekim düzenle" : "Yeni çekim"}
      onClose={onClose}
      onSubmit={submit}
      successMessage={editing ? "Çekim güncellendi" : "Çekim eklendi"}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2"><Field label="Çekim adı *"><Input {...f.text("title")} autoComplete="off" /></Field></div>
        <Field label="Tarih & saat"><Input type="datetime-local" {...f.text("scheduled_at")} /></Field>
        <Field label="Lokasyon"><Input {...f.text("location")} /></Field>
        <Field label="Marka">
          <Select {...f.text("brand_id")}>
            <option value="">Seçin</option>
            {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
        </Field>
        <Field label="Durum">
          <Select {...f.text("status")}>
            {statusOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
        </Field>
        <MoreFields label="Ek alanlar (çekim türü, not)" defaultOpen={editing}>
          <Field label="Çekim türü"><Input {...f.text("shoot_type")} placeholder="Ürün, röportaj…" /></Field>
          <div className="sm:col-span-2"><Field label="Notlar"><Textarea {...f.text("notes")} /></Field></div>
        </MoreFields>
      </div>
    </FormModal>
  );
}

export default function ShootsPage() {
  const hydrated = useHydrated(["shoots", "clients", "brands"]);
  const shoots = useStore((s) => s.shoots);
  const brands = useStore((s) => s.brands);
  const today = useToday();

  const wantNew = useNewIntent();
  const [modal, setModal] = useState<{ initial: Shoot | null } | null>(() => (wantNew ? { initial: null } : null));
  const [view, setView] = usePersistentState<View>("shoots-view", "upcoming", VIEWS);
  const [query, setQuery] = useState("");
  const del = useDeleteConfirm();

  const brandMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const b of brands) map.set(b.id, b.name);
    return map;
  }, [brands]);

  // Yaklaşan: bitmemiş/iptal edilmemiş ve tarihi bugün veya sonrası (tarihsizler de planlanmayı bekler → burada).
  // Geçmiş: tamamlanan/iptal ya da tarihi geçmiş. Tek geçiş; yaklaşanlar en yakın tarih önce.
  const buckets = useMemo(() => {
    const upcoming: Shoot[] = [];
    const past: Shoot[] = [];
    for (const s of shoots) {
      const day = s.scheduled_at ? dateKey(new Date(s.scheduled_at)) : "";
      const closed = s.status === "completed" || s.status === "cancelled";
      if (!closed && (!day || day >= today)) upcoming.push(s);
      else past.push(s);
    }
    const at = (s: Shoot) => s.scheduled_at || "";
    upcoming.sort((a, b) => (at(a) && !at(b) ? -1 : !at(a) && at(b) ? 1 : new Date(at(a)).getTime() - new Date(at(b)).getTime()));
    past.sort((a, b) => new Date(at(b)).getTime() - new Date(at(a)).getTime());
    return { upcoming, past, all: [...upcoming, ...past] };
  }, [shoots, today]);

  const visible = useListSearch(buckets[view], query, (s) => `${s.title} ${brandMap.get(s.brand_id ?? "") ?? ""} ${s.shoot_type ?? ""} ${s.location ?? ""}`);

  const columns = useMemo<Column<Shoot>[]>(() => [
    {
      key: "title", header: "Çekim", tone: "primary", mobile: "title", sort: (s) => s.title,
      cell: (s) => (
        <>
          <span className="block max-w-[24rem] truncate">{s.title}</span>
          <span className="block max-w-[24rem] truncate text-xs font-normal text-muted">{brandMap.get(s.brand_id ?? "") || "Markasız"}{s.shoot_type ? ` · ${s.shoot_type}` : ""}</span>
        </>
      ),
    },
    { key: "when", header: "Tarih & saat", tone: "strong", sort: (s) => (s.scheduled_at ? new Date(s.scheduled_at).getTime() : undefined), cell: (s) => dt(s.scheduled_at) },
    { key: "location", header: "Lokasyon", sort: (s) => s.location, cell: (s) => <span className="block max-w-[16rem] truncate">{s.location || "—"}</span> },
    {
      key: "status", header: "Durum", mobile: "badge", sort: (s) => Object.keys(shootStatus).indexOf(s.status),
      cell: (s) => (
        <StatusSelect value={s.status} options={statusOptions} label={`Durum: ${s.title}`} onChange={(status) => patchRecord("shoots", s.id, { status }, "Durum güncellenemedi")} />
      ),
    },
  ], [brandMap]);

  if (!hydrated) return <PageLoading title="Çekimler" />;

  return (
    <>
      <PageHeader
        title="Çekimler"
        subtitle="Çekim planı: tarih, lokasyon ve durum"
        action={
          <Button onClick={() => setModal({ initial: null })}>
            <Plus className="h-4 w-4" aria-hidden /> Yeni Çekim
          </Button>
        }
      />

      <Toolbar>
        <Tabs
          label="Çekim görünümleri"
          value={view}
          onChange={setView}
          className="w-full sm:w-auto"
          tabs={[
            { id: "upcoming", label: "Yaklaşan", count: buckets.upcoming.length },
            { id: "past", label: "Geçmiş", count: buckets.past.length },
            { id: "all", label: "Tümü", count: buckets.all.length },
          ]}
        />
        <SearchBox value={query} onChange={setQuery} placeholder="Çekim, lokasyon ara…" label="Çekim ara" />
      </Toolbar>

      <div role="tabpanel" aria-label="Çekim listesi">
        <DataTable
          columns={columns}
          rows={visible}
          rowKey={(s) => s.id}
          onOpen={(s) => setModal({ initial: s })}
          openLabel={(s) => `Düzenle: ${s.title}`}
          actions={(s) => (
            <RowActions label={s.title} onEdit={() => setModal({ initial: s })} onDelete={() => del.ask({ key: "shoots", id: s.id, label: s.title })} />
          )}
          empty={
            shoots.length === 0 ? (
              <EmptyState title="Henüz çekim yok" hint="Çekim planını tarih ve lokasyonla ekle." action={{ label: "Yeni Çekim", onClick: () => setModal({ initial: null }) }} />
            ) : (
              <EmptyState
                title={query ? "Eşleşen çekim yok" : view === "upcoming" ? "Yaklaşan çekim yok" : "Bu görünümde çekim yok"}
                hint={query ? "Aramayı değiştir." : view === "upcoming" ? "Geçmiş çekimleri “Geçmiş” sekmesinde bulabilirsin." : undefined}
                action={!query && view === "upcoming" ? { label: "Yeni Çekim", onClick: () => setModal({ initial: null }) } : undefined}
              />
            )
          }
        />
      </div>

      {modal && <ShootModal initial={modal.initial} brands={brands} onClose={() => setModal(null)} />}
      {del.dialog}
    </>
  );
}
