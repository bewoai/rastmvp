// Finans hesaplarının saf (React'siz) mantığı: aylık tahsilat (gelir), tekrarlayan gider
// açılımı, döviz → TL çevrimi. Testler: scripts/finance-logic.test.mjs
// Not: Node'un type-stripping'i ile doğrudan test edilir; burada yalnızca `import type` kullanın.
import type { Invoice, Payment } from "./types";

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
