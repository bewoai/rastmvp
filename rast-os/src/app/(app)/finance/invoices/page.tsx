"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ExternalLink, Plus } from "lucide-react";
import { PageHeader, Badge, EmptyState, StatStrip } from "@/components/ui";
import { FormModal, Field, Input, Select, Button, useFormState } from "@/components/form";
import { DataTable, FilterChips, PageLoading, RowActions, SearchBox, StatusSelect, Toolbar, useListSearch, useNewIntent, usePersistentState } from "@/components/list";
import type { Column } from "@/components/list";
import MonthFilter from "@/components/MonthFilter";
import type { PeriodMode } from "@/components/MonthFilter";
import { useDeleteConfirm } from "@/components/confirm";
import { useStore, useHydrated, uid, nowISO } from "@/lib/store";
import { useToday } from "@/lib/useToday";
import { patchRecord } from "@/lib/mutate";
import { invoiceStatus, TRY, dateTR } from "@/lib/labels";
import type { Invoice, InvoiceStatus, Client, Job } from "@/lib/types";

const empty: Invoice = {
  id: "", client_id: "", invoice_no: "", issue_date: "", due_date: "",
  amount: 0, vat: 0, paid_amount: 0, status: "issued", created_at: "",
};

const statusOptions = (Object.keys(invoiceStatus) as InvoiceStatus[]).map((value) => ({ value, ...invoiceStatus[value] }));

type IncomeView = "all" | "recurring" | "one_off";
const INCOME_VIEWS: readonly IncomeView[] = ["all", "recurring", "one_off"];
const PERIODS: readonly PeriodMode[] = ["month", "all"];

type Row = {
  id: string;
  kind: "recurring" | "one_off";
  record: string;
  client: string;
  date?: string;
  amount: number;
  paid: number;
  invoice?: Invoice;
  job?: Job;
};

function InvoiceModal({ initial, clients, today, onClose }: { initial: Invoice | null; clients: Client[]; today: string; onClose: () => void }) {
  // Yeni faturada tarih bugün gelir: tarihsiz fatura "Seçili Ay" görünümünde kaybolurdu.
  const f = useFormState<Invoice>(initial ?? { ...empty, issue_date: today });
  const editing = Boolean(initial?.id);
  const { form } = f;
  const total = (form.amount || 0) + (form.vat || 0);

  async function submit() {
    if (!(form.amount > 0)) return { ok: false, error: "Tutar girin." };
    const s = useStore.getState();
    return editing ? s.update("invoices", form.id, form) : s.add("invoices", { ...form, id: uid(), created_at: nowISO() });
  }

  return (
    <FormModal
      title={editing ? "Fatura düzenle" : "Yeni fatura"}
      onClose={onClose}
      onSubmit={submit}
      successMessage={editing ? "Fatura güncellendi" : "Fatura eklendi"}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Müşteri">
          <Select {...f.text("client_id")}>
            <option value="">Seçin</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
        <Field label="Fatura no"><Input {...f.text("invoice_no")} autoComplete="off" /></Field>
        <Field label="Tutar (₺) *"><Input type="number" inputMode="decimal" min="0" {...f.num("amount", 0)} /></Field>
        <Field label="KDV (₺)"><Input type="number" inputMode="decimal" min="0" {...f.num("vat", 0)} /></Field>
        <Field label="Fatura tarihi"><Input type="date" {...f.text("issue_date")} /></Field>
        <Field label="Vade tarihi"><Input type="date" {...f.text("due_date")} /></Field>
        <Field label="Tahsil edilen (₺)"><Input type="number" inputMode="decimal" min="0" {...f.num("paid_amount", 0)} /></Field>
        <Field label="Durum">
          <Select {...f.text("status")}>
            {statusOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
        </Field>
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-surface-2/50 px-3.5 py-2.5 text-xs text-muted sm:col-span-2">
          <span>Toplam (KDV dahil): <strong className="text-foreground">{TRY(total)}</strong> · Kalan: <strong className={total - (form.paid_amount || 0) > 0 ? "text-warning" : "text-success"}>{TRY(Math.max(total - (form.paid_amount || 0), 0))}</strong></span>
          <button
            type="button"
            onClick={() => { f.set("paid_amount", total); f.set("status", "paid"); }}
            disabled={total <= 0}
            className="rounded-md px-1 text-amber outline-none hover:text-amber-hi focus-visible:ring-2 focus-visible:ring-amber/60 disabled:opacity-40"
          >
            Tamamı tahsil edildi
          </button>
        </div>
      </div>
    </FormModal>
  );
}

export default function InvoicesPage() {
  const hydrated = useHydrated(["invoices", "clients", "jobs"]);
  const invoices = useStore((s) => s.invoices);
  const clients = useStore((s) => s.clients);
  const jobs = useStore((s) => s.jobs);
  const today = useToday();

  const wantNew = useNewIntent();
  const [modal, setModal] = useState<{ initial: Invoice | null } | null>(() => (wantNew ? { initial: null } : null));
  const [incomeView, setIncomeView] = usePersistentState<IncomeView>("invoices-income-view", "all", INCOME_VIEWS);
  const [periodView, setPeriodView] = usePersistentState<PeriodMode>("finance-period", "month", PERIODS);
  const [selectedMonth, setSelectedMonth] = useState(() => today.slice(0, 7));
  const [query, setQuery] = useState("");
  const del = useDeleteConfirm();

  const clientMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of clients) map.set(c.id, c.name);
    return map;
  }, [clients]);

  const { rows, collected, revenue } = useMemo(() => {
    const inPeriod = (date: string | undefined) => periodView === "all" || Boolean(date?.startsWith(selectedMonth));
    const visibleInvoices = incomeView === "one_off" ? [] : invoices.filter((invoice) => inPeriod(invoice.issue_date));
    const visibleJobs = incomeView === "recurring" ? [] : jobs.filter((job) => job.status !== "cancelled" && inPeriod(job.date));

    const collected = visibleInvoices.reduce((sum, i) => sum + i.paid_amount, 0) + visibleJobs.reduce((sum, j) => sum + j.paid_amount, 0);
    const revenue = visibleInvoices.reduce((sum, i) => sum + i.amount + i.vat, 0) + visibleJobs.reduce((sum, j) => sum + j.price, 0);

    const rows: Row[] = [
      ...visibleInvoices.map((invoice): Row => ({
        id: invoice.id, kind: "recurring", record: invoice.invoice_no || "Aylık gelir",
        client: clientMap.get(invoice.client_id || "") || "—",
        date: invoice.issue_date, amount: invoice.amount + invoice.vat, paid: invoice.paid_amount, invoice,
      })),
      ...visibleJobs.map((job): Row => ({
        id: job.id, kind: "one_off", record: job.service || "Tekil iş",
        client: job.customer_name, date: job.date, amount: job.price, paid: job.paid_amount, job,
      })),
    ].sort((a, b) => String(b.date ?? "").localeCompare(String(a.date ?? "")));

    return { rows, collected, revenue };
  }, [invoices, jobs, periodView, incomeView, selectedMonth, clientMap]);

  const visible = useListSearch(rows, query, (r) => `${r.record} ${r.client}`);

  const columns = useMemo<Column<Row>[]>(() => [
    {
      key: "record", header: "Kayıt", tone: "primary", mobile: "title", sort: (r) => r.record,
      cell: (r) => (
        <>
          <span className="block max-w-[20rem] truncate">{r.record}</span>
          <span className="block max-w-[20rem] truncate text-xs font-normal text-muted">{r.client}</span>
        </>
      ),
    },
    { key: "kind", header: "Tür", mobile: "hide", cell: (r) => <Badge tone={r.kind === "recurring" ? "amber" : "muted"}>{r.kind === "recurring" ? "Aylık" : "Tekil"}</Badge> },
    { key: "date", header: "Tarih", sort: (r) => r.date, cell: (r) => dateTR(r.date) },
    { key: "amount", header: "Tutar", tone: "strong", sort: (r) => r.amount, cell: (r) => TRY(r.amount) },
    { key: "paid", header: "Tahsil", sort: (r) => r.paid, cell: (r) => TRY(r.paid) },
    {
      key: "left", header: "Kalan", sort: (r) => r.amount - r.paid,
      cell: (r) => {
        const left = r.amount - r.paid;
        return <span className={left > 0 ? "text-warning" : undefined}>{TRY(left)}</span>;
      },
    },
    {
      key: "status", header: "Durum", mobile: "badge",
      cell: (r) =>
        r.invoice ? (
          <StatusSelect
            value={r.invoice.status}
            options={statusOptions}
            label={`Durum: ${r.record}`}
            onChange={(status) => patchRecord("invoices", r.invoice!.id, { status }, "Durum güncellenemedi")}
          />
        ) : (
          <Badge tone={r.paid >= r.amount ? "success" : "warning"}>{r.paid >= r.amount ? "Ödendi" : "Bekliyor"}</Badge>
        ),
    },
  ], []);

  if (!hydrated) return <PageLoading title="Gelirler / Faturalar" />;

  return (
    <>
      <PageHeader
        title="Gelirler / Faturalar"
        subtitle="Aylık müşteri gelirleri, tekil işler ve tahsilat takibi"
        action={
          <Button onClick={() => setModal({ initial: null })}>
            <Plus className="h-4 w-4" aria-hidden /> Yeni Fatura
          </Button>
        }
      />

      <StatStrip
        items={[
          { label: "Toplam gelir", value: TRY(revenue), tone: "amber" },
          { label: "Tahsil edilen", value: TRY(collected), tone: "success" },
          { label: "Bekleyen tahsilat", value: TRY(revenue - collected), tone: "warning" },
          { label: "Kayıt sayısı", value: String(rows.length) },
        ]}
      />

      <Toolbar>
        <FilterChips
          label="Gelir türü"
          value={incomeView}
          onChange={setIncomeView}
          options={[
            { id: "all", label: "Tüm Gelirler" },
            { id: "recurring", label: "Aylık Müşteriler" },
            { id: "one_off", label: "Tekil İşler" },
          ]}
        />
        <MonthFilter mode={periodView} month={selectedMonth} onModeChange={setPeriodView} onMonthChange={setSelectedMonth} />
        <SearchBox value={query} onChange={setQuery} placeholder="Kayıt, müşteri ara…" label="Gelir kaydı ara" />
      </Toolbar>

      <DataTable
        columns={columns}
        rows={visible}
        rowKey={(r) => `${r.kind}-${r.id}`}
        onOpen={(r) => r.invoice && setModal({ initial: r.invoice })}
        openLabel={(r) => `Düzenle: ${r.record}`}
        actions={(r) =>
          r.invoice ? (
            <RowActions
              label={r.record}
              onEdit={() => setModal({ initial: r.invoice! })}
              onDelete={() => del.ask({ key: "invoices", id: r.invoice!.id, label: r.record })}
            />
          ) : (
            <div className="flex justify-end">
              <Link
                href="/jobs"
                prefetch={false}
                aria-label={`Tekil İşler'de aç: ${r.record}`}
                title="Tekil İşler'de düzenle"
                className="flex h-10 w-10 items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface-2 hover:text-foreground md:h-8 md:w-8"
              >
                <ExternalLink className="h-4 w-4" aria-hidden />
              </Link>
            </div>
          )
        }
        empty={
          <EmptyState
            title={query ? "Eşleşen kayıt yok" : "Bu dönemde gelir kaydı yok"}
            hint={query ? "Aramayı değiştir." : "Başka bir ay seç, “Tüm Dönem”e bak veya yeni fatura ekle."}
            action={query ? undefined : { label: "Yeni Fatura", onClick: () => setModal({ initial: null }) }}
          />
        }
      />

      {modal && <InvoiceModal initial={modal.initial} clients={clients} today={today} onClose={() => setModal(null)} />}
      {del.dialog}
    </>
  );
}
