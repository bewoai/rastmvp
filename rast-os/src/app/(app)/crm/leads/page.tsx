"use client";

import { useState } from "react";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { PageHeader, Badge } from "@/components/ui";
import { Modal, Field, Input, Select, Textarea, Button } from "@/components/form";
import { useStore, useHydrated, uid, nowISO } from "@/lib/store";
import { leadStatus, leadPipeline, TRY, dateTR } from "@/lib/labels";
import type { Lead, LeadStatus } from "@/lib/types";

const empty: Lead = {
  id: "", company_name: "", contact_person: "", phone: "", email: "",
  source: "", interested_in: "", est_budget: undefined, status: "new",
  next_followup_at: "", notes: "", created_at: "",
};

export default function LeadsPage() {
  const hydrated = useHydrated();
  const leads = useStore((s) => s.leads);
  const add = useStore((s) => s.add);
  const update = useStore((s) => s.update);
  const remove = useStore((s) => s.remove);

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Lead>(empty);
  const editing = Boolean(form.id);

  function openNew() {
    setForm({ ...empty });
    setOpen(true);
  }
  function openEdit(l: Lead) {
    setForm({ ...l });
    setOpen(true);
  }
  function save() {
    if (!form.company_name.trim()) return;
    if (editing) {
      update("leads", form.id, form);
    } else {
      add("leads", { ...form, id: uid(), created_at: nowISO() });
    }
    setOpen(false);
  }

  return (
    <>
      <PageHeader
        title="Potansiyel Müşteriler"
        subtitle="Henüz müşteriye dönüşmemiş firma ve kişiler"
        action={
          <Button onClick={openNew}>
            <span className="flex items-center gap-1.5">
              <Plus className="h-4 w-4" /> Yeni Lead
            </span>
          </Button>
        }
      />

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[820px] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted">
              <th className="px-4 py-3 font-medium">Firma</th>
              <th className="px-4 py-3 font-medium">Kişi</th>
              <th className="px-4 py-3 font-medium">Kaynak</th>
              <th className="px-4 py-3 font-medium">İlgilendiği</th>
              <th className="px-4 py-3 font-medium">Bütçe</th>
              <th className="px-4 py-3 font-medium">Durum</th>
              <th className="px-4 py-3 font-medium">Takip</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {hydrated &&
              leads.map((l) => (
                <tr key={l.id} className="border-b border-border/60 hover:bg-surface-2/50">
                  <td className="px-4 py-3 font-medium text-foreground">{l.company_name}</td>
                  <td className="px-4 py-3 text-muted">{l.contact_person || "—"}</td>
                  <td className="px-4 py-3 text-muted">{l.source || "—"}</td>
                  <td className="px-4 py-3 text-muted">{l.interested_in || "—"}</td>
                  <td className="px-4 py-3 text-foreground">{l.est_budget ? TRY(l.est_budget) : "—"}</td>
                  <td className="px-4 py-3">
                    <Badge tone={leadStatus[l.status].tone}>{leadStatus[l.status].label}</Badge>
                  </td>
                  <td className="px-4 py-3 text-muted">{dateTR(l.next_followup_at)}</td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1">
                      <button onClick={() => openEdit(l)} className="rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-foreground" aria-label="Düzenle">
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button onClick={() => remove("leads", l.id)} className="rounded-md p-1.5 text-muted hover:bg-danger/15 hover:text-danger" aria-label="Sil">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            {hydrated && leads.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-muted">
                  Henüz lead yok. “Yeni Lead” ile ekleyin.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? "Lead düzenle" : "Yeni lead"}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>Vazgeç</Button>
            <Button onClick={save}>Kaydet</Button>
          </>
        }
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Firma adı *">
            <Input value={form.company_name} onChange={(e) => setForm({ ...form, company_name: e.target.value })} placeholder="Firma" />
          </Field>
          <Field label="Yetkili kişi">
            <Input value={form.contact_person} onChange={(e) => setForm({ ...form, contact_person: e.target.value })} />
          </Field>
          <Field label="Telefon">
            <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </Field>
          <Field label="E-posta">
            <Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </Field>
          <Field label="Kaynak">
            <Select value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })}>
              <option value="">Seçin</option>
              <option>Referans</option>
              <option>Instagram</option>
              <option>Web sitesi</option>
              <option>Reklam</option>
              <option>LinkedIn</option>
              <option>Organik</option>
            </Select>
          </Field>
          <Field label="Tahmini bütçe (₺)">
            <Input type="number" value={form.est_budget ?? ""} onChange={(e) => setForm({ ...form, est_budget: e.target.value ? Number(e.target.value) : undefined })} />
          </Field>
          <Field label="İlgilendiği hizmet">
            <Input value={form.interested_in} onChange={(e) => setForm({ ...form, interested_in: e.target.value })} />
          </Field>
          <Field label="Durum">
            <Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as LeadStatus })}>
              {leadPipeline.map((s) => (
                <option key={s} value={s}>{leadStatus[s].label}</option>
              ))}
            </Select>
          </Field>
          <Field label="Sonraki takip">
            <Input type="date" value={form.next_followup_at} onChange={(e) => setForm({ ...form, next_followup_at: e.target.value })} />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Notlar">
              <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </Field>
          </div>
        </div>
      </Modal>
    </>
  );
}
