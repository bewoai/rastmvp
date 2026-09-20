"use client";

import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { PageHeader, EmptyState } from "@/components/ui";
import { FormModal, Field, Input, Select, Textarea, MoreFields, Button, useFormState } from "@/components/form";
import { DataTable, PageLoading, RowActions, SearchBox, Toolbar, useListSearch, useNewIntent } from "@/components/list";
import type { Column } from "@/components/list";
import { useDeleteConfirm } from "@/components/confirm";
import { useStore, useHydrated, uid, nowISO } from "@/lib/store";
import type { Brand, Client } from "@/lib/types";

const empty: Brand = {
  id: "", client_id: "", name: "", tone: "", target_audience: "",
  color_palette: "", website: "", instagram: "", notes: "", created_at: "",
};

function BrandModal({ initial, clients, onClose }: { initial: Brand | null; clients: Client[]; onClose: () => void }) {
  const f = useFormState<Brand>(initial ?? empty);
  const editing = Boolean(initial?.id);
  const { form } = f;

  async function submit() {
    if (!form.name.trim()) return { ok: false, error: "Marka adı zorunludur." };
    // brands.client_id veritabanında zorunlu (NOT NULL): boş bırakılırsa kayıt reddedilirdi
    if (!form.client_id) return { ok: false, error: "Marka bir müşteriye bağlı olmalı — müşteri seçin." };
    const payload = { ...form, name: form.name.trim() };
    const s = useStore.getState();
    return editing ? s.update("brands", form.id, payload) : s.add("brands", { ...payload, id: uid(), created_at: nowISO() });
  }

  return (
    <FormModal
      title={editing ? "Marka düzenle" : "Yeni marka"}
      onClose={onClose}
      onSubmit={submit}
      successMessage={editing ? "Marka güncellendi" : "Marka eklendi"}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Marka adı *"><Input {...f.text("name")} autoComplete="off" /></Field>
        <Field label="Müşteri *" hint={clients.length === 0 ? "Önce Müşteriler sayfasından bir müşteri ekleyin." : undefined}>
          <Select {...f.text("client_id")}>
            <option value="">Seçin</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
        <Field label="Instagram"><Input {...f.text("instagram")} placeholder="@marka" /></Field>
        <Field label="Web sitesi"><Input type="url" inputMode="url" {...f.text("website")} /></Field>
        <MoreFields label="Ek alanlar (ton, hedef kitle, not)" defaultOpen={editing}>
          <Field label="Marka tonu"><Input {...f.text("tone")} /></Field>
          <Field label="Hedef kitle"><Input {...f.text("target_audience")} /></Field>
          <div className="sm:col-span-2"><Field label="Notlar"><Textarea {...f.text("notes")} /></Field></div>
        </MoreFields>
      </div>
    </FormModal>
  );
}

export default function BrandsPage() {
  const hydrated = useHydrated(["brands", "clients"]);
  const brands = useStore((s) => s.brands);
  const clients = useStore((s) => s.clients);

  const wantNew = useNewIntent();
  const [modal, setModal] = useState<{ initial: Brand | null } | null>(() => (wantNew ? { initial: null } : null));
  const [query, setQuery] = useState("");
  const del = useDeleteConfirm();

  const clientMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of clients) map.set(c.id, c.name);
    return map;
  }, [clients]);

  const visible = useListSearch(brands, query, (b) => `${b.name} ${clientMap.get(b.client_id) ?? ""} ${b.tone ?? ""} ${b.instagram ?? ""}`);

  const columns = useMemo<Column<Brand>[]>(() => [
    {
      key: "name", header: "Marka", tone: "primary", mobile: "title", sort: (b) => b.name,
      cell: (b) => (
        <>
          <span className="block max-w-[20rem] truncate">{b.name}</span>
          <span className="block max-w-[20rem] truncate text-xs font-normal text-muted">{clientMap.get(b.client_id) || "Müşterisiz"}</span>
        </>
      ),
    },
    { key: "tone", header: "Ton", sort: (b) => b.tone, cell: (b) => <span className="block max-w-[16rem] truncate">{b.tone || "—"}</span> },
    { key: "audience", header: "Hedef kitle", sort: (b) => b.target_audience, cell: (b) => <span className="block max-w-[16rem] truncate">{b.target_audience || "—"}</span> },
    { key: "ig", header: "Instagram", sort: (b) => b.instagram, cell: (b) => (b.instagram ? <span className="text-amber">{b.instagram}</span> : "—") },
  ], [clientMap]);

  if (!hydrated) return <PageLoading title="Markalar" />;

  return (
    <>
      <PageHeader
        title="Markalar"
        subtitle="Her müşterinin bir veya birden fazla markası olabilir"
        action={
          <Button onClick={() => setModal({ initial: null })}>
            <Plus className="h-4 w-4" aria-hidden /> Yeni Marka
          </Button>
        }
      />

      <Toolbar>
        <span className="text-xs text-muted">{visible.length} marka</span>
        <SearchBox value={query} onChange={setQuery} placeholder="Marka, müşteri ara…" label="Marka ara" />
      </Toolbar>

      <DataTable
        columns={columns}
        rows={visible}
        rowKey={(b) => b.id}
        onOpen={(b) => setModal({ initial: b })}
        openLabel={(b) => `Düzenle: ${b.name}`}
        actions={(b) => (
          <RowActions label={b.name} onEdit={() => setModal({ initial: b })} onDelete={() => del.ask({ key: "brands", id: b.id, label: b.name })} />
        )}
        empty={
          brands.length === 0 ? (
            <EmptyState title="Henüz marka yok" hint="Markalar bir müşteriye bağlıdır." action={{ label: "Yeni Marka", onClick: () => setModal({ initial: null }) }} />
          ) : (
            <EmptyState title="Eşleşen marka yok" hint="Aramayı değiştir." />
          )
        }
      />

      {modal && <BrandModal initial={modal.initial} clients={clients} onClose={() => setModal(null)} />}
      {del.dialog}
    </>
  );
}
