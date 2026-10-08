// Teklif hesaplarının saf (React'siz) mantığı: kalem tutarı, KDV, aylık / tek seferlik ayrımı,
// teklif numarası (RC-YYYY-NNN) üretimi ve yazdırma görünümü için metin blokları.
// Testler: scripts/proposal-logic.test.mjs
// Not: Node'un type-stripping'i ile doğrudan test edilir; burada yalnızca `import type` kullanın.
import type { Currency, Proposal, ProposalItem } from "./types";

/** Kuruş hassasiyetinde yuvarlama (kayan nokta artıklarını temizler: 0.1 + 0.2 → 0.3). */
export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Kalem tutarı (KDV hariç) = miktar × birim fiyat. */
export function lineTotal(item: Pick<ProposalItem, "qty" | "unit_price">): number {
  return round2(num(item.qty) * num(item.unit_price));
}

export interface TotalsPart {
  subtotal: number; // KDV hariç
  vat: number;
  total: number;    // KDV dahil
}

export interface ProposalTotals extends TotalsPart {
  recurring: TotalsPart; // aylık kalemler (her ay)
  oneOff: TotalsPart;    // tek seferlik kalemler
  /** Hem aylık hem tek seferlik kalem var mı? (genel toplam = ilk ay tutarı) */
  mixed: boolean;
}

function part(subtotal: number, vatRate: number): TotalsPart {
  const s = round2(subtotal);
  const vat = round2((s * num(vatRate)) / 100);
  return { subtotal: s, vat, total: round2(s + vat) };
}

/**
 * Teklif toplamları. KDV her grup (aylık / tek seferlik) için ayrı hesaplanır ve genel toplam bu
 * ikisinin toplamıdır — böylece yazdırılan ayrım ile genel toplam kuruşu kuruşuna tutarlı kalır.
 */
export function proposalTotals(
  items: Pick<ProposalItem, "qty" | "unit_price" | "is_recurring">[],
  vatRate: number,
): ProposalTotals {
  let rec = 0;
  let one = 0;
  let recCount = 0;
  let oneCount = 0;
  for (const it of items) {
    const t = lineTotal(it);
    if (it.is_recurring) {
      rec += t;
      recCount++;
    } else {
      one += t;
      oneCount++;
    }
  }
  const recurring = part(rec, vatRate);
  const oneOff = part(one, vatRate);
  return {
    subtotal: round2(recurring.subtotal + oneOff.subtotal),
    vat: round2(recurring.vat + oneOff.vat),
    total: round2(recurring.total + oneOff.total),
    recurring,
    oneOff,
    mixed: recCount > 0 && oneCount > 0,
  };
}

const NO_RE = /^RC-(\d{4})-(\d+)$/;

/**
 * Sıradaki teklif numarası: RC-<yıl>-<NNN>. Aynı organizasyon + yıl içindeki en büyük sıra + 1
 * (aradaki boşluklar doldurulmaz; elle girilmiş biçim dışı numaralar yok sayılır; 999'dan sonra
 * 4 haneye geçer). `orgId` verilirse yalnızca o organizasyonun kayıtları sayılır (Supabase'de RLS zaten
 * yalnızca kendi org'unu döndürür; demo/çok-org testleri için).
 */
export function nextProposalNo(
  existing: { proposal_no?: string | null; organization_id?: string | null }[],
  year: number,
  orgId?: string | null,
): string {
  let max = 0;
  for (const p of existing) {
    if (orgId && p.organization_id && p.organization_id !== orgId) continue;
    const m = NO_RE.exec((p.proposal_no ?? "").trim());
    if (!m || Number(m[1]) !== year) continue;
    max = Math.max(max, Number(m[2]));
  }
  return `RC-${year}-${String(max + 1).padStart(3, "0")}`;
}

/** Kalemler sıra numarasına göre (eşitse oluşturulma sırasına göre). */
export function sortItems<T extends Pick<ProposalItem, "position" | "created_at">>(items: T[]): T[] {
  return [...items].sort((a, b) => num(a.position) - num(b.position) || String(a.created_at).localeCompare(String(b.created_at)));
}

/** Listede bir öğeyi yukarı (-1) / aşağı (+1) taşır; sınırda değişiklik yapmaz. */
export function moveItem<T>(list: T[], index: number, dir: -1 | 1): T[] {
  const j = index + dir;
  if (index < 0 || index >= list.length || j < 0 || j >= list.length) return list;
  const next = [...list];
  [next[index], next[j]] = [next[j], next[index]];
  return next;
}

/** Para birimiyle tutar (tr-TR; kuruş varsa 2 hane, yoksa tam sayı). */
export function formatMoney(n: number | undefined, currency: Currency = "TRY"): string {
  const v = num(n);
  const hasCents = Math.abs(round2(v) - Math.trunc(round2(v))) > 0;
  return new Intl.NumberFormat("tr-TR", {
    style: "currency",
    currency,
    minimumFractionDigits: hasCents ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(v);
}

/** Teklif geçerliliği dolmuş mu? (yalnızca taslak / gönderilmiş teklifler için anlamlı) */
export function isExpired(p: Pick<Proposal, "status" | "valid_until">, today: string): boolean {
  return (p.status === "draft" || p.status === "sent") && Boolean(p.valid_until) && String(p.valid_until) < today;
}

export type TextBlock =
  | { type: "heading"; text: string }
  | { type: "list"; items: string[]; ordered: boolean }
  | { type: "paragraph"; text: string };

/**
 * Not / koşul metnini yazdırma blokları haline getirir. Basit, öngörülebilir biçim:
 *   "## Başlık"            → alt başlık
 *   "- madde" / "• madde"  → madde işaretli liste (ardışık satırlar tek liste)
 *   "1. madde"             → numaralı liste (numara metinde kalır, ek madde işareti yok)
 *   diğer satırlar         → paragraf (boş satır paragrafı böler)
 */
export function parseTextBlocks(text: string | undefined | null): TextBlock[] {
  const blocks: TextBlock[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) blocks.push({ type: "paragraph", text: para.join(" ") });
    para = [];
  };
  for (const raw of String(text ?? "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) {
      flush();
      continue;
    }
    const h = /^#{1,3}\s+(.*)$/.exec(line);
    if (h) {
      flush();
      blocks.push({ type: "heading", text: h[1].trim() });
      continue;
    }
    const bullet = /^[-•*]\s+(.*)$/.exec(line);
    const numbered = /^\d+[.)]\s+.*$/.test(line);
    if (bullet || numbered) {
      flush();
      const item = bullet ? bullet[1].trim() : line;
      const last = blocks[blocks.length - 1];
      if (last?.type === "list" && last.ordered === numbered) last.items.push(item);
      else blocks.push({ type: "list", items: [item], ordered: numbered });
      continue;
    }
    para.push(line);
  }
  flush();
  return blocks;
}
