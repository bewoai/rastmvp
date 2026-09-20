"use client";

import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { PageHeader, Badge, EmptyState, StatStrip } from "@/components/ui";
import { FormModal, Field, Input, Select, Textarea, MoreFields, Button, useFormState } from "@/components/form";
import { DataTable, FilterChips, PageLoading, RowActions, SearchBox, StatusSelect, Toolbar, useListSearch, useNewIntent, usePersistentState } from "@/components/list";
import type { Column } from "@/components/list";
import { useDeleteConfirm } from "@/components/confirm";
import { useStore, useHydrated, uid, nowISO } from "@/lib/store";
import { patchRecord } from "@/lib/mutate";
import { jobStatus, paymentStatus, TRY, dateTR } from "@/lib/labels";
import type { Job, JobStatus, PaymentStatus } from "@/lib/types";

const empty: Job = {
  id: "", customer_name: "", contact: "", service: "", job_type: "",
  date: "", price: 0, cost: undefined, paid_amount: 0,
  status: "quote", payment_status: "unpaid", notes: "", created_at: "",
};

const jobTypes = ["Gelir", "Çekim", "Video", "Tasarım", "Etkinlik", "Drone", "Fotoğraf", "Web", "Baskı", "Diğer"];
const statusOptions = (Object.keys(jobStatus) as JobStatus[]).map((value) => ({ value, ...jobStatus[value] }));

type Scope = "all" | "running" | "unpaid";
const SCOPES: readonly Scope[] = ["all", "running", "unpaid"];

// ödeme durumunu tahsilata göre otomatik ayarla
const paymentOf = (price: number, paid: number): PaymentStatus => (paid <= 0 ? "unpaid" : paid >= price ? "paid" : "partial");

function JobModal({ initial, onClose }: { initial: Job | null; onClose: () => void }) {
  const f = useFormState<Job>(initial ?? empty);
  const editing = Boolean(initial?.id);
  const { form } = f;

  async function submit() {
    if (!form.customer_name.trim()) return { ok: false, error: "Müşteri / kişi adı zorunludur." };
    const price = Number(form.price) || 0;
    const paid = Number(form.paid_amount) || 0;
    const next = { ...form, customer_name: form.customer_name.trim(), price, paid_amount: paid, payment_status: paymentOf(price, paid) };
    const s = useStore.getState();
    return editing ? s.update("jobs", form.id, next) : s.add("jobs", { ...next, id: uid(), created_at: nowISO() });
  }

  return (
    <FormModal
      title={editing ? "Tekil iş düzenle" : "Yeni tekil iş"}
      onClose={onClose}
      onSubmit={submit}
      successMessage={editing ? "İş güncellendi" : "İş eklendi"}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2"><Field label="Müşteri / kişi *"><Input {...f.text("customer_name")} placeholder="Ad veya firma" autoComplete="off" /></Field></div>
        <div className="sm:col-span-2"><Field label="Hizmet / iş"><Input {...f.text("service")} placeholder="Düğün çekimi, tanıtım videosu…" /></Field></div>
        <Field label="Ücret (₺)"><Input type="number" inputMode="decimal" min="0" {...f.num("price", 0)} /></Field>
        <Field label="Tahsil edilen (₺)"><Input type="number" inputMode="decimal" min="0" {...f.num("paid_amount", 0)} /></Field>
        <Field label="İş / teslim tarihi"><Input type="date" {...f.text("date")} /></Field>
        <Field label="Durum">
          <Select {...f.text("status")}>
            {statusOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
        </Field>
        <MoreFields label="Ek alanlar (iletişim, tür, maliyet, not)" defaultOpen={editing}>
          <Field label="İletişim"><Input {...f.text("contact")} placeholder="Telefon / e-posta" /></Field>
          <Field label="Tür">
            <Select {...f.text("job_type")}>
              <option value="">Seçin</option>
              {jobTypes.map((t) => <option key={t}>{t}</option>)}
            </Select>
          </Field>
          <Field label="Maliyet (₺, ops.)"><Input type="number" inputMode="decimal" min="0" {...f.num("cost")} /></Field>
          <div className="sm:col-span-2"><Field label="Notlar"><Textarea {...f.text("notes")} /></Field></div>
        </MoreFields>
      </div>
    </FormModal>
  );
}

export default function JobsPage() {
  const hydrated = useHydrated(["jobs"]);
  const jobs = useStore((s) => s.jobs);

  const wantNew = useNewIntent();
  const [modal, setModal] = useState<{ initial: Job | null } | null>(() => (wantNew ? { initial: null } : null));
  const [scope, setScope] = usePersistentState<Scope>("jobs-scope", "all", SCOPES);
  const [query, setQuery] = useState("");
  const del = useDeleteConfirm();

  const stats = useMemo(() => {
    let revenue = 0, collected = 0, count = 0, running = 0, unpaid = 0;
    for (const j of jobs) {
      if (j.status === "cancelled") continue;
      count++;
      revenue += j.price;
      collected += j.paid_amount;
      if (j.status !== "delivered") running++;
      if (j.paid_amount < j.price) unpaid++;
    }
    return { revenue, collected, outstanding: revenue - collected, count, running, unpaid };
  }, [jobs]);

  const scoped = useMemo(() => {
    if (scope === "running") return jobs.filter((j) => j.status !== "delivered" && j.status !== "cancelled");
    if (scope === "unpaid") return jobs.filter((j) => j.status !== "cancelled" && j.paid_amount < j.price);
    return jobs;
  }, [jobs, scope]);
  const visible = useListSearch(scoped, query, (j) => `${j.customer_name} ${j.contact ?? ""} ${j.service ?? ""} ${j.job_type ?? ""}`);

  const columns = useMemo<Column<Job>[]>(() => [
    {
      key: "customer", header: "Müşteri", tone: "primary", mobile: "title", sort: (j) => j.customer_name,
      cell: (j) => (
        <>
          <span className="block max-w-[20rem] truncate">{j.customer_name}</span>
          {j.contact && <span className="block max-w-[20rem] truncate text-xs font-normal text-muted">{j.contact}</span>}
        </>
      ),
    },
    { key: "service", header: "Hizmet", sort: (j) => j.service, cell: (j) => <span className="block max-w-[16rem] truncate">{j.service || "—"}</span> },
    { key: "type", header: "Tür", mobile: "hide", sort: (j) => j.job_type, cell: (j) => j.job_type || "—" },
    { key: "date", header: "Tarih", sort: (j) => j.date, cell: (j) => dateTR(j.date) },
    { key: "price", header: "Ücret", tone: "strong", sort: (j) => j.price, cell: (j) => TRY(j.price) },
    {
      key: "paid", header: "Tahsil", sort: (j) => j.paid_amount,
      cell: (j) => (
        <>
          <span>{TRY(j.paid_amount)}</span>
          {j.status !== "cancelled" && j.price > j.paid_amount && <span className="block text-xs text-warning">Kalan {TRY(j.price - j.paid_amount)}</span>}
        </>
      ),
    },
    {
      key: "status", header: "Durum", mobile: "badge", sort: (j) => Object.keys(jobStatus).indexOf(j.status),
      cell: (j) => (
        <StatusSelect value={j.status} options={statusOptions} label={`Durum: ${j.customer_name}`} onChange={(status) => patchRecord("jobs", j.id, { status }, "Durum güncellenemedi")} />
      ),
    },
    {
      key: "payment", header: "Ödeme", mobile: "badge", sort: (j) => ["unpaid", "partial", "paid"].indexOf(j.payment_status),
      cell: (j) => <Badge tone={paymentStatus[j.payment_status].tone}>{paymentStatus[j.payment_status].label}</Badge>,
    },
  ], []);

  if (!hydrated) return <PageLoading title="Tekil İşler" />;

  return (
    <>
      <PageHeader
        title="Tekil İşler"
        subtitle="Aylık müşteri olmayan, tek seferlik ücretli işler — çekim, video, tasarım, etkinlik…"
        action={
          <Button onClick={() => setModal({ initial: null })}>
            <Plus className="h-4 w-4" aria-hidden /> Yeni Tekil İş
          </Button>
        }
      />

      <StatStrip
        items={[
          { label: "Toplam ciro", value: TRY(stats.revenue), tone: "amber" },
          { label: "Tahsil edilen", value: TRY(stats.collected), tone: "success" },
          { label: "Bekleyen tahsilat", value: TRY(stats.outstanding), tone: "warning" },
          { label: "İş sayısı", value: String(stats.count) },
        ]}
      />

      <Toolbar>
        <FilterChips
          label="İş kapsamı"
          value={scope}
          onChange={setScope}
          options={[
            { id: "all", label: "Tümü", count: jobs.length },
            { id: "running", label: "Devam eden", count: stats.running },
            { id: "unpaid", label: "Tahsilat bekleyen", count: stats.unpaid },
          ]}
        />
        <SearchBox value={query} onChange={setQuery} placeholder="Müşteri, hizmet ara…" label="Tekil iş ara" />
      </Toolbar>

      <DataTable
        columns={columns}
        rows={visible}
        rowKey={(j) => j.id}
        onOpen={(j) => setModal({ initial: j })}
        openLabel={(j) => `Düzenle: ${j.customer_name}`}
        actions={(j) => (
          <RowActions label={j.customer_name} onEdit={() => setModal({ initial: j })} onDelete={() => del.ask({ key: "jobs", id: j.id, label: j.customer_name })} />
        )}
        empty={
          jobs.length === 0 ? (
            <EmptyState title="Henüz tekil iş yok" hint="Tek seferlik çekim, video veya tasarım işlerini buradan takip et." action={{ label: "Yeni Tekil İş", onClick: () => setModal({ initial: null }) }} />
          ) : (
            <EmptyState title="Eşleşen iş yok" hint={query ? "Aramayı değiştir." : "Bu kapsamda iş bulunmuyor."} />
          )
        }
      />

      {modal && <JobModal initial={modal.initial} onClose={() => setModal(null)} />}
      {del.dialog}
    </>
  );
}
