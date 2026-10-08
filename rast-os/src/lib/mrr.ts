// MRR (aylık tekrarlayan gelir) ve eşik ilerlemesi — saf (React'siz) mantık.
// Testler: scripts/mrr-logic.test.mjs
// Not: Node'un type-stripping'i ile doğrudan test edilir; burada yalnızca `import type` kullanın.
//
// VARSAYIMLAR / KURALLAR (hepsi KDV HARİÇ, TL):
//
// 1) Birincil kaynak — KABUL EDİLMİŞ teklifler.
//    status === "accepted" olan tekliflerin `is_recurring` kalemleri. `is_recurring` = "aylık" demektir
//    (bkz. 0011 / teklif editörü: aylık kalem / tek seferlik kalem), bu yüzden kalem değeri aylık
//    qty × unit_price'tır. Birim "yıl" ise 12'ye bölünür (yıllık sözleşme → aylık karşılık); diğer
//    tüm birimler ("ay", "adet", …) aylık sayılır. Teklif kalem fiyatları zaten KDV hariçtir; vat_rate
//    MRR'ye EKLENMEZ. TRY dışı teklifler verilen kurla (rates) TL'ye çevrilir; kur yoksa o teklif atlanır.
//    draft / sent / rejected / expired teklifler SAYILMAZ. Tek seferlik kalemler SAYILMAZ.
//    Bir müşterinin birden çok kabul edilmiş teklifi varsa toplanır (ayrı hizmetler).
//
// 2) Yedek kaynak — faturalar (teklifi olmayan düzenli müşteriler).
//    Kabul edilmiş, tekrarlayan kalemi olan teklifi OLMAYAN müşteriler için, son 30 gün içinde
//    (today-30, today] kesilmiş "düzenli" fatura MRR'ye yazılır. Fatura tutarı: `amount` (KDV hariç;
//    `vat` ayrı alandır, eklenmez). Taslak (draft) ve iptal (cancelled) faturalar sayılmaz.
//    "Düzenli fatura" = müşterisi aktif ve `monthly_fee > 0` olan müşterinin faturası; ya da fatura
//    notunda "aylık / retainer / abonelik / monthly" geçmesi. Pencerede aynı müşteriye birden çok
//    düzenli fatura varsa EN SON olanın tutarı alınır (toplanmaz: düzeltme/ek fatura çifte sayım
//    yaratmasın). Teklifi olan müşterinin faturaları hiç sayılmaz (çifte sayım yok).
//
// Not: Fatura para birimi alanı yok; faturalar TL kabul edilir.
import type { Client, Currency, Invoice, Proposal, ProposalItem } from "./types";

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export type MrrSource = "proposal" | "invoice";

export interface MrrClientRow {
  /** Müşteri id'si (müşterisiz kalem/fatura için null). */
  clientId: string | null;
  /** Görünen ad (müşteri adı; yoksa teklif başlığı / "Diğer"). */
  client: string;
  /** Aylık tutar, KDV hariç TL. */
  amount: number;
  source: MrrSource;
}

export interface MrrResult {
  /** Toplam MRR (KDV hariç TL). */
  mrr: number;
  /** Müşteri bazında döküm, tutara göre azalan. */
  byClient: MrrClientRow[];
  sources: {
    /** Kabul edilmiş tekliflerden gelen toplam ve müşteri sayısı. */
    proposal: { amount: number; clients: number };
    /** Yedek kural (son 30 gün düzenli fatura) toplamı ve müşteri sayısı. */
    invoice: { amount: number; clients: number };
  };
}

export interface MrrInput {
  proposals: Pick<Proposal, "id" | "client_id" | "title" | "status" | "currency">[];
  proposalItems: Pick<ProposalItem, "proposal_id" | "qty" | "unit_price" | "unit" | "is_recurring">[];
  invoices?: Pick<Invoice, "client_id" | "issue_date" | "amount" | "status" | "notes" | "created_at">[];
  /** Müşteri adları ve `monthly_fee` (düzenli fatura tespiti) için. */
  clients?: Pick<Client, "id" | "name" | "monthly_fee" | "is_active">[];
  /** "YYYY-MM-DD" ay başı. `today` verilmezse yedek kuralın pencere sonu olarak kullanılır. */
  monthStart: string;
  /** "YYYY-MM-DD" bugün (yedek kural penceresinin sonu). Varsayılan: monthStart. */
  today?: string;
  /** TRY dışı teklifler için TL kurları. */
  rates?: { usd?: number; eur?: number };
}

const dayKey = (d: string | undefined | null) => (d ? String(d).slice(0, 10) : "");

/** "YYYY-MM-DD" − n gün (UTC, saat dilimi kaymasız). */
function minusDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

function rateFor(currency: Currency | undefined, rates: MrrInput["rates"]): number | undefined {
  if (!currency || currency === "TRY") return 1;
  const r = currency === "USD" ? rates?.usd : rates?.eur;
  return r !== undefined && Number.isFinite(r) && r > 0 ? r : undefined;
}

/** Tek bir tekrarlayan kalemin aylık değeri (kalem para biriminde, KDV hariç). */
export function monthlyItemValue(item: Pick<ProposalItem, "qty" | "unit_price" | "unit">): number {
  const base = num(item.qty) * num(item.unit_price);
  const unit = String(item.unit ?? "").trim().toLocaleLowerCase("tr-TR");
  return unit === "yıl" || unit === "yil" ? base / 12 : base;
}

const RECURRING_NOTE_RE = /ayl[ıi]k|retainer|abonelik|monthly/i;

/** Müşterisi aylık ücretli ya da notu "aylık/retainer/…" diyen fatura = düzenli fatura. */
function isRecurringInvoice(
  inv: Pick<Invoice, "client_id" | "notes">,
  clientById: Map<string, Pick<Client, "id" | "name" | "monthly_fee" | "is_active">>,
): boolean {
  const c = inv.client_id ? clientById.get(inv.client_id) : undefined;
  if (c && c.is_active && num(c.monthly_fee) > 0) return true;
  return RECURRING_NOTE_RE.test(inv.notes ?? "");
}

export function computeMrr(input: MrrInput): MrrResult {
  const { proposals, proposalItems, invoices = [], clients = [], monthStart, rates } = input;
  const today = dayKey(input.today) || monthStart;
  const clientById = new Map(clients.map((c) => [c.id, c]));
  const nameOf = (id: string | null | undefined, fallback: string) => (id ? clientById.get(id)?.name : undefined) ?? fallback;

  // 1) Kabul edilmiş tekliflerin tekrarlayan kalemleri → müşteri (ya da müşterisiz teklif) anahtarı
  const itemsByProposal = new Map<string, typeof proposalItems>();
  for (const it of proposalItems) {
    if (!it.is_recurring) continue;
    const list = itemsByProposal.get(it.proposal_id);
    if (list) list.push(it);
    else itemsByProposal.set(it.proposal_id, [it]);
  }

  const rows = new Map<string, MrrClientRow>();
  const coveredClients = new Set<string>();
  for (const p of proposals) {
    if (p.status !== "accepted") continue;
    const rate = rateFor(p.currency, rates);
    if (rate === undefined) continue;
    let monthly = 0;
    for (const it of itemsByProposal.get(p.id) ?? []) monthly += monthlyItemValue(it);
    monthly = round2(monthly * rate);
    if (monthly <= 0) continue;

    if (p.client_id) coveredClients.add(p.client_id);
    const key = p.client_id ? `c:${p.client_id}` : `p:${p.id}`;
    const row = rows.get(key);
    if (row) row.amount = round2(row.amount + monthly);
    else rows.set(key, { clientId: p.client_id ?? null, client: nameOf(p.client_id, p.title || "Diğer"), amount: monthly, source: "proposal" });
  }

  // 2) Yedek: teklifi olmayan müşterilerin son 30 gündeki düzenli faturası (en sonuncusu)
  const windowStart = minusDays(today, 30); // dışarıda: issue_date > windowStart
  const latest = new Map<string, Pick<Invoice, "client_id" | "issue_date" | "amount" | "status" | "notes" | "created_at">>();
  for (const inv of invoices) {
    if (inv.status === "draft" || inv.status === "cancelled") continue;
    const d = dayKey(inv.issue_date);
    if (!d || d <= windowStart || d > today) continue;
    if (inv.client_id && coveredClients.has(inv.client_id)) continue; // teklif zaten sayıyor
    if (!isRecurringInvoice(inv, clientById)) continue;
    if (num(inv.amount) <= 0) continue;
    const key = inv.client_id ? `c:${inv.client_id}` : "i:diger";
    const prev = latest.get(key);
    const newer = !prev || d > dayKey(prev.issue_date) || (d === dayKey(prev.issue_date) && String(inv.created_at) > String(prev.created_at));
    if (newer) latest.set(key, inv);
  }
  for (const [key, inv] of latest) {
    rows.set(key, {
      clientId: inv.client_id ?? null,
      client: nameOf(inv.client_id, "Diğer"),
      amount: round2(num(inv.amount)),
      source: "invoice",
    });
  }

  const byClient = [...rows.values()].sort((a, b) => b.amount - a.amount || a.client.localeCompare(b.client, "tr"));
  const part = (s: MrrSource) => {
    const list = byClient.filter((r) => r.source === s);
    return { amount: round2(list.reduce((t, r) => t + r.amount, 0)), clients: list.length };
  };
  const sources = { proposal: part("proposal"), invoice: part("invoice") };
  return { mrr: round2(sources.proposal.amount + sources.invoice.amount), byClient, sources };
}

export interface MrrProgress {
  /** Geçerli bir hedef (> 0) var mı? */
  hasTarget: boolean;
  target: number;
  /** 0–100 arası, çubuk genişliği için (hedef aşılsa da 100'de kalır). */
  pct: number;
  /** Hedefe kalan (>= 0). */
  remaining: number;
  /** Hedefin üzerinde kalan (>= 0). */
  surplus: number;
  reached: boolean;
}

/** Hedefe ilerleme. Hedef boş / <= 0 / geçersizse hasTarget=false döner. */
export function mrrProgress(mrr: number, target: number | null | undefined): MrrProgress {
  const t = Number(target);
  const m = Math.max(0, num(mrr));
  if (target === null || target === undefined || !Number.isFinite(t) || t <= 0) {
    return { hasTarget: false, target: 0, pct: 0, remaining: 0, surplus: 0, reached: false };
  }
  return {
    hasTarget: true,
    target: round2(t),
    pct: Math.min(100, Math.max(0, Math.round((m / t) * 1000) / 10)),
    remaining: round2(Math.max(0, t - m)),
    surplus: round2(Math.max(0, m - t)),
    reached: m >= t,
  };
}
