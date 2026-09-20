"use client";

import Link from "next/link";
import { useState, useMemo, memo } from "react";
import { ArrowRight, PackageCheck, Pencil, Plus, ShoppingCart, Trash2 } from "lucide-react";
import { PageHeader, EmptyState, StatCard } from "@/components/ui";
import { Modal, Field, Input, Select, Button } from "@/components/form";
import { useStore, useHydrated, uid, nowISO } from "@/lib/store";
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

const EquipmentModal = memo(function EquipmentModal({
  open, onClose, initial, isPlanned
}: {
  open: boolean, onClose: () => void, initial: Equipment | null, isPlanned: boolean
}) {
  const [form, setForm] = useState<Equipment>({ ...baseEmpty, status: isPlanned ? "planned" : "idle" });
  const editing = Boolean(form.id);

  useMemo(() => {
    if (open) setForm(initial || { ...baseEmpty, status: isPlanned ? "planned" : "idle" });
  }, [open, initial, isPlanned]);

  const add = useStore((s) => s.add);
  const update = useStore((s) => s.update);

  async function save() {
    if (!form.name.trim()) return;
    const payload = { ...form, status: isPlanned ? "planned" as const : form.status };
    if (editing) await update("equipment", form.id, payload);
    else await add("equipment", { ...payload, id: uid(), created_at: nowISO() });
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? (isPlanned ? "Alınacak ekipmanı düzenle" : "Ekipmanı düzenle") : (isPlanned ? "Alınacak ekipman ekle" : "Yeni ekipman")}
      footer={<><Button variant="ghost" onClick={onClose}>Vazgeç</Button><Button onClick={save}>Kaydet</Button></>}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2"><Field label="Ekipman adı *"><Input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></Field></div>
        <Field label="Marka / model"><Input value={form.brand_model} onChange={(event) => setForm({ ...form, brand_model: event.target.value })} /></Field>
        <Field label="Kategori">
          <Select value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })}>
            <option value="">Seçin</option>
            {categories.map((category) => <option key={category}>{category}</option>)}
          </Select>
        </Field>
        {!isPlanned && <Field label="Durum">
          <Select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as EquipmentStatus })}>
            {Object.entries(equipmentStatus).filter(([key]) => key !== "planned").map(([key, value]) => <option key={key} value={key}>{value.label}</option>)}
          </Select>
        </Field>}
        {!isPlanned && <Field label="Zimmet (kişi)"><Input value={form.assigned_to} onChange={(event) => setForm({ ...form, assigned_to: event.target.value })} /></Field>}
        <Field label={isPlanned ? "Tahmini fiyat (₺)" : "Değer (₺)"}><Input type="number" value={form.purchase_price ?? ""} onChange={(event) => setForm({ ...form, purchase_price: event.target.value ? Number(event.target.value) : undefined })} /></Field>
        {!isPlanned && <Field label="Sonraki bakım"><Input type="date" value={form.next_service} onChange={(event) => setForm({ ...form, next_service: event.target.value })} /></Field>}
        <div className="sm:col-span-2"><Field label={isPlanned ? "İhtiyaç / satın alma notu" : "Not"}><Input value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></Field></div>
      </div>
    </Modal>
  );
});

export default function EquipmentManager({ view }: { view: EquipmentView }) {
  const hydrated = useHydrated(["equipment"]);
  const equipment = useStore((s) => s.equipment);
  const update = useStore((s) => s.update);
  const remove = useStore((s) => s.remove);
  const isPlanned = view === "planned";

  const [open, setOpen] = useState(false);
  const [initialForm, setInitialForm] = useState<Equipment | null>(null);

  const { rows, inventoryValue } = useMemo(() => {
    const r = hydrated ? equipment.filter((item) => isPlanned ? item.status === "planned" : item.status !== "planned") : [];
    const val = r.reduce((sum, item) => sum + (item.purchase_price ?? 0), 0);
    return { rows: r, inventoryValue: val };
  }, [hydrated, equipment, isPlanned]);

  async function moveToInventory(item: Equipment) {
    await update("equipment", item.id, { status: "idle", assigned_to: "" });
  }

  if (!hydrated) return <PageHeader title={isPlanned ? "Alınacak Ekipmanlar" : "Aktif Ekipmanlar"} subtitle="Yükleniyor…" />;

  return (
    <>
      <PageHeader
        title={isPlanned ? "Alınacak Ekipmanlar" : "Aktif Ekipmanlar"}
        subtitle={isPlanned
          ? "Henüz envanterde olmayan ihtiyaçlar ve tahmini bütçeleri"
          : "Yalnızca elinizde bulunan ekipmanların durum, zimmet ve bakım takibi"}
        action={
          <div className="flex flex-wrap gap-2">
            <Link href={isPlanned ? "/equipment" : "/equipment/planned"} className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-surface-2">
              {isPlanned ? "Aktif ekipmanları gör" : "Alınacakları gör"}
            </Link>
            <Button onClick={() => { setInitialForm({ ...baseEmpty, status: isPlanned ? "planned" : "idle" }); setOpen(true); }}>
              <span className="flex items-center gap-1.5"><Plus className="h-4 w-4" /> {isPlanned ? "Alınacak Ekle" : "Ekipman Ekle"}</span>
            </Button>
          </div>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatCard label={isPlanned ? "Alınacak sayısı" : "Aktif ekipman"} value={String(rows.length)} icon={isPlanned ? ShoppingCart : PackageCheck} />
        <StatCard label={isPlanned ? "Tahmini toplam bütçe" : "Toplam envanter değeri"} value={TRY(inventoryValue)} tone="amber" />
        {!isPlanned && <StatCard label="Bakımda / arızalı" value={String(rows.filter((item) => item.status === "maintenance" || item.status === "broken").length)} tone="warning" />}
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title={isPlanned ? "Alınacak ekipman bulunmuyor" : "Aktif ekipman bulunmuyor"}
          hint={isPlanned ? "İhtiyaç listenize kamera, lens veya diğer ekipmanları ekleyebilirsiniz." : "Elinizde bulunan ilk ekipmanı ekleyerek envanteri oluşturabilirsiniz."}
        />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted">
                <th className="px-4 py-3 font-medium">Ekipman</th>
                <th className="px-4 py-3 font-medium">Kategori</th>
                {!isPlanned && <th className="px-4 py-3 font-medium">Durum</th>}
                {!isPlanned && <th className="px-4 py-3 font-medium">Zimmet</th>}
                <th className="px-4 py-3 font-medium">{isPlanned ? "Tahmini fiyat" : "Değer"}</th>
                <th className="px-4 py-3 font-medium">{isPlanned ? "Not" : "Bakım"}</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {rows.map((item) => (
                <tr key={item.id} className="border-b border-border/60 hover:bg-surface-2/50">
                  <td className="px-4 py-3">
                    <p className="font-medium text-foreground">{item.name}</p>
                    <p className="text-xs text-muted">{item.brand_model || "—"}</p>
                  </td>
                  <td className="px-4 py-3 text-muted">{item.category || "—"}</td>
                  {!isPlanned && <td className="px-4 py-3">
                    <select
                      value={item.status}
                      onChange={(event) => update("equipment", item.id, { status: event.target.value as EquipmentStatus })}
                      className="rounded-md border border-border bg-background px-2 py-1 text-xs text-muted outline-none focus:border-amber/60"
                    >
                      {Object.entries(equipmentStatus).filter(([key]) => key !== "planned").map(([key, value]) => <option key={key} value={key}>{value.label}</option>)}
                    </select>
                  </td>}
                  {!isPlanned && <td className="px-4 py-3 text-muted">{item.assigned_to || "—"}</td>}
                  <td className="px-4 py-3 text-foreground">{item.purchase_price ? TRY(item.purchase_price) : "—"}</td>
                  <td className="max-w-[280px] px-4 py-3 text-muted">{isPlanned ? (item.notes || "—") : dateTR(item.next_service)}</td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1">
                      {isPlanned && <button onClick={() => moveToInventory(item)} title="Envantere taşı" className="flex items-center gap-1 rounded-md px-2 py-1.5 text-xs text-success hover:bg-success/10"><ArrowRight className="h-4 w-4" /> Envantere al</button>}
                      <button onClick={() => { setInitialForm(item); setOpen(true); }} className="rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-foreground"><Pencil className="h-4 w-4" /></button>
                      <button onClick={() => remove("equipment", item.id)} className="rounded-md p-1.5 text-muted hover:bg-danger/15 hover:text-danger"><Trash2 className="h-4 w-4" /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <EquipmentModal open={open} onClose={() => setOpen(false)} initial={initialForm} isPlanned={isPlanned} />
    </>
  );
}
