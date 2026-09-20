"use client";

import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { PageHeader, Badge, EmptyState, StatStrip } from "@/components/ui";
import { FormModal, Field, Input, Select, MoreFields, Button, useFormState } from "@/components/form";
import { DataTable, FilterChips, PageLoading, RowActions, SearchBox, Toolbar, useListSearch, useNewIntent, usePersistentState } from "@/components/list";
import type { Column } from "@/components/list";
import MonthFilter from "@/components/MonthFilter";
import type { PeriodMode } from "@/components/MonthFilter";
import { useDeleteConfirm } from "@/components/confirm";
import { useStore, useHydrated, uid, nowISO } from "@/lib/store";
import { useToday } from "@/lib/useToday";
import { patchRecord } from "@/lib/mutate";
import { TRY, dateTR } from "@/lib/labels";
import { useFx, toTRY, money, CURRENCIES } from "@/lib/fx";
import type { Expense, Currency, ExpensePaymentStatus } from "@/lib/types";

const empty: Expense = {
  id: "", category: "", vendor: "", amount: 0, vat: 0, currency: "TRY",
  paid_at: "", method: "", payment_status: "paid", installment_number: undefined,
  installment_total: undefined, is_recurring: false, description: "", created_at: "",
};

const cats = ["Yazılım","Ekipman","Çekim / Prodüksiyon","Ulaşım","Yakıt","Yemek","Freelancer","Baskı","Reklam","Domain/Hosting","Muhasebe","Vergi","Ofis","Diğer"];

type Scope = "all" | "pending" | "recurring";
const SCOPES: readonly Scope[] = ["all", "pending", "recurring"];
const PERIODS: readonly PeriodMode[] = ["month", "all"];

function ExpenseModal({ initial, today, usd, eur, onClose }: { initial: Expense | null; today: string; usd: number; eur: number; onClose: () => void }) {
  // Yeni giderde tarih bugün gelir: tarihsiz gider "Seçili Ay" görünümünde kaybolurdu.
  const f = useFormState<Expense>(initial ?? { ...empty, paid_at: today });
  const editing = Boolean(initial?.id);
  const { form } = f;
  const cur = form.currency ?? "TRY";

  async function submit() {
    if (!(form.amount > 0)) return { ok: false, error: "Tutar girin." };
    const s = useStore.getState();
    return editing ? s.update("expenses", form.id, form) : s.add("expenses", { ...form, id: uid(), created_at: nowISO() });
  }

  return (
    <FormModal
      title={editing ? "Gider düzenle" : "Yeni gider"}
      onClose={onClose}
      onSubmit={submit}
      successMessage={editing ? "Gider güncellendi" : "Gider eklendi"}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Kategori">
          <Select {...f.text("category")}>
            <option value="">Seçin</option>
            {cats.map((c) => <option key={c}>{c}</option>)}
          </Select>
        </Field>
        <Field label="Tedarikçi"><Input {...f.text("vendor")} autoComplete="off" /></Field>
        <Field label={`Tutar (${cur}) *`}><Input type="number" inputMode="decimal" min="0" {...f.num("amount", 0)} /></Field>
        <Field label={`KDV (${cur})`}><Input type="number" inputMode="decimal" min="0" {...f.num("vat", 0)} /></Field>
        <Field label="Para birimi">
          <Select value={cur} onChange={(e) => f.set("currency", e.target.value as Currency)}>
            {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </Select>
        </Field>
        <Field label="Ödeme durumu">
          <Select value={form.payment_status ?? "paid"} onChange={(e) => f.set("payment_status", e.target.value as ExpensePaymentStatus)}>
            <option value="paid">Ödendi</option><option value="pending">Bekliyor</option>
          </Select>
        </Field>
        <Field label="Ödeme / vade tarihi"><Input type="date" {...f.text("paid_at")} /></Field>
        {cur !== "TRY" && (
          <p className="self-end text-xs text-muted">
            TL karşılığı ≈ {TRY(toTRY((form.amount || 0) + (form.vat || 0), cur, usd, eur))} (kur: ${usd} / €{eur}, Ayarlar&apos;dan değişir)
          </p>
        )}
        <MoreFields label="Ek alanlar (yöntem, taksit, tekrar, açıklama)" defaultOpen={editing}>
          <Field label="Ödeme yöntemi"><Input {...f.text("method")} placeholder="Kart, havale, nakit…" /></Field>
          <Field label="Tekrarlayan mı?">
            <Select {...f.bool("is_recurring")}>
              <option value="0">Hayır</option><option value="1">Evet (aylık)</option>
            </Select>
          </Field>
          <Field label="Kaçıncı taksit"><Input type="number" inputMode="numeric" min="1" {...f.num("installment_number")} /></Field>
          <Field label="Toplam taksit"><Input type="number" inputMode="numeric" min="1" {...f.num("installment_total")} /></Field>
          <div className="sm:col-span-2"><Field label="Açıklama"><Input {...f.text("description")} /></Field></div>
        </MoreFields>
      </div>
    </FormModal>
  );
}

export default function ExpensesPage() {
  const hydrated = useHydrated(["expenses"]);
  const expenses = useStore((s) => s.expenses);
  const { usd, eur } = useFx();
  const today = useToday();

  const wantNew = useNewIntent();
  const [modal, setModal] = useState<{ initial: Expense | null } | null>(() => (wantNew ? { initial: null } : null));
  const [scope, setScope] = usePersistentState<Scope>("expenses-scope", "all", SCOPES);
  const [periodView, setPeriodView] = usePersistentState<PeriodMode>("finance-period", "month", PERIODS);
  const [selectedMonth, setSelectedMonth] = useState(() => today.slice(0, 7));
  const [query, setQuery] = useState("");
  const del = useDeleteConfirm();

  const stats = useMemo(() => {
    const inTRY = (x: Expense) => toTRY(x.amount + x.vat, x.currency, usd, eur);
    const period = expenses.filter((x) => periodView === "all" || x.is_recurring || Boolean(x.paid_at?.startsWith(selectedMonth)));
    let total = 0, recurring = 0, pending = 0, pendingCount = 0, recurringCount = 0;
    for (const x of period) {
      if (x.payment_status === "pending") { pending += inTRY(x); pendingCount++; }
      else { total += inTRY(x); if (x.is_recurring) recurring += inTRY(x); }
      if (x.is_recurring) recurringCount++;
    }
    return { period, total, recurring, pending, pendingCount, recurringCount };
  }, [expenses, periodView, selectedMonth, usd, eur]);

  const scoped = useMemo(() => {
    if (scope === "pending") return stats.period.filter((x) => x.payment_status === "pending");
    if (scope === "recurring") return stats.period.filter((x) => x.is_recurring);
    return stats.period;
  }, [stats.period, scope]);
  const visible = useListSearch(scoped, query, (x) => `${x.category ?? ""} ${x.vendor ?? ""} ${x.description ?? ""}`);

  const columns = useMemo<Column<Expense>[]>(() => [
    {
      key: "what", header: "Gider", tone: "primary", mobile: "title", sort: (x) => x.category,
      cell: (x) => (
        <>
          <span className="block max-w-[22rem] truncate">{x.category || "Kategorisiz"}</span>
          <span className="block max-w-[22rem] truncate text-xs font-normal text-muted">{x.vendor || x.description || "—"}</span>
        </>
      ),
    },
    {
      key: "amount", header: "Tutar (+KDV)", tone: "strong", sort: (x) => toTRY(x.amount + x.vat, x.currency, usd, eur),
      cell: (x) => {
        const cur = x.currency ?? "TRY";
        return (
          <>
            <span>{money(x.amount + x.vat, cur)}</span>
            {cur !== "TRY" && <span className="block text-xs text-muted">≈ {TRY(toTRY(x.amount + x.vat, cur, usd, eur))}</span>}
          </>
        );
      },
    },
    { key: "date", header: "Tarih", sort: (x) => x.paid_at, cell: (x) => dateTR(x.paid_at) },
    {
      key: "installment", header: "Taksit", sort: (x) => x.installment_total,
      cell: (x) => (x.installment_total ? <Badge tone="amber">{x.installment_number ?? "?"}/{x.installment_total}</Badge> : "—"),
    },
    {
      key: "recurring", header: "Tekrar", mobile: "hide", sort: (x) => (x.is_recurring ? 0 : 1),
      cell: (x) => (x.is_recurring ? <Badge tone="amber">Aylık</Badge> : "—"),
    },
    {
      key: "payment", header: "Ödeme", mobile: "badge", sort: (x) => (x.payment_status === "pending" ? 0 : 1),
      cell: (x) =>
        x.payment_status === "pending" ? (
          // Tek tıkla ödendi: bekleyen taksit/ödeme akışının en sık işlemi
          <button
            type="button"
            onClick={() => patchRecord("expenses", x.id, { payment_status: "paid", paid_at: x.paid_at || today }, "Ödeme güncellenemedi")}
            aria-label={`Ödendi olarak işaretle: ${x.vendor || x.category || "gider"}`}
            title="Ödendi olarak işaretle"
            className="inline-flex items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-amber/60"
          >
            <Badge tone="warning">Bekliyor · Ödendi işaretle</Badge>
          </button>
        ) : (
          <Badge tone="success">Ödendi</Badge>
        ),
    },
  ], [usd, eur, today]);

  if (!hydrated) return <PageLoading title="Giderler" />;

  return (
    <>
      <PageHeader
        title="Giderler"
        subtitle="Gider kayıtları ve tekrarlayan abonelikler (USD/EUR kurla TL'ye çevrilir)"
        action={
          <Button onClick={() => setModal({ initial: null })}>
            <Plus className="h-4 w-4" aria-hidden /> Yeni Gider
          </Button>
        }
      />

      <StatStrip
        items={[
          { label: "Ödenen gider (TL)", value: TRY(stats.total), tone: "warning" },
          { label: "Tekrarlayan (aylık, TL)", value: TRY(stats.recurring), tone: "amber", hint: `Kur: $${usd} · €${eur}` },
          { label: "Bekleyen taksit / ödeme", value: TRY(stats.pending), tone: "danger" },
          { label: "Kayıt sayısı", value: String(stats.period.length) },
        ]}
      />

      <Toolbar>
        <FilterChips
          label="Gider kapsamı"
          value={scope}
          onChange={setScope}
          options={[
            { id: "all", label: "Tümü", count: stats.period.length },
            { id: "pending", label: "Bekleyen", count: stats.pendingCount },
            { id: "recurring", label: "Tekrarlayan", count: stats.recurringCount },
          ]}
        />
        <MonthFilter mode={periodView} month={selectedMonth} onModeChange={setPeriodView} onMonthChange={setSelectedMonth} />
        <SearchBox value={query} onChange={setQuery} placeholder="Kategori, tedarikçi ara…" label="Gider ara" />
      </Toolbar>

      <DataTable
        columns={columns}
        rows={visible}
        rowKey={(x) => x.id}
        onOpen={(x) => setModal({ initial: x })}
        openLabel={(x) => `Düzenle: ${x.category || x.vendor || "gider"}`}
        actions={(x) => (
          <RowActions label={x.vendor || x.category || "gider"} onEdit={() => setModal({ initial: x })} onDelete={() => del.ask({ key: "expenses", id: x.id, label: x.vendor || x.category || "Gider" })} />
        )}
        empty={
          <EmptyState
            title={query ? "Eşleşen gider yok" : "Bu dönemde gider kaydı yok"}
            hint={query ? "Aramayı değiştir." : "Başka bir ay seç, “Tüm Dönem”e bak veya yeni gider ekle."}
            action={query ? undefined : { label: "Yeni Gider", onClick: () => setModal({ initial: null }) }}
          />
        }
      />

      {modal && <ExpenseModal initial={modal.initial} today={today} usd={usd} eur={eur} onClose={() => setModal(null)} />}
      {del.dialog}
    </>
  );
}
