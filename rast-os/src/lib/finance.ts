// Finans hesaplarının saf (React'siz) mantığı: aylık tahsilat (gelir), tekrarlayan gider
// açılımı, döviz → TL çevrimi. Testler: scripts/finance-logic.test.mjs
// Not: Node'un type-stripping'i ile doğrudan test edilir; burada yalnızca `import type` kullanın.
import type { Currency, Expense, Invoice, Payment } from "./types";

/** "YYYY-MM" → ["YYYY-MM-01", "YYYY-MM-<son gün>"] (kapsayıcı aralık, tarih anahtarı olarak). */
export function monthBounds(month: string): [string, string] {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const mm = String(m).padStart(2, "0");
  return [`${y}-${mm}-01`, `${y}-${mm}-${String(last).padStart(2, "0")}`];
}

/**
 * Liste sayfalarının dönem filtresi → kapsayıcı tarih aralığı.
 * "month": seçili ayın ilk/son günü · "all": tüm zamanlar (her tarih anahtarını kapsar).
 */
export function periodBounds(mode: "month" | "all", month: string): [string, string] {
  return mode === "all" ? ["0000-01-01", "9999-12-31"] : monthBounds(month);
}

const dayKey = (d: string | undefined) => (d ? d.slice(0, 10) : "");
const inRange = (d: string | undefined, start: string, end: string) => {
  const k = dayKey(d);
  return k !== "" && k >= start && k <= end;
};

/**
 * Aralıktaki fatura tahsilatı (TL): `payments.paid_at` tarihine göre.
 *
 * Eski kayıtlar: payments tablosu kullanılmadan önce yalnızca `invoices.paid_amount` set edilirdi.
 * Bir faturanın paid_amount'u, ona bağlı ödeme satırlarının toplamından büyükse aradaki fark
 * (ödeme tarihi bilinmediği için) eskisi gibi fatura tarihine (issue_date) yazılır — böylece
 * geçmiş tahsilatlar dashboard'dan kaybolmaz.
 *
 * Silinmiş faturaya ait (store'da kalmış) ödeme satırları sayılmaz; faturasız ödemeler sayılır.
 */
export function invoiceIncomeInRange(
  invoices: Pick<Invoice, "id" | "issue_date" | "paid_amount">[],
  payments: Pick<Payment, "invoice_id" | "amount" | "paid_at">[],
  start: string,
  end: string,
): number {
  const invoiceIds = new Set(invoices.map((i) => i.id));
  const paidPerInvoice = new Map<string, number>();
  let total = 0;
  for (const p of payments) {
    if (p.invoice_id) {
      if (!invoiceIds.has(p.invoice_id)) continue;
      paidPerInvoice.set(p.invoice_id, (paidPerInvoice.get(p.invoice_id) ?? 0) + (Number(p.amount) || 0));
    }
    if (inRange(p.paid_at, start, end)) total += Number(p.amount) || 0;
  }
  for (const inv of invoices) {
    const unmatched = (Number(inv.paid_amount) || 0) - (paidPerInvoice.get(inv.id) ?? 0);
    if (unmatched > 0.005 && inRange(inv.issue_date, start, end)) total += unmatched;
  }
  return total;
}

// ---------------------------------------------------------------------------
// Döviz → TL
// ---------------------------------------------------------------------------

/** Verilen tutarı (para birimiyle) güncel kurla TL'ye çevirir. */
export function toTRY(amount: number, currency: Currency | undefined, usd: number, eur: number): number {
  if (currency === "USD") return amount * usd;
  if (currency === "EUR") return amount * eur;
  return amount;
}

const num = (v: unknown) => (v === null || v === undefined || v === "" ? undefined : Number.isFinite(Number(v)) ? Number(v) : undefined);
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Giderin KDV dahil TL karşılığı.
 * Giriş anında sabitlenmiş TL tutarı (amount_try, 0009) varsa onu kullanır; KDV aynı kurla
 * (fx_rate, yoksa güncel kur) çevrilir. Eski kayıtlarda (amount_try yok) güncel kurla çevirir.
 */
export function expenseTotalTRY(
  x: Pick<Expense, "amount" | "vat" | "currency" | "fx_rate" | "amount_try">,
  usd: number,
  eur: number,
): number {
  const vat = Number(x.vat) || 0;
  const amountTry = num(x.amount_try);
  if (amountTry !== undefined && x.currency && x.currency !== "TRY") {
    const rate = num(x.fx_rate);
    return amountTry + (rate !== undefined ? vat * rate : toTRY(vat, x.currency, usd, eur));
  }
  return toTRY((Number(x.amount) || 0) + vat, x.currency, usd, eur);
}

/**
 * Kayıt anında saklanacak kur alanları (0009). TRY → ikisi de null.
 * Düzenlemede para birimi değişmediyse ve kayıtlı kur varsa o kur korunur (tarihsel değer);
 * yoksa güncel kur (Ayarlar → tarayıcı) kullanılır.
 */
export function fxSnapshot(
  amount: number,
  currency: Currency | undefined,
  usd: number,
  eur: number,
  previous?: Pick<Expense, "currency" | "fx_rate"> | null,
): { fx_rate: number | null; amount_try: number | null } {
  if (!currency || currency === "TRY") return { fx_rate: null, amount_try: null };
  const kept = previous && previous.currency === currency ? num(previous.fx_rate) : undefined;
  const rate = kept !== undefined && kept > 0 ? kept : currency === "USD" ? usd : eur;
  return { fx_rate: rate, amount_try: round2((Number(amount) || 0) * rate) };
}

// ---------------------------------------------------------------------------
// Tekrarlayan giderler: şablon (is_recurring satırı) → ay bazlı oluşumlar
// ---------------------------------------------------------------------------

/** Liste/hesap satırı: gerçek gider ya da tekrarlayan bir şablonun bir aydaki oluşumu. */
export type ExpenseRow = Expense & {
  /** Kaynak gider kaydının id'si (düzenleme/silme/ödendi işaretleme buna yapılır). */
  source_id: string;
  /** true: tekrarlayan şablondan türetilmiş oluşum (DB'de ayrı satırı yok). */
  is_occurrence: boolean;
};

const monthIndex = (key: string) => {
  const [y, m] = key.split("-").map(Number);
  return y * 12 + (m - 1);
};
const monthKeyOf = (index: number) =>
  `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
const daysIn = (index: number) => new Date(Date.UTC(Math.floor(index / 12), (index % 12) + 1, 0)).getUTCDate();

/**
 * [monthStart, monthEnd] aralığındaki giderleri döndürür (tarih anahtarları "YYYY-MM-DD", kapsayıcı).
 *
 * - Tekrarlamayan gider: `paid_at` aralıktaysa bir kez.
 * - Tekrarlayan gider (`is_recurring`) bir ŞABLONDUR: `paid_at` tarihinden başlayarak her ay aynı
 *   günde (ay daha kısaysa ayın son günü) bir oluşum üretir; başlangıçtan önceki aylarda görünmez.
 * - Taksitli şablon (`installment_total` dolu): şablon `installment_number` (yoksa 1). taksittir;
 *   toplam taksit sayısına ulaşınca oluşum durur (ör. 1/6 → 6 ay).
 * - Tarihsiz tekrarlayan şablon: başlangıcı bilinmediği için (eski davranış) her ay bir kez sayılır.
 */
export function expandRecurring(expenses: Expense[], monthStart: string, monthEnd: string): ExpenseRow[] {
  const out: ExpenseRow[] = [];
  const firstMonth = monthIndex(monthStart.slice(0, 7));
  const lastMonth = monthIndex(monthEnd.slice(0, 7));

  for (const x of expenses) {
    if (!x.is_recurring) {
      if (inRange(x.paid_at, monthStart, monthEnd)) out.push({ ...x, source_id: x.id, is_occurrence: false });
      continue;
    }

    const start = dayKey(x.paid_at);
    if (!start) {
      for (let mi = firstMonth; mi <= lastMonth; mi++) {
        out.push({ ...x, id: `${x.id}@${monthKeyOf(mi)}`, source_id: x.id, is_occurrence: true });
      }
      continue;
    }

    const startMonth = monthIndex(start.slice(0, 7));
    const startDay = Number(start.slice(8, 10)) || 1;
    const firstNo = x.installment_total ? Math.max(1, Number(x.installment_number) || 1) : undefined;
    const maxOffset = x.installment_total && firstNo !== undefined ? x.installment_total - firstNo : Infinity;

    for (let mi = Math.max(firstMonth, startMonth); mi <= lastMonth; mi++) {
      const offset = mi - startMonth;
      if (offset > maxOffset) break;
      const date = `${monthKeyOf(mi)}-${String(Math.min(startDay, daysIn(mi))).padStart(2, "0")}`;
      if (date < monthStart || date > monthEnd) continue;
      out.push({
        ...x,
        id: `${x.id}@${monthKeyOf(mi)}`,
        paid_at: date,
        installment_number: firstNo !== undefined ? firstNo + offset : x.installment_number,
        source_id: x.id,
        is_occurrence: true,
      });
    }
  }
  return out;
}
