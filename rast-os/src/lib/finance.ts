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

/** Giderin KDV dahil TL karşılığı. */
export function expenseTotalTRY(
  x: Pick<Expense, "amount" | "vat" | "currency">,
  usd: number,
  eur: number,
): number {
  return toTRY((Number(x.amount) || 0) + (Number(x.vat) || 0), x.currency, usd, eur);
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
