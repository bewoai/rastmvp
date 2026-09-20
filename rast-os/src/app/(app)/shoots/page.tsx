"use client";

import { useState, useMemo, memo } from "react";
import { Plus, Pencil, Trash2, MapPin, Clock } from "lucide-react";
import { PageHeader, Badge } from "@/components/ui";
import { Modal, Field, Input, Select, Textarea, Button } from "@/components/form";
import { useStore, useHydrated, uid, nowISO } from "@/lib/store";
import { shootStatus } from "@/lib/labels";
import type { Shoot, ShootStatus, Brand } from "@/lib/types";

const empty: Shoot = {
  id: "", client_id: "", brand_id: "", title: "", shoot_type: "",
  scheduled_at: "", location: "", status: "planned", notes: "", created_at: "",
};

const dt = (s?: string) =>
  s ? new Date(s).toLocaleString("tr-TR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";

const ShootModal = memo(function ShootModal({
  open, onClose, initial, brands
}: {
  open: boolean, onClose: () => void, initial: Shoot | null, brands: Brand[]
}) {
  const [form, setForm] = useState<Shoot>(empty);
  const editing = Boolean(form.id);

  useMemo(() => {
    if (open) setForm(initial || empty);
  }, [open, initial]);

  const add = useStore((s) => s.add);
  const update = useStore((s) => s.update);

  function save() {
    if (!form.title.trim()) return;
    if (editing) update("shoots", form.id, form);
    else add("shoots", { ...form, id: uid(), created_at: nowISO() });
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? "Çekim düzenle" : "Yeni çekim"}
      footer={<><Button variant="ghost" onClick={onClose}>Vazgeç</Button><Button onClick={save}>Kaydet</Button></>}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2"><Field label="Çekim adı *"><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field></div>
        <Field label="Marka">
          <Select value={form.brand_id} onChange={(e) => setForm({ ...form, brand_id: e.target.value })}>
            <option value="">Seçin</option>
            {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
        </Field>
        <Field label="Çekim türü"><Input value={form.shoot_type} onChange={(e) => setForm({ ...form, shoot_type: e.target.value })} placeholder="Ürün, röportaj…" /></Field>
        <Field label="Tarih & saat"><Input type="datetime-local" value={form.scheduled_at} onChange={(e) => setForm({ ...form, scheduled_at: e.target.value })} /></Field>
        <Field label="Lokasyon"><Input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} /></Field>
        <Field label="Durum">
          <Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as ShootStatus })}>
            {Object.entries(shootStatus).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </Select>
        </Field>
        <div className="sm:col-span-2"><Field label="Notlar"><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field></div>
      </div>
    </Modal>
  );
});

export default function ShootsPage() {
  const hydrated = useHydrated(["shoots", "clients", "brands"]);
  const shoots = useStore((s) => s.shoots);
  const brands = useStore((s) => s.brands);
  const remove = useStore((s) => s.remove);

  const [open, setOpen] = useState(false);
  const [initialForm, setInitialForm] = useState<Shoot | null>(null);

  const sorted = useMemo(() => hydrated
    ? [...shoots].sort((a, b) => (a.scheduled_at || "") < (b.scheduled_at || "") ? -1 : 1)
    : [], [shoots, hydrated]);

  const brandMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const b of brands) map.set(b.id, b.name);
    return map;
  }, [brands]);

  if (!hydrated) return <PageHeader title="Çekimler" subtitle="Yükleniyor…" />;

  return (
    <>
      <PageHeader
        title="Çekimler"
        subtitle="Çekim planı: tarih, lokasyon ve durum"
        action={
          <Button onClick={() => { setInitialForm(empty); setOpen(true); }}>
            <span className="flex items-center gap-1.5"><Plus className="h-4 w-4" /> Yeni Çekim</span>
          </Button>
        }
      />

      <div className="grid gap-3 md:grid-cols-2">
        {sorted.map((sh) => {
          const brandName = brandMap.get(sh.brand_id || "");
          return (
            <div key={sh.id} className="card p-4">
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-semibold text-foreground">{sh.title}</p>
                  <p className="mt-0.5 text-xs text-muted">{brandName || "—"} · {sh.shoot_type || "—"}</p>
                </div>
                <Badge tone={shootStatus[sh.status].tone}>{shootStatus[sh.status].label}</Badge>
              </div>
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
                <span className="flex items-center gap-1"><Clock className="h-3.5 w-3.5" /> {dt(sh.scheduled_at)}</span>
                <span className="flex items-center gap-1"><MapPin className="h-3.5 w-3.5" /> {sh.location || "—"}</span>
              </div>
              <div className="mt-3 flex justify-end gap-1 border-t border-border pt-2">
                <button onClick={() => { setInitialForm(sh); setOpen(true); }} className="rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-foreground"><Pencil className="h-4 w-4" /></button>
                <button onClick={() => remove("shoots", sh.id)} className="rounded-md p-1.5 text-muted hover:bg-danger/15 hover:text-danger"><Trash2 className="h-4 w-4" /></button>
              </div>
            </div>
          );
        })}
        {shoots.length === 0 && <p className="col-span-full py-10 text-center text-muted">Henüz çekim yok.</p>}
      </div>

      <ShootModal open={open} onClose={() => setOpen(false)} initial={initialForm} brands={brands} />
    </>
  );
}
