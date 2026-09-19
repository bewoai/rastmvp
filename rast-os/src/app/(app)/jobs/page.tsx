"use client";

import { useState } from "react";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { PageHeader, Badge, StatCard } from "@/components/ui";
import { Modal, Field, Input, Select, Textarea, Button } from "@/components/form";
import { useStore, useHydrated, uid, nowISO } from "@/lib/store";
import { jobStatus, paymentStatus, TRY, dateTR } from "@/lib/labels";
import type { Job, JobStatus, PaymentStatus } from "@/lib/types";

const empty: Job = {
  id: "", customer_name: "", contact: "", service: "", job_type: "",
  date: "", price: 0, cost: undefined, paid_amount: 0,
  status: "quote", payment_status: "unpaid", notes: "", created_at: "",
};

const jobTypes = ["Gelir", "Çekim", "Video", "Tasarım", "Etkinlik", "Drone", "Fotoğraf", "Web", "Baskı", "Diğer"];

export default function JobsPage() {
  const hydrated = useHydrated();
  const jobs = useStore((s) => s.jobs);
  const add = useStore((s) => s.add);
  const update = useStore((s) => s.update);
  const remove = useStore((s) => s.remove);

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Job>(empty);
  const editing = Boolean(form.id);

  const active = hydrated ? jobs.filter((j) => j.status !== "cancelled") : [];
  const revenue = active.reduce((a, j) => a + j.price, 0);
  const collected = active.reduce((a, j) => a + j.paid_amount, 0);
  const outstanding = revenue - collected;

  function save() {
    if (!form.customer_name.trim()) return;
    // ödeme durumunu tahsilata göre otomatik ayarla
    const price = Number(form.price) || 0;
    const paid = Number(form.paid_amount) || 0;
    const payment_status: PaymentStatus =
      paid <= 0 ? "unpaid" : paid >= price ? "paid" : "partial";
    const next = { ...form, price, paid_amount: paid, payment_status };
    if (editing) update("jobs", form.id, next);
    else add("jobs", { ...next, id: uid(), created_at: nowISO() });
    setOpen(false);
  }

  return (
    <>
      <PageHeader
        title="Tekil İşler"
        subtitle="Aylık müşteri olmayan, tek seferlik ücretli işler — çekim, video, tasarım, etkinlik…"
        action={
          <Button onClick={() => { setForm({ ...empty }); setOpen(true); }}>
            <span className="flex items-center gap-1.5"><Plus className="h-4 w-4" /> Yeni Tekil İş</span>
          </Button>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Toplam ciro" value={TRY(revenue)} tone="amber" />
        <StatCard label="Tahsil edilen" value={TRY(collected)} tone="success" />
        <StatCard label="Bekleyen tahsilat" value={TRY(outstanding)} tone="warning" />
        <StatCard label="İş sayısı" value={String(active.length)} />
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[900px] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted">
              <th className="px-4 py-3 font-medium">Müşteri</th>
              <th className="px-4 py-3 font-medium">Hizmet</th>
              <th className="px-4 py-3 font-medium">Tür</th>
              <th className="px-4 py-3 font-medium">Tarih</th>
              <th className="px-4 py-3 font-medium">Ücret</th>
              <th className="px-4 py-3 font-medium">Tahsil</th>
              <th className="px-4 py-3 font-medium">Durum</th>
              <th className="px-4 py-3 font-medium">Ödeme</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {hydrated && jobs.map((j) => (
              <tr key={j.id} className="border-b border-border/60 hover:bg-surface-2/50">
                <td className="px-4 py-3">
                  <p className="font-medium text-foreground">{j.customer_name}</p>
                  {j.contact && <p className="text-xs text-muted">{j.contact}</p>}
                </td>
                <td className="px-4 py-3 text-muted">{j.service || "—"}</td>
                <td className="px-4 py-3 text-muted">{j.job_type || "—"}</td>
                <td className="px-4 py-3 text-muted">{dateTR(j.date)}</td>
                <td className="px-4 py-3 text-foreground">{TRY(j.price)}</td>
                <td className="px-4 py-3 text-muted">{TRY(j.paid_amount)}</td>
                <td className="px-4 py-3">
                  <select
                    value={j.status}
                    onChange={(e) => update("jobs", j.id, { status: e.target.value as JobStatus })}
                    className="rounded-md border border-border bg-background px-2 py-1 text-xs text-muted outline-none focus:border-amber/60"
                  >
                    {Object.entries(jobStatus).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                  </select>
                </td>
                <td className="px-4 py-3">
                  <Badge tone={paymentStatus[j.payment_status].tone}>{paymentStatus[j.payment_status].label}</Badge>
                </td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-1">
                    <button onClick={() => { setForm({ ...j }); setOpen(true); }} className="rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-foreground"><Pencil className="h-4 w-4" /></button>
                    <button onClick={() => remove("jobs", j.id)} className="rounded-md p-1.5 text-muted hover:bg-danger/15 hover:text-danger"><Trash2 className="h-4 w-4" /></button>
                  </div>
                </td>
              </tr>
            ))}
            {hydrated && jobs.length === 0 && (
              <tr><td colSpan={9} className="px-4 py-10 text-center text-muted">Henüz tekil iş yok. “Yeni Tekil İş” ile ekleyin.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? "Tekil iş düzenle" : "Yeni tekil iş"}
        footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Vazgeç</Button><Button onClick={save}>Kaydet</Button></>}
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Müşteri / kişi *"><Input value={form.customer_name} onChange={(e) => setForm({ ...form, customer_name: e.target.value })} placeholder="Ad veya firma" /></Field>
          <Field label="İletişim"><Input value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value })} placeholder="Telefon / e-posta" /></Field>
          <div className="sm:col-span-2"><Field label="Hizmet / iş"><Input value={form.service} onChange={(e) => setForm({ ...form, service: e.target.value })} placeholder="Düğün çekimi, tanıtım videosu…" /></Field></div>
          <Field label="Tür">
            <Select value={form.job_type} onChange={(e) => setForm({ ...form, job_type: e.target.value })}>
              <option value="">Seçin</option>
              {jobTypes.map((t) => <option key={t}>{t}</option>)}
            </Select>
          </Field>
          <Field label="İş / teslim tarihi"><Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></Field>
          <Field label="Ücret (₺)"><Input type="number" value={form.price || ""} onChange={(e) => setForm({ ...form, price: Number(e.target.value) })} /></Field>
          <Field label="Tahsil edilen (₺)"><Input type="number" value={form.paid_amount || ""} onChange={(e) => setForm({ ...form, paid_amount: Number(e.target.value) })} /></Field>
          <Field label="Maliyet (₺, ops.)"><Input type="number" value={form.cost ?? ""} onChange={(e) => setForm({ ...form, cost: e.target.value ? Number(e.target.value) : undefined })} /></Field>
          <Field label="Durum">
            <Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as JobStatus })}>
              {Object.entries(jobStatus).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </Select>
          </Field>
          <div className="sm:col-span-2"><Field label="Notlar"><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field></div>
        </div>
      </Modal>
    </>
  );
}
