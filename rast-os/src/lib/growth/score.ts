// Müşteri Bulma — sektör tespiti ve AÇIKLAMALI puanlama (saf).
// Puan bileşenleri (toplam 100): sektör 25 · Google puanı 10 · yorum sayısı 15 · web sitesi 10 ·
// site kalitesi 8 (https 3, <title> 2, og: 3) · Instagram 10 · e-posta 12 · şehir uyumu 10.
// Places verisi (puan, yorum sayısı) yalnızca hesapta CANLI kullanılır; döküme ham değer / Places metni
// yazılmaz, yalnızca bant etiketi ("≥ 4,5", "50 – 199") yazılır → saklanabilir.
// Testler: scripts/growth-logic.test.mjs  (yalnızca `import type`; type-stripping)
import type { ScoreItem } from "../types";

// ---------------------------------------------------------------------------
// Sektörler
// ---------------------------------------------------------------------------

export type SectorKey = "hekim" | "mobilya" | "insaat" | "diger";

export const SECTORS: Record<SectorKey, { label: string; weight: number }> = {
  hekim: { label: "Hekim / klinik", weight: 25 },
  mobilya: { label: "Mobilya / perakende", weight: 20 },
  insaat: { label: "İnşaat / emlak", weight: 20 },
  diger: { label: "Diğer", weight: 8 },
};

export const SECTOR_KEYS: SectorKey[] = ["hekim", "mobilya", "insaat", "diger"];

/** Türkçe karakterleri sadeleştirip küçük harfe çevirir (arama/eşleşme için). */
export const fold = (s: string) =>
  s.toLocaleLowerCase("tr").replace(/ı/g, "i").replace(/ş/g, "s").replace(/ğ/g, "g").replace(/ü/g, "u")
    .replace(/ö/g, "o").replace(/ç/g, "c").replace(/â/g, "a").replace(/î/g, "i").replace(/û/g, "u");

const SECTOR_PATTERNS: [SectorKey, RegExp][] = [
  ["hekim", /\b(dis|klinik|poliklinik|doktor|dr\.?|hekim|uzm\.?|op\.?|estetik|dermatolo|hastane|tip merkezi|saglik|goz|diyetisyen|dyt\.?|fizyoterap|fzt\.?|kadin dogum|ortodonti|implant|medikal)/],
  ["mobilya", /\b(mobilya|ev tekstil|dekorasyon|home|magaza|perakende|koltuk|yatak|mutfak|aydinlatma|hali|zuccaciye)/],
  ["insaat", /\b(insaat|emlak|gayrimenkul|yapi|konut|rezidans|proje|mimarlik|muteahhit|villa)/],
];

/** Serbest metinden (sorgu, sektör, CSV "ilgilendiği hizmet") sektör anahtarı. */
export function sectorKeyOf(...texts: (string | null | undefined)[]): SectorKey {
  const t = fold(texts.filter(Boolean).join(" "));
  for (const [key, re] of SECTOR_PATTERNS) if (re.test(t)) return key;
  return "diger";
}

// ---------------------------------------------------------------------------
// Puanlama (açıklamalı; Places metni / ham değer dökümde YOK, yalnızca bantlar)
// ---------------------------------------------------------------------------

/** Rast'ın bulunduğu il ve komşuları (şehir uyumu). */
export const HOME_CITIES = ["sakarya"];
export const NEAR_CITIES = ["kocaeli", "duzce", "bolu", "bilecik", "istanbul"];

export interface SiteSignals {
  https: boolean;
  hasTitle: boolean;
  hasOg: boolean;
}

export interface ScoreInput {
  sector?: string | null;
  /** Canlı Places verisi (saklanmaz; yalnızca puan hesabında kullanılır). */
  rating?: number | null;
  reviewsCount?: number | null;
  website?: string | null;
  site?: SiteSignals | null;
  instagram?: string | null;
  email?: string | null;
  city?: string | null;
  /** Arama yapılan il (varsa şehir uyumu bununla da sağlanır). */
  targetCity?: string | null;
}

export interface ScoreResult {
  score: number;
  breakdown: ScoreItem[];
}

export const SCORE_MAX = 100;

export function scoreProspect(input: ScoreInput): ScoreResult {
  const items: ScoreItem[] = [];
  const push = (key: string, label: string, points: number, max: number, detail: string) =>
    items.push({ key, label, points: Math.max(0, Math.min(points, max)), max, detail });

  const sk = sectorKeyOf(input.sector);
  push("sector", "Sektör uyumu", SECTORS[sk].weight, 25, SECTORS[sk].label);

  const r = typeof input.rating === "number" ? input.rating : null;
  if (r === null) push("rating", "Google puanı", 0, 10, "Bilinmiyor");
  else if (r >= 4.5) push("rating", "Google puanı", 10, 10, "≥ 4,5");
  else if (r >= 4.0) push("rating", "Google puanı", 7, 10, "4,0 – 4,4");
  else if (r >= 3.5) push("rating", "Google puanı", 3, 10, "3,5 – 3,9");
  else push("rating", "Google puanı", 0, 10, "< 3,5");

  const n = typeof input.reviewsCount === "number" ? input.reviewsCount : null;
  if (n === null) push("reviews", "Yorum sayısı", 0, 15, "Bilinmiyor");
  else if (n >= 200) push("reviews", "Yorum sayısı", 15, 15, "200+");
  else if (n >= 50) push("reviews", "Yorum sayısı", 10, 15, "50 – 199");
  else if (n >= 10) push("reviews", "Yorum sayısı", 5, 15, "10 – 49");
  else push("reviews", "Yorum sayısı", 0, 15, "< 10");

  const hasSite = Boolean(input.website && /^https?:\/\//i.test(input.website));
  push("website", "Web sitesi", hasSite ? 10 : 0, 10, hasSite ? "Var" : "Yok");

  if (input.site) {
    const s = input.site;
    const pts = (s.https ? 3 : 0) + (s.hasTitle ? 2 : 0) + (s.hasOg ? 3 : 0);
    const parts = [s.https ? "https" : "https yok", s.hasTitle ? "başlık" : "başlık yok", s.hasOg ? "OG etiketleri" : "OG yok"];
    push("site_quality", "Site kalitesi", pts, 8, parts.join(", "));
  } else {
    const https = hasSite && /^https:/i.test(input.website!);
    push("site_quality", "Site kalitesi", https ? 3 : 0, 8, hasSite ? (https ? "https (site taranmadı)" : "Site taranmadı") : "—");
  }

  push("instagram", "Instagram", input.instagram ? 10 : 0, 10, input.instagram ? "Hesap bulundu" : "Bulunamadı");
  push("email", "E-posta", input.email ? 12 : 0, 12, input.email ? "Adres bulundu" : "Bulunamadı");

  const c = fold(input.city ?? "");
  const tc = fold(input.targetCity ?? "");
  if (c && (HOME_CITIES.includes(c) || (tc && c === tc))) push("city", "Şehir uyumu", 10, 10, "Hedef bölge");
  else if (c && NEAR_CITIES.includes(c)) push("city", "Şehir uyumu", 5, 10, "Komşu il");
  else push("city", "Şehir uyumu", 0, 10, c ? "Bölge dışı" : "Bilinmiyor");

  const score = Math.min(SCORE_MAX, items.reduce((sum, it) => sum + it.points, 0));
  return { score, breakdown: items };
}

