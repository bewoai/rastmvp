"use client";

import { useState, useMemo, memo } from "react";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { PageHeader, Badge, StatCard } from "@/components/ui";
import { Modal, Field, Input, Select, Button } from "@/components/form";
import MonthFilter from "@/components/MonthFilter";
import { useStore, useHydrated, uid, nowISO } from "@/lib/store";
import { invoiceStatus, TRY, dateTR } from "@/lib/labels";
import type { Invoice, InvoiceStatus, Client } from "@/lib/types";

const empty: Invoice = {
  id: "", client_id: "", invoice_no: "", issue_date: "", due_date: "",
  amount: 0, vat: 0, paid_amount: 0, status: "issued", created_at: "",
};

const InvoiceModal = memo(function InvoiceModal({
  open, onClose, initial, clients
}: {
  open: boolean, onClose: () => void, initial: Invoice | null, clients: Client[]
}) {
  const [form, setForm] = useState<Invoice>(empty);
  const editing = Boolean(form.id);

  useMemo(() => {
    if (open) setForm(initial || empty);
  }, [open, initial]);

  const add = useStore((s) => s.add);
  const update = useStore((s) => s.update);

  function save() {
    if (editing) update("invoices", form.id, form);
    else add("invoices", { ...form, id: uid(), created_at: nowISO() });
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? "Fatura düzenle" : "Yeni fatura"}
      footer={<><Button variant="ghost" onClick={onClose}>Vazgeç</Button><Button onClick={save}>Kaydet</Button></>}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Fatura no"><Input value={form.invoice_no} onChange={(e) => setForm({ ...form, invoice_no: e.target.value })} /></Field>
        <Field label="Müşteri">
          <Select value={form.client_id} onChange={(e) => setForm({ ...form, client_id: e.target.value })}>
            <option value="">Seçin</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
        <Field label="Tutar (₺)"><Input type="number" value={form.amount || ""} onChange={(e) => setForm({ ...form, amount: Number(e.target.value) })} /></Field>
        <Field label="KDV (₺)"><Input type="number" value={form.vat || ""} onChange={(e) => setForm({ ...form, vat: Number(e.target.value) })} /></Field>
        <Field label="Tahsil edilen (₺)"><Input type="number" value={form.paid_amount || ""} onChange={(e) => setForm({ ...form, paid_amount: Number(e.target.value) })} /></Field>
        <Field label="Durum">
          <Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as InvoiceStatus })}>
            {Object.entries(invoiceStatus).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </Select>
        </Field>
        <Field label="Fatura tarihi"><Input type="date" value={form.issue_date} onChange={(e) => setForm({ ...form, issue_date: e.target.value })} /></Field>
        <Field label="Vade tarihi"><Input type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} /></Field>
      </div>
    </Modal>
  );
});

export default function InvoicesPage() {
  const hydrated = useHydrated(["invoices", "clients", "jobs"]);
  const invoices = useStore((s) => s.invoices);
  const clients = useStore((s) => s.clients);
  const jobs = useStore((s) => s.jobs);
  const update = useStore((s) => s.update);
  const remove = useStore((s) => s.remove);

  const [open, setOpen] = useState(false);
  const [initialForm, setInitialForm] = useState<Invoice | null>(null);

  const now = new Date();
  const defaultMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const [incomeView, setIncomeView] = useState<"all" | "recurring" | "one_off">("all");
  const [periodView, setPeriodView] = useState<"month" | "all">("month");
  const [selectedMonth, setSelectedMonth] = useState(defaultMonth);

  const clientMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of clients) map.set(c.id, c.name);
    return map;
  }, [clients]);

  const stats = useMemo(() => {
    if (!hydrated) return { collected: 0, revenue: 0, outstanding: 0, incomeRows: [] };
    
    const inPeriod = (date: string | undefined) => periodView === "all" || Boolean(date?.startsWith(selectedMonth));
    const visibleInvoices = incomeView === "one_off" ? [] : invoices.filter((invoice) => inPeriod(invoice.issue_date));
    const visibleJobs = incomeView === "recurring" ? [] : jobs.filter((job) => job.status !== "cancelled" && inPeriod(job.date));
    
    const collected = visibleInvoices.reduce((sum, invoice) => sum + invoice.paid_amount, 0)
        + visibleJobs.reduce((sum, job) => sum + job.paid_amount, 0);
    const revenue = visibleInvoices.reduce((sum, invoice) => sum + invoice.amount + invoice.vat, 0)
        + visibleJobs.reduce((sum, job) => sum + job.price, 0);
    const outstanding = revenue - collected;
    
    const incomeRows = [
      ...visibleInvoices.map((invoice) => ({
        id: invoice.id, kind: "recurring" as const, record: invoice.invoice_no || "Aylık gelir",
        client: clientMap.get(invoice.client_id || "") || "—",
        date: invoice.issue_date, amount: invoice.amount + invoice.vat, paid: invoice.paid_amount,
        status: invoice.status, invoice,
      })),
      ...visibleJobs.map((job) => ({
        id: job.id, kind: "one_off" as const, record: job.service || "Tekil iş",
        client: job.customer_name, date: job.date, amount: job.price, paid: job.paid_amount,
        status: job.payment_status, job,
      })),
    ].sort((a, b) => String(b.date ?? "").localeCompare(String(a.date ?? "")));

    return { collected, revenue, outstanding, incomeRows };
  }, [hydrated, invoices, jobs, periodView, incomeView, selectedMonth, clientMap]);

  if (!hydrated) return <PageHeader title="Gelirler / Faturalar" subtitle="Yükleniyor…" />;

  return (
    <>
      <PageHeader
        title="Gelirler / Faturalar"
        subtitle="Aylık müşteri gelirleri, tekil işler ve tahsilat takibi"
        action={
          <Button onClick={() => { setInitialForm(empty); setOpen(true); }}>
            <span className="flex items-center gap-1.5"><Plus className="h-4 w-4" /> Yeni Fatura</span>
          </Button>
        }
      />

      <div className="mb-4 flex flex-col gap-3 rounded-xl border border-border bg-surface p-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap gap-2">
          {([
            ["all", "Tüm Gelirler"], ["recurring", "Aylık Müşteriler"], ["one_off", "Tekil İşler"],
          ] as const).map(([value, label]) => (
            <button key={value} onClick={() => setIncomeView(value)} className={`rounded-lg px-3 py-2 text-sm ${incomeView === value ? "bg-amber text-background" : "bg-surface-2 text-muted hover:text-foreground"}`}>
              {label}
            </button>
          ))}
        </div>
        <MonthFilter mode={periodView} month={selectedMonth} onModeChange={setPeriodView} onMonthChange={setSelectedMonth} />
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Toplam gelir" value={TRY(stats.revenue)} tone="amber" />
        <StatCard label="Tahsil edilen" value={TRY(stats.collected)} tone="success" />
        <StatCard label="Bekleyen tahsilat" value={TRY(stats.outstanding)} tone="warning" />
        <StatCard label="Kayıt sayısı" value={String(hydrated ? stats.incomeRows.length : 0)} />
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[980px] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted">
              <th className="px-4 py-3 font-medium">Kayıt</th>
              <th className="px-4 py-3 font-medium">Müşteri</th>
              <th className="px-4 py-3 font-medium">Tür</th>
              <th className="px-4 py-3 font-medium">Tarih</th>
              <th className="px-4 py-3 font-medium">Tutar</th>
              <th className="px-4 py-3 font-medium">Tahsil</th>
              <th className="px-4 py-3 font-medium">Kalan</th>
              <th className="px-4 py-3 font-medium">Durum</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {hydrated && stats.incomeRows.map((row) => (
                <tr key={`${row.kind}-${row.id}`} className="border-b border-border/60 hover:bg-surface-2/50">
                  <td className="px-4 py-3 font-medium text-foreground">{row.record}</td>
                  <td className="px-4 py-3 text-muted">{row.client}</td>
                  <td className="px-4 py-3"><Badge tone={row.kind === "recurring" ? "amber" : "muted"}>{row.kind === "recurring" ? "Aylık" : "Tekil"}</Badge></td>
                  <td className="px-4 py-3 text-muted">{dateTR(row.date)}</td>
                  <td className="px-4 py-3 text-foreground">{TRY(row.amount)}</td>
                  <td className="px-4 py-3 text-muted">{TRY(row.paid)}</td>
                  <td className="px-4 py-3 text-muted">{TRY(row.amount - row.paid)}</td>
                  <td className="px-4 py-3">
                    {row.kind === "recurring" ? <select
                      value={row.invoice.status}
                      onChange={(e) => update("invoices", row.invoice.id, { status: e.target.value as InvoiceStatus })}
                      className="rounded-md border border-border bg-background px-2 py-1 text-xs text-muted outline-none focus:border-amber/60"
                    >
                      {Object.entries(invoiceStatus).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                    </select> : <Badge tone={row.paid >= row.amount ? "success" : "warning"}>{row.paid >= row.amount ? "Ödendi" : "Bekliyor"}</Badge>}
                  </td>
                  <td className="px-4 py-3">
                    {row.kind === "recurring" && <div className="flex justify-end gap-1">
                      <button onClick={() => { setInitialForm({ ...row.invoice }); setOpen(true); }} className="rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-foreground"><Pencil className="h-4 w-4" /></button>
                      <button onClick={() => remove("invoices", row.invoice.id)} className="rounded-md p-1.5 text-muted hover:bg-danger/15 hover:text-danger"><Trash2 className="h-4 w-4" /></button>
                    </div>}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      <InvoiceModal open={open} onClose={() => setOpen(false)} initial={initialForm} clients={clients} />
    </>
  );
}
