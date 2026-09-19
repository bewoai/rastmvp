"use client";

import { useState } from "react";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/ui";
import { Modal, Field, Input, Select, Textarea, Button } from "@/components/form";
import { useStore, useHydrated, uid, nowISO } from "@/lib/store";
import type { Brand } from "@/lib/types";

const empty: Brand = {
  id: "", client_id: "", name: "", tone: "", target_audience: "",
  color_palette: "", website: "", instagram: "", notes: "", created_at: "",
};

export default function BrandsPage() {
  const hydrated = useHydrated();
  const brands = useStore((s) => s.brands);
  const clients = useStore((s) => s.clients);
  const add = useStore((s) => s.add);
  const update = useStore((s) => s.update);
  const remove = useStore((s) => s.remove);

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Brand>(empty);
  const editing = Boolean(form.id);

  function save() {
    if (!form.name.trim()) return;
    if (editing) update("brands", form.id, form);
    else add("brands", { ...form, id: uid(), created_at: nowISO() });
    setOpen(false);
  }

  return (
    <>
      <PageHeader
        title="Markalar"
        subtitle="Her müşterinin bir veya birden fazla markası olabilir"
        action={
          <Button onClick={() => { setForm({ ...empty }); setOpen(true); }}>
            <span className="flex items-center gap-1.5"><Plus className="h-4 w-4" /> Yeni Marka</span>
          </Button>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {hydrated && brands.map((b) => {
          const client = clients.find((c) => c.id === b.client_id);
          return (
            <div key={b.id} className="card p-4">
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-semibold text-foreground">{b.name}</p>
                  <p className="mt-0.5 text-xs text-muted">{client?.name || "—"}</p>
                </div>
                <div className="flex gap-1">
                  <button onClick={() => { setForm({ ...b }); setOpen(true); }} className="rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-foreground"><Pencil className="h-4 w-4" /></button>
                  <button onClick={() => remove("brands", b.id)} className="rounded-md p-1.5 text-muted hover:bg-danger/15 hover:text-danger"><Trash2 className="h-4 w-4" /></button>
                </div>
              </div>
              {b.tone && <p className="mt-2 text-sm text-muted"><span className="text-foreground">Ton:</span> {b.tone}</p>}
              {b.target_audience && <p className="mt-1 text-sm text-muted"><span className="text-foreground">Kitle:</span> {b.target_audience}</p>}
              {b.instagram && <p className="mt-1 text-sm text-amber">{b.instagram}</p>}
            </div>
          );
        })}
        {hydrated && brands.length === 0 && <p className="col-span-full py-10 text-center text-muted">Henüz marka yok.</p>}
      </div>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? "Marka düzenle" : "Yeni marka"}
        footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Vazgeç</Button><Button onClick={save}>Kaydet</Button></>}
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Marka adı *"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="Müşteri">
            <Select value={form.client_id} onChange={(e) => setForm({ ...form, client_id: e.target.value })}>
              <option value="">Seçin</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
          <Field label="Marka tonu"><Input value={form.tone} onChange={(e) => setForm({ ...form, tone: e.target.value })} /></Field>
          <Field label="Hedef kitle"><Input value={form.target_audience} onChange={(e) => setForm({ ...form, target_audience: e.target.value })} /></Field>
          <Field label="Instagram"><Input value={form.instagram} onChange={(e) => setForm({ ...form, instagram: e.target.value })} placeholder="@marka" /></Field>
          <Field label="Web sitesi"><Input value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} /></Field>
          <div className="sm:col-span-2"><Field label="Notlar"><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field></div>
        </div>
      </Modal>
    </>
  );
}
