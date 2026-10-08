// Teklif kabulü → proje + tekrarlayan kalemler için taslak fatura. Saf (React'siz) eşleme.
// Testler: scripts/proposal-convert.test.mjs
// Not: Node'un type-stripping'i ile doğrudan test edilir; burada yalnızca `import type` kullanın.
//
// KURALLAR:
//   * Proje: başlık = teklif başlığı, müşteri = teklifin müşterisi, başlangıç = bugün, durum = aktif,
//     proposal_id = teklif (teklif başına tek proje — 0015 kısmi tekil indeksi). Bütçe = ilk ay
//     tutarı (aylık + tek seferlik, KDV hariç); TRY dışı teklifte bütçe boş bırakılır (alan TL).
//   * Taslak fatura: YALNIZCA aylık (is_recurring) kalemler, bu ay için. Tutar KDV hariç
//     qty × birim fiyat (birim "yıl" ise /12 — MRR ile aynı kural), KDV = tutar × teklifin vat_rate'i.
//     Durum "draft", tahsil edilen 0, not "Teklif RC-… · <Ay Yıl> aylık hizmet bedeli".
//     Faturalarda para birimi alanı yok (TL kabul edilir) → TRY dışı teklifte fatura oluşturulmaz.
//   * Müşterisi seçilmemiş teklif dönüştürülmez.
import type { Invoice, Project, Proposal, ProposalItem } from "./types";

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

type ConvProposal = Pick<Proposal, "id" | "client_id" | "title" | "proposal_no" | "currency" | "vat_rate">;
type ConvItem = Pick<ProposalItem, "qty" | "unit_price" | "unit" | "is_recurring">;

export interface ConvertOptions {
  /** Yeni kaydın id'si. */
  id: string;
  /** Bugün, "YYYY-MM-DD" (yerel). */
  today: string;
  /** created_at damgası (ISO). */
  now: string;
}

/** Aylık kalemin bir aylık değeri (KDV hariç): qty × birim fiyat; birim "yıl" ise /12. */
export function monthlyValue(item: Pick<ConvItem, "qty" | "unit_price" | "unit">): number {
  const base = num(item.qty) * num(item.unit_price);
  const unit = String(item.unit ?? "").trim().toLocaleLowerCase("tr-TR");
  return round2(unit === "yıl" || unit === "yil" ? base / 12 : base);
}

const lineTotal = (it: Pick<ConvItem, "qty" | "unit_price">) => round2(num(it.qty) * num(it.unit_price));

export function monthLabelTR(day: string): string {
  const [y, m] = day.split("-").map(Number);
  if (!y || !m) return "";
  const s = new Intl.DateTimeFormat("tr-TR", { month: "long", year: "numeric" }).format(new Date(y, m - 1, 15));
  return s.charAt(0).toLocaleUpperCase("tr-TR") + s.slice(1);
}

const tl = (n: number) =>
  new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 2 }).format(n);

/** Dönüştürmeyi engelleyen durum (Türkçe mesaj) ya da null. */
export function conversionBlocker(p: Pick<Proposal, "client_id" | "title">): string | null {
  if (!p.client_id) return "Projeye dönüştürmek için teklifte müşteri seçili olmalı.";
  if (!String(p.title ?? "").trim()) return "Teklif başlığı boş.";
  return null;
}

/** Bu teklife bağlı (daha önce oluşturulmuş) proje. */
export function findLinkedProject<T extends Pick<Project, "proposal_id">>(projects: readonly T[], proposalId: string): T | undefined {
  return projects.find((p) => p.proposal_id === proposalId);
}

/** Kabul edilen teklif → proje kaydı. */
export function proposalToProject(p: ConvProposal, items: readonly ConvItem[], opts: ConvertOptions): Project {
  const recurring = round2(items.filter((i) => i.is_recurring).reduce((s, i) => s + lineTotal(i), 0));
  const oneOff = round2(items.filter((i) => !i.is_recurring).reduce((s, i) => s + lineTotal(i), 0));
  const hasRecurring = items.some((i) => i.is_recurring);
  const isTRY = (p.currency ?? "TRY") === "TRY";
  const cur = isTRY ? "TL" : p.currency;

  const lines = [`Teklif ${p.proposal_no} kabul edildi; proje tekliften oluşturuldu.`];
  if (recurring > 0) lines.push(`Aylık: ${tl(recurring)} ${cur} + KDV`);
  if (oneOff > 0) lines.push(`Tek seferlik: ${tl(oneOff)} ${cur} + KDV`);

  return {
    id: opts.id,
    client_id: p.client_id,
    name: p.title.trim(),
    type: hasRecurring ? "Aylık hizmet" : "Tek seferlik iş",
    start_date: opts.today,
    budget: isTRY && recurring + oneOff > 0 ? round2(recurring + oneOff) : undefined,
    status: "active",
    priority: "medium",
    notes: lines.join("\n"),
    proposal_id: p.id,
    created_at: opts.now,
  };
}

/**
 * Tekrarlayan kalemler için bu ayın taslak faturası. Aylık kalem yoksa, tutar 0 ise ya da teklif
 * TRY dışındaysa null.
 */
export function proposalToDraftInvoice(
  p: ConvProposal,
  items: readonly ConvItem[],
  opts: ConvertOptions & { projectId?: string | null },
): Invoice | null {
  if ((p.currency ?? "TRY") !== "TRY") return null;
  const amount = round2(items.filter((i) => i.is_recurring).reduce((s, i) => s + monthlyValue(i), 0));
  if (amount <= 0) return null;
  const vat = round2((amount * num(p.vat_rate)) / 100);
  return {
    id: opts.id,
    client_id: p.client_id,
    project_id: opts.projectId ?? null,
    issue_date: opts.today,
    amount,
    vat,
    paid_amount: 0,
    status: "draft",
    notes: `Teklif ${p.proposal_no} · ${monthLabelTR(opts.today)} aylık hizmet bedeli (taslak)`,
    created_at: opts.now,
  };
}
