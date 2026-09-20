"use client";

import { useState, useMemo, memo } from "react";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { PageHeader, Badge, StatCard } from "@/components/ui";
import { Modal, Field, Input, Select, Button } from "@/components/form";
import MonthFilter from "@/components/MonthFilter";
import { useStore, useHydrated, uid, nowISO } from "@/lib/store";
import { TRY, dateTR } from "@/lib/labels";
import { useFx, toTRY, money, CURRENCIES } from "@/lib/fx";
import type { Expense, Currency, ExpensePaymentStatus } from "@/lib/types";

const empty: Expense = {
  id: "", category: "", vendor: "", amount: 0, vat: 0, currency: "TRY",
  paid_at: "", method: "", payment_status: "paid", installment_number: undefined,
  installment_total: undefined, is_recurring: false, description: "", created_at: "",
};

const cats = ["Yazılım","Ekipman","Çekim / Prodüksiyon","Ulaşım","Yakıt","Yemek","Freelancer","Baskı","Reklam","Domain/Hosting","Muhasebe","Vergi","Ofis","Diğer"];

const ExpenseModal = memo(function ExpenseModal({
  open, onClose, initial, usd, eur
}: {
  open: boolean, onClose: () => void, initial: Expense | null, usd: number, eur: number
}) {
  const [form, setForm] = useState<Expense>(empty);
  const editing = Boolean(form.id);

  useMemo(() => {
    if (open) setForm(initial || empty);
  }, [open, initial]);

  const add = useStore((s) => s.add);
  const update = useStore((s) => s.update);

  function save() {
    if (editing) update("expenses", form.id, form);
    else add("expenses", { ...form, id: uid(), created_at: nowISO() });
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? "Gider düzenle" : "Yeni gider"}
      footer={<><Button variant="ghost" onClick={onClose}>Vazgeç</Button><Button onClick={save}>Kaydet</Button></>}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Kategori">
          <Select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
            <option value="">Seçin</option>
            {cats.map((c) => <option key={c}>{c}</option>)}
          </Select>
        </Field>
        <Field label="Tedarikçi"><Input value={form.vendor} onChange={(e) => setForm({ ...form, vendor: e.target.value })} /></Field>
        <Field label="Para birimi">
          <Select value={form.currency ?? "TRY"} onChange={(e) => setForm({ ...form, currency: e.target.value as Currency })}>
            {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </Select>
        </Field>
        <Field label={`Tutar (${form.currency ?? "TRY"})`}>
          <Input type="number" value={form.amount || ""} onChange={(e) => setForm({ ...form, amount: Number(e.target.value) })} />
        </Field>
        <Field label={`KDV (${form.currency ?? "TRY"})`}>
          <Input type="number" value={form.vat || ""} onChange={(e) => setForm({ ...form, vat: Number(e.target.value) })} />
        </Field>
        <Field label="Ödeme tarihi"><Input type="date" value={form.paid_at} onChange={(e) => setForm({ ...form, paid_at: e.target.value })} /></Field>
        <Field label="Ödeme yöntemi / durumu"><Input value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })} /></Field>
        <Field label="Ödeme durumu">
          <Select value={form.payment_status ?? "paid"} onChange={(e) => setForm({ ...form, payment_status: e.target.value as ExpensePaymentStatus })}>
            <option value="paid">Ödendi</option><option value="pending">Bekliyor</option>
          </Select>
        </Field>
        <Field label="Kaçıncı taksit"><Input type="number" min="1" value={form.installment_number ?? ""} onChange={(e) => setForm({ ...form, installment_number: e.target.value ? Number(e.target.value) : undefined })} /></Field>
        <Field label="Toplam taksit"><Input type="number" min="1" value={form.installment_total ?? ""} onChange={(e) => setForm({ ...form, installment_total: e.target.value ? Number(e.target.value) : undefined })} /></Field>
        <Field label="Tekrarlayan mı?">
          <Select value={form.is_recurring ? "1" : "0"} onChange={(e) => setForm({ ...form, is_recurring: e.target.value === "1" })}>
            <option value="0">Hayır</option><option value="1">Evet (aylık)</option>
          </Select>
        </Field>
        <div className="sm:col-span-2"><Field label="Açıklama"><Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field></div>
        {form.currency && form.currency !== "TRY" && (
          <p className="sm:col-span-2 text-xs text-muted">
            TL karşılığı ≈ {TRY(toTRY(form.amount + form.vat, form.currency, usd, eur))} (kur: ${usd} / €{eur}, Ayarlar&apos;dan değiştirilir)
          </p>
        )}
      </div>
    </Modal>
  );
});

export default function ExpensesPage() {
  const hydrated = useHydrated(["expenses"]);
  const expenses = useStore((s) => s.expenses);
  const remove = useStore((s) => s.remove);
  const { usd, eur } = useFx();

  const [open, setOpen] = useState(false);
  const [initialForm, setInitialForm] = useState<Expense | null>(null);

  const now = new Date();
  const [periodView, setPeriodView] = useState<"month" | "all">("month");
  const [selectedMonth, setSelectedMonth] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`);

  const inTRY = (x: Expense) => toTRY(x.amount + x.vat, x.currency, usd, eur);

  const stats = useMemo(() => {
    const visibleExpenses = hydrated
      ? expenses.filter((expense) => periodView === "all" || expense.is_recurring || Boolean(expense.paid_at?.startsWith(selectedMonth)))
      : [];
    const total = visibleExpenses.filter((x) => x.payment_status !== "pending").reduce((a, x) => a + inTRY(x), 0);
    const recurring = visibleExpenses.filter((x) => x.is_recurring && x.payment_status !== "pending").reduce((a, x) => a + inTRY(x), 0);
    const pending = visibleExpenses.filter((x) => x.payment_status === "pending").reduce((a, x) => a + inTRY(x), 0);

    return { visibleExpenses, total, recurring, pending };
  }, [hydrated, expenses, periodView, selectedMonth, usd, eur]);

  if (!hydrated) return <PageHeader title="Giderler" subtitle="Yükleniyor…" />;

  return (
    <>
      <PageHeader
        title="Giderler"
        subtitle="Gider kayıtları ve tekrarlayan abonelikler (USD/EUR kurla TL'ye çevrilir)"
        action={
          <Button onClick={() => { setInitialForm(empty); setOpen(true); }}>
            <span className="flex items-center gap-1.5"><Plus className="h-4 w-4" /> Yeni Gider</span>
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface p-3">
        <p className="text-sm text-muted">Görüntülenecek gider dönemi</p>
        <MonthFilter mode={periodView} month={selectedMonth} onModeChange={setPeriodView} onMonthChange={setSelectedMonth} />
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Ödenen gider (TL)" value={TRY(stats.total)} tone="warning" />
        <StatCard label="Tekrarlayan (aylık, TL)" value={TRY(stats.recurring)} tone="amber" hint={`Kur: $${usd} · €${eur}`} />
        <StatCard label="Bekleyen taksit / ödeme" value={TRY(stats.pending)} tone="danger" />
        <StatCard label="Kayıt sayısı" value={String(stats.visibleExpenses.length)} />
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[1020px] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted">
              <th className="px-4 py-3 font-medium">Kategori</th>
              <th className="px-4 py-3 font-medium">Tedarikçi / Açıklama</th>
              <th className="px-4 py-3 font-medium">Tutar (+KDV)</th>
              <th className="px-4 py-3 font-medium">TL karşılığı</th>
              <th className="px-4 py-3 font-medium">Tarih</th>
              <th className="px-4 py-3 font-medium">Taksit</th>
              <th className="px-4 py-3 font-medium">Ödeme</th>
              <th className="px-4 py-3 font-medium">Tekrar</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {stats.visibleExpenses.map((x) => {
              const cur = x.currency ?? "TRY";
              return (
                <tr key={x.id} className="border-b border-border/60 hover:bg-surface-2/50">
                  <td className="px-4 py-3 font-medium text-foreground">{x.category || "—"}</td>
                  <td className="px-4 py-3 text-muted">{x.vendor || x.description || "—"}</td>
                  <td className="px-4 py-3 text-foreground">
                    {money(x.amount + x.vat, cur)}
                    {cur !== "TRY" && <Badge tone="muted">{cur}</Badge>}
                  </td>
                  <td className="px-4 py-3 text-foreground">{cur === "TRY" ? "—" : TRY(inTRY(x))}</td>
                  <td className="px-4 py-3 text-muted">{dateTR(x.paid_at)}</td>
                  <td className="px-4 py-3">
                    {x.installment_total ? <Badge tone="amber">{x.installment_number ?? "?"}/{x.installment_total}</Badge> : <span className="text-muted">—</span>}
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={x.payment_status === "pending" ? "warning" : "success"}>
                      {x.payment_status === "pending" ? "Bekliyor" : "Ödendi"}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">{x.is_recurring ? <Badge tone="amber">Aylık</Badge> : <span className="text-muted">—</span>}</td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1">
                      <button onClick={() => { setInitialForm(x); setOpen(true); }} className="rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-foreground"><Pencil className="h-4 w-4" /></button>
                      <button onClick={() => remove("expenses", x.id)} className="rounded-md p-1.5 text-muted hover:bg-danger/15 hover:text-danger"><Trash2 className="h-4 w-4" /></button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <ExpenseModal open={open} onClose={() => setOpen(false)} initial={initialForm} usd={usd} eur={eur} />
    </>
  );
}
