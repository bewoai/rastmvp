"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowRight, Plus, ShoppingCart } from "lucide-react";
import { PageHeader, EmptyState, StatStrip } from "@/components/ui";
import { FormModal, Field, Input, Select, MoreFields, Button, useFormState } from "@/components/form";
import { DataTable, FilterChips, PageLoading, RowActions, SearchBox, StatusSelect, Toolbar, useListSearch, useNewIntent, usePersistentState } from "@/components/list";
import type { Column } from "@/components/list";
import { useDeleteConfirm } from "@/components/confirm";
import { useStore, useHydrated, uid, nowISO } from "@/lib/store";
import { useToday } from "@/lib/useToday";
import { daysBetween } from "@/lib/taskLogic";
import { patchRecord } from "@/lib/mutate";
import { useToasts } from "@/lib/toast";
import { equipmentStatus, TRY, dateTR } from "@/lib/labels";
import type { Equipment, EquipmentStatus } from "@/lib/types";

type EquipmentView = "active" | "planned";

const baseEmpty: Equipment = {
  id: "", name: "", brand_model: "", category: "", status: "idle",
  assigned_to: "", purchase_price: undefined, next_service: "", notes: "", created_at: "",
};

const categories = [
  "Kamera", "Lens", "Kamera & Lens", "Işık", "Işık & Görüntü", "Ses", "Ses & Drone",
  "Sabitleyici", "Stabilizasyon", "Drone", "Bilgisayar", "Depolama", "Batarya",
  "Güç & Yazılım", "Lojistik", "Diğer",
];

const activeStatusOptions = (Object.keys(equipmentStatus) as EquipmentStatus[])
  .filter((value) => value !== "planned")
  .map((value) => ({ value, ...equipmentStatus[value] }));

type Scope = "all" | "idle" | "busy" | "issue";
const SCOPES: readonly Scope[] = ["all", "idle", "busy", "issue"];
const scopeOf = (s: EquipmentStatus): Scope =>
  s === "idle" ? "idle" : s === "maintenance" || s === "broken" || s === "lost" ? "issue" : "busy";

function EquipmentModal({ initial, isPlanned, onClose }: { initial: Equipment | null; isPlanned: boolean; onClose: () => void }) {
  const f = useFormState<Equipment>(initial ?? { ...baseEmpty, status: isPlanned ? "planned" : "idle" });
  const editing = Boolean(initial?.id);
  const { form } = f;

  async function submit() {
    if (!form.name.trim()) return { ok: false, error: "Ekipman adı zorunludur." };
    const payload = { ...form, name: form.name.trim(), status: isPlanned ? ("planned" as const) : form.status };
    const s = useStore.getState();
    return editing ? s.update("equipment", form.id, payload) : s.add("equipment", { ...payload, id: uid(), created_at: nowISO() });
  }

  return (
    <FormModal
      title={editing ? (isPlanned ? "Alınacak ekipmanı düzenle" : "Ekipmanı düzenle") : (isPlanned ? "Alınacak ekipman ekle" : "Yeni ekipman")}
      onClose={onClose}
      onSubmit={submit}
      successMessage={editing ? "Ekipman güncellendi" : "Ekipman eklendi"}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2"><Field label="Ekipman adı *"><Input {...f.text("name")} autoComplete="off" /></Field></div>
        <Field label="Marka / model"><Input {...f.text("brand_model")} /></Field>
        <Field label="Kategori">
          <Select {...f.text("category")}>
            <option value="">Seçin</option>
            {categories.map((category) => <option key={category}>{category}</option>)}
          </Select>
        </Field>
        {!isPlanned && (
          <Field label="Durum">
            <Select {...f.text("status")}>
              {activeStatusOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
          </Field>
        )}
        <Field label={isPlanned ? "Tahmini fiyat (₺)" : "Değer (₺)"}><Input type="number" inputMode="decimal" min="0" {...f.num("purchase_price")} /></Field>
        <MoreFields label={isPlanned ? "Ek alanlar (not)" : "Ek alanlar (zimmet, bakım, not)"} defaultOpen={editing}>
          {!isPlanned && <Field label="Zimmet (kişi)"><Input {...f.text("assigned_to")} /></Field>}
          {!isPlanned && <Field label="Sonraki bakım"><Input type="date" {...f.text("next_service")} /></Field>}
          <div className="sm:col-span-2"><Field label={isPlanned ? "İhtiyaç / satın alma notu" : "Not"}><Input {...f.text("notes")} /></Field></div>
        </MoreFields>
      </div>
    </FormModal>
  );
}

export default function EquipmentManager({ view }: { view: EquipmentView }) {
  const hydrated = useHydrated(["equipment"]);
  const equipment = useStore((s) => s.equipment);
  const today = useToday();
  const isPlanned = view === "planned";
  const title = isPlanned ? "Alınacak Ekipmanlar" : "Aktif Ekipmanlar";

  const wantNew = useNewIntent();
  const [modal, setModal] = useState<{ initial: Equipment | null } | null>(() => (wantNew ? { initial: null } : null));
  const [scope, setScope] = usePersistentState<Scope>("equipment-scope", "all", SCOPES);
  const [query, setQuery] = useState("");
  const del = useDeleteConfirm();

  const { rows, inventoryValue, counts } = useMemo(() => {
    const r = equipment.filter((item) => (isPlanned ? item.status === "planned" : item.status !== "planned"));
    const counts = { all: r.length, idle: 0, busy: 0, issue: 0 };
    let val = 0;
    for (const item of r) {
      val += item.purchase_price ?? 0;
      if (!isPlanned) counts[scopeOf(item.status)]++;
    }
    return { rows: r, inventoryValue: val, counts };
  }, [equipment, isPlanned]);

  const scoped = useMemo(
    () => (isPlanned || scope === "all" ? rows : rows.filter((item) => scopeOf(item.status) === scope)),
    [rows, scope, isPlanned],
  );
  const visible = useListSearch(scoped, query, (e) => `${e.name} ${e.brand_model ?? ""} ${e.category ?? ""} ${e.assigned_to ?? ""}`);

  function moveToInventory(item: Equipment) {
    patchRecord("equipment", item.id, { status: "idle", assigned_to: "" }, "Envantere alınamadı");
    useToasts.getState().push({ message: `“${item.name}” envantere alındı`, href: "/equipment", hrefLabel: "Aktif ekipmanlar" });
  }

  const columns = useMemo<Column<Equipment>[]>(() => {
    const cols: Column<Equipment>[] = [
      {
        key: "name", header: "Ekipman", tone: "primary", mobile: "title", sort: (e) => e.name,
        cell: (e) => (
          <>
            <span className="block max-w-[22rem] truncate">{e.name}</span>
            {e.brand_model && <span className="block max-w-[22rem] truncate text-xs font-normal text-muted">{e.brand_model}</span>}
          </>
        ),
      },
      { key: "category", header: "Kategori", sort: (e) => e.category, cell: (e) => e.category || "—" },
    ];
    if (!isPlanned) {
      cols.push(
        {
          key: "status", header: "Durum", mobile: "badge", sort: (e) => Object.keys(equipmentStatus).indexOf(e.status),
          cell: (e) => (
            <StatusSelect value={e.status} options={activeStatusOptions} label={`Durum: ${e.name}`} onChange={(status) => patchRecord("equipment", e.id, { status }, "Durum güncellenemedi")} />
          ),
        },
        { key: "assigned", header: "Zimmet", sort: (e) => e.assigned_to, cell: (e) => e.assigned_to || "—" },
      );
    }
    cols.push({ key: "price", header: isPlanned ? "Tahmini fiyat" : "Değer", tone: "strong", sort: (e) => e.purchase_price, cell: (e) => (e.purchase_price ? TRY(e.purchase_price) : "—") });
    cols.push(
      isPlanned
        ? { key: "notes", header: "Not", cell: (e) => <span className="block max-w-[20rem] truncate">{e.notes || "—"}</span> }
        : {
            key: "service", header: "Bakım", sort: (e) => e.next_service,
            cell: (e) => {
              const due = e.next_service?.slice(0, 10);
              if (!due) return "—";
              const left = daysBetween(today, due);
              if (left < 0) return <span className="text-danger">{dateTR(due)} · gecikti</span>;
              if (left <= 14) return <span className="text-warning">{dateTR(due)} · {left} gün</span>;
              return dateTR(due);
            },
          },
    );
    return cols;
  }, [isPlanned, today]);

  if (!hydrated) return <PageLoading title={title} />;

  const add = () => setModal({ initial: null });

  return (
    <>
      <PageHeader
        title={title}
        subtitle={isPlanned
          ? "Henüz envanterde olmayan ihtiyaçlar ve tahmini bütçeleri"
          : "Yalnızca elinizde bulunan ekipmanların durum, zimmet ve bakım takibi"}
        action={
          <div className="flex flex-wrap gap-2">
            <Link prefetch={false} href={isPlanned ? "/equipment" : "/equipment/planned"} className="inline-flex min-h-10 items-center rounded-xl border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-surface-2">
              {isPlanned ? "Aktif ekipmanları gör" : "Alınacakları gör"}
            </Link>
            <Button onClick={add}>
              <Plus className="h-4 w-4" aria-hidden /> {isPlanned ? "Alınacak Ekle" : "Ekipman Ekle"}
            </Button>
          </div>
        }
      />

      <StatStrip
        items={[
          { label: isPlanned ? "Alınacak sayısı" : "Aktif ekipman", value: String(rows.length) },
          { label: isPlanned ? "Tahmini toplam bütçe" : "Toplam envanter değeri", value: TRY(inventoryValue), tone: "amber" },
          ...(!isPlanned ? [{ label: "Bakımda / arızalı", value: String(counts.issue), tone: "warning" as const }] : []),
        ]}
      />

      <Toolbar>
        {isPlanned ? (
          <span className="flex items-center gap-1.5 text-xs text-muted"><ShoppingCart className="h-3.5 w-3.5" aria-hidden /> {visible.length} kalem</span>
        ) : (
          <FilterChips
            label="Ekipman durumu"
            value={scope}
            onChange={setScope}
            options={[
              { id: "all", label: "Tümü", count: counts.all },
              { id: "idle", label: "Boşta", count: counts.idle },
              { id: "busy", label: "Kullanımda", count: counts.busy },
              { id: "issue", label: "Bakım / arıza", count: counts.issue },
            ]}
          />
        )}
        <SearchBox value={query} onChange={setQuery} placeholder="Ekipman, kategori ara…" label="Ekipman ara" />
      </Toolbar>

      <DataTable
        columns={columns}
        rows={visible}
        rowKey={(e) => e.id}
        onOpen={(e) => setModal({ initial: e })}
        openLabel={(e) => `Düzenle: ${e.name}`}
        actions={(e) => (
          <RowActions label={e.name} onEdit={() => setModal({ initial: e })} onDelete={() => del.ask({ key: "equipment", id: e.id, label: e.name })}>
            {isPlanned && (
              <button
                type="button"
                onClick={() => moveToInventory(e)}
                aria-label={`Envantere al: ${e.name}`}
                className="mr-1 flex h-10 items-center gap-1 rounded-lg px-2.5 text-xs font-medium text-success hover:bg-success/10 md:h-8"
              >
                <ArrowRight className="h-4 w-4" aria-hidden /> Envantere al
              </button>
            )}
          </RowActions>
        )}
        empty={
          rows.length === 0 ? (
            <EmptyState
              title={isPlanned ? "Alınacak ekipman bulunmuyor" : "Aktif ekipman bulunmuyor"}
              hint={isPlanned ? "İhtiyaç listenize kamera, lens veya diğer ekipmanları ekleyebilirsiniz." : "Elinizde bulunan ilk ekipmanı ekleyerek envanteri oluşturabilirsiniz."}
              action={{ label: isPlanned ? "Alınacak Ekle" : "Ekipman Ekle", onClick: add }}
            />
          ) : (
            <EmptyState title="Eşleşen ekipman yok" hint={query ? "Aramayı değiştir." : "Bu durumda ekipman bulunmuyor."} />
          )
        }
      />

      {modal && <EquipmentModal initial={modal.initial} isPlanned={isPlanned} onClose={() => setModal(null)} />}
      {del.dialog}
    </>
  );
}
