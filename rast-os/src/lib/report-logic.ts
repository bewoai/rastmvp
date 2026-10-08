// Aylık müşteri raporu — saf (React'siz) mantık. Testler: scripts/report-logic.test.mjs
// Not: Node'un type-stripping'i ile doğrudan test edilir; burada yalnızca `import type` kullanın.
//
// KURALLAR (yalnızca veritabanındaki kayıtlardan SAYIM; tahmini / uydurma performans verisi yok):
//   * Ay: "YYYY-MM". Tarih alanı saat dilimi taşıyorsa (timestamptz) yerel saate çevrilir, yoksa
//     (date / "YYYY-MM-DDTHH:mm") metindeki gün esas alınır.
//   * Planlanan  = müşterinin planned_date'i bu ayda olan içerikleri (arşivlenenler hariç).
//   * Yayınlanan = durumu "published" olan ve yayın tarihi (published_date, yoksa planned_date)
//     bu ayda olan içerikler.
//   * İçerik listesi = planlanan ∪ yayınlanan (tarihe göre sıralı).
//   * Onay dağılımı = listedeki her içeriğin EN SON onay sürümünün etkin durumu (bekleyen talep
//     süresi dolduysa / yenisi gönderildiyse "expired"); hiç gönderilmemişse "none".
//   * Onay kayıtları = listedeki içeriklerin tüm sürümleri + bu ay gönderilen / karara bağlanan
//     diğer müşteri içeriklerinin sürümleri (mevzuat kanıtı). İçeriği silinmiş onay kaydı
//     müşteriye bağlanamadığı için rapora girmez.
//   * Çekimler = müşterinin scheduled_at'i bu ayda olan çekimleri; "çekim günü" iptal edilmemiş
//     çekimlerin farklı gün sayısıdır.
//   * Gelecek ay planı = müşterinin planned_date'i sonraki ayda olan içerikleri (arşiv hariç).
//   * Reklam metriği YOK (hekim müşterileri) — yalnızca elle yazılan "Reklam / GİP notları".
import type {
  ApprovalStatus, ClientReportHighlights, Content, ContentApproval, ContentStatus, Shoot, ShootStatus,
} from "./types";

export type ApprovalBucket = ApprovalStatus | "none";

export const APPROVAL_BUCKETS: readonly ApprovalBucket[] = ["approved", "pending", "changes_requested", "expired", "none"];

export type ReportContent = Pick<
  Content,
  "id" | "client_id" | "title" | "platform" | "content_type" | "status" | "planned_date" | "published_date"
>;
export type ReportShoot = Pick<Shoot, "id" | "client_id" | "title" | "shoot_type" | "scheduled_at" | "location" | "status">;
export type ReportApproval = Pick<
  ContentApproval,
  "id" | "content_id" | "version" | "title" | "status" | "sent_at" | "expires_at" | "decided_at" | "decided_by_name" | "checklist"
>;

export interface ReportInput {
  clientId: string;
  /** "YYYY-MM" */
  month: string;
  contents: readonly ReportContent[];
  shoots: readonly ReportShoot[];
  approvals: readonly ReportApproval[];
  /** Bekleyen onayların süresini değerlendirmek için "şimdi" (ISO). */
  now: string;
}

export interface ReportContentRow {
  id: string;
  /** Gösterilen tarih (yayınlandıysa yayın, değilse planlanan; "YYYY-MM-DD" ya da boş). */
  date: string;
  title: string;
  /** Kanal: platform + içerik türü (ör. "Instagram · reels"). */
  channel: string;
  status: ContentStatus;
  published: boolean;
  approval: { version: number; status: ApprovalStatus } | null;
}

export interface ReportShootRow {
  id: string;
  date: string;
  time: string;
  title: string;
  type: string;
  location: string;
  status: ShootStatus;
}

export interface ReportApprovalRow {
  id: string;
  contentTitle: string;
  version: number;
  status: ApprovalStatus;
  sentAt: string;
  decidedAt: string | null;
  decidedBy: string | null;
  checked: number;
  total: number;
}

export interface MonthlyReport {
  month: string;
  period: string;       // "YYYY-MM-01"
  nextMonth: string;    // "YYYY-MM"
  summary: {
    planned: number;
    published: number;
    /** Bu ay planlanıp bu ay yayınlanan. */
    publishedFromPlan: number;
    contents: number;
    approvals: Record<ApprovalBucket, number>;
    shoots: number;
    shootDays: number;
  };
  contents: ReportContentRow[];
  shoots: ReportShootRow[];
  approvalRecords: ReportApprovalRow[];
  nextMonthPlan: ReportContentRow[];
}

/* ---------------- Tarih yardımcıları ---------------- */

const pad = (n: number) => String(n).padStart(2, "0");
const HAS_TZ = /(Z|[+-]\d{2}(:?\d{2})?)$/i;

/** Tarih / zaman metni → yerel "YYYY-MM-DD" (geçersiz / boşsa ""). */
export function localDay(value: string | null | undefined): string {
  if (!value) return "";
  const s = String(value).trim();
  if (!HAS_TZ.test(s) || /^\d{4}-\d{2}-\d{2}$/.test(s)) {
    return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : "";
  }
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Yerel saat "HH:mm" (saat bilgisi yoksa ""). */
export function localTime(value: string | null | undefined): string {
  if (!value) return "";
  const s = String(value).trim();
  if (!HAS_TZ.test(s) || /^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const m = /T(\d{2}):(\d{2})/.exec(s);
    return m ? `${m[1]}:${m[2]}` : "";
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? "" : `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export const monthOf = (value: string | null | undefined) => localDay(value).slice(0, 7);

export const isValidMonth = (m: string | null | undefined): m is string =>
  typeof m === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(m);

/** "YYYY-MM" ± n ay. */
export function shiftMonth(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const total = y * 12 + (m - 1) + n;
  return `${Math.floor(total / 12)}-${pad((total % 12) + 1)}`;
}

/** Raporun dönemi (veritabanındaki `period`): ayın 1'i. */
export const periodOf = (month: string) => `${month}-01`;

/** Varsayılan rapor ayı: biten ay (bugünün bir önceki ayı). */
export const defaultReportMonth = (today: string) => shiftMonth(today.slice(0, 7), -1);

/** "Ağustos 2026" */
export function monthLabelTR(month: string): string {
  if (!isValidMonth(month)) return month;
  const [y, m] = month.split("-").map(Number);
  const s = new Intl.DateTimeFormat("tr-TR", { month: "long", year: "numeric" }).format(new Date(y, m - 1, 15));
  return s.charAt(0).toLocaleUpperCase("tr-TR") + s.slice(1);
}

/* ---------------- Onay ---------------- */

const toMs = (v: string) => new Date(v).getTime();

/** Etkin onay durumu (approval-logic.effectiveStatus ile aynı kural). */
function effective(a: Pick<ReportApproval, "status" | "expires_at">, now: string, newer: boolean): ApprovalStatus {
  if (a.status === "pending") {
    const exp = toMs(a.expires_at);
    if (newer || !Number.isFinite(exp) || exp <= toMs(now)) return "expired";
  }
  return a.status;
}

/* ---------------- Rapor ---------------- */

const channelOf = (c: Pick<ReportContent, "platform" | "content_type">) =>
  [c.platform, c.content_type].map((s) => (s ?? "").trim()).filter(Boolean).join(" · ");

const publishDay = (c: ReportContent) => localDay(c.published_date) || localDay(c.planned_date);

export function buildMonthlyReport(input: ReportInput): MonthlyReport {
  const { clientId, month, now } = input;
  const next = shiftMonth(month, 1);
  const own = input.contents.filter((c) => c.client_id === clientId && c.status !== "archived");
  const ownIds = new Set(input.contents.filter((c) => c.client_id === clientId).map((c) => c.id));

  // İçerik → sürümler (en yeni önce)
  const versions = new Map<string, ReportApproval[]>();
  for (const a of input.approvals) {
    if (!a.content_id || !ownIds.has(a.content_id)) continue;
    const list = versions.get(a.content_id) ?? [];
    list.push(a);
    versions.set(a.content_id, list);
  }
  for (const list of versions.values()) list.sort((a, b) => b.version - a.version);

  const maxVersion = (contentId: string | null | undefined) =>
    (contentId && versions.get(contentId)?.[0]?.version) || 0;
  const statusOf = (a: ReportApproval) => effective(a, now, a.version < maxVersion(a.content_id));

  const latestApproval = (contentId: string) => {
    const a = versions.get(contentId)?.[0];
    return a ? { version: a.version, status: statusOf(a) } : null;
  };

  const toRow = (c: ReportContent): ReportContentRow => {
    const published = c.status === "published";
    return {
      id: c.id,
      date: published ? publishDay(c) : localDay(c.planned_date),
      title: c.title,
      channel: channelOf(c),
      status: c.status,
      published,
      approval: latestApproval(c.id),
    };
  };
  const byDate = (a: ReportContentRow, b: ReportContentRow) =>
    (a.date || "9999").localeCompare(b.date || "9999") || a.title.localeCompare(b.title, "tr");

  const plannedIds = new Set(own.filter((c) => monthOf(c.planned_date) === month).map((c) => c.id));
  const publishedIds = new Set(
    own.filter((c) => c.status === "published" && publishDay(c).slice(0, 7) === month).map((c) => c.id),
  );
  const contents = own.filter((c) => plannedIds.has(c.id) || publishedIds.has(c.id)).map(toRow).sort(byDate);

  const approvals = Object.fromEntries(APPROVAL_BUCKETS.map((b) => [b, 0])) as Record<ApprovalBucket, number>;
  for (const row of contents) approvals[row.approval?.status ?? "none"]++;

  // Onay kayıtları: listedeki içeriklerin tüm sürümleri + bu ay gönderilen/karara bağlanan diğerleri
  const listed = new Set(contents.map((c) => c.id));
  const contentTitle = new Map(input.contents.map((c) => [c.id, c.title]));
  const approvalRecords: ReportApprovalRow[] = [];
  for (const list of versions.values()) {
    for (const a of list) {
      const inMonth = monthOf(a.sent_at) === month || monthOf(a.decided_at) === month;
      if (!listed.has(a.content_id!) && !inMonth) continue;
      const checklist = Array.isArray(a.checklist) ? a.checklist : [];
      approvalRecords.push({
        id: a.id,
        contentTitle: contentTitle.get(a.content_id!) || a.title,
        version: a.version,
        status: statusOf(a),
        sentAt: a.sent_at,
        decidedAt: a.decided_at ?? null,
        decidedBy: a.decided_by_name ?? null,
        checked: checklist.filter((i) => i?.checked).length,
        total: checklist.length,
      });
    }
  }
  approvalRecords.sort(
    (a, b) => a.contentTitle.localeCompare(b.contentTitle, "tr") || a.version - b.version,
  );

  const shoots = input.shoots
    .filter((s) => s.client_id === clientId && monthOf(s.scheduled_at) === month)
    .map<ReportShootRow>((s) => ({
      id: s.id,
      date: localDay(s.scheduled_at),
      time: localTime(s.scheduled_at),
      title: s.title,
      type: s.shoot_type ?? "",
      location: s.location ?? "",
      status: s.status,
    }))
    .sort((a, b) => `${a.date}T${a.time}`.localeCompare(`${b.date}T${b.time}`));
  const shootDays = new Set(shoots.filter((s) => s.status !== "cancelled").map((s) => s.date)).size;

  const nextMonthPlan = own.filter((c) => monthOf(c.planned_date) === next).map(toRow).sort(byDate);

  return {
    month,
    period: periodOf(month),
    nextMonth: next,
    summary: {
      planned: plannedIds.size,
      published: publishedIds.size,
      publishedFromPlan: [...plannedIds].filter((id) => publishedIds.has(id)).length,
      contents: contents.length,
      approvals,
      shoots: shoots.length,
      shootDays,
    },
    contents,
    shoots,
    approvalRecords,
    nextMonthPlan,
  };
}

/* ---------------- Notlar / öne çıkanlar ---------------- */

/** Textarea metni → madde listesi (boş satırlar ve baştaki "-", "•" atılır). */
export function parsePoints(text: string | null | undefined): string[] {
  return String(text ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim().replace(/^[-•*]\s*/, "").trim())
    .filter(Boolean);
}

export const pointsToText = (points: readonly string[] | null | undefined) => (points ?? []).join("\n");

/** Kaydedilecek highlights nesnesi (boş alanlar yazılmaz). */
export function normalizeHighlights(h: { points?: string | string[] | null; ads_note?: string | null }): ClientReportHighlights {
  const points = Array.isArray(h.points) ? h.points.map((p) => p.trim()).filter(Boolean) : parsePoints(h.points);
  const ads = (h.ads_note ?? "").trim();
  const out: ClientReportHighlights = {};
  if (points.length) out.points = points;
  if (ads) out.ads_note = ads;
  return out;
}

/** Bir müşterinin bir ayı için kayıtlı rapor (period "YYYY-MM-01"; "YYYY-MM-01T…" de kabul edilir). */
export function findReport<T extends { client_id: string; period: string }>(
  reports: readonly T[],
  clientId: string,
  month: string,
): T | undefined {
  return reports.find((r) => r.client_id === clientId && String(r.period).slice(0, 7) === month);
}
