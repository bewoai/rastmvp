// Müşteri portalı — saf (React'siz) mantık. Testler: scripts/portal-logic.test.mjs
// Not: Node'un type-stripping'i ile doğrudan test edilir; burada yalnızca `import type` kullanın.
//
// Veritabanındaki 0018_client_portal.sql RPC'lerinin (portal_get / portal_report_get) aynası:
// demo modunda (Supabase yok) herkese açık portal sayfası veriyi bu modülle seed'den üretir.
// KURALLAR (SQL ile aynı):
//   * Token: 64 küçük harf hex. İptal edilmiş (revoked_at dolu) ya da süresi dolmuş
//     (expires_at <= şimdi) token REDDEDİLİR → null (neden ayırt edilmez).
//   * Ay sınırları Europe/Istanbul. Pencere = geçen ay + bu ay.
//   * İçerik tarihi: yayınlandıysa yayın tarihi (yoksa planlanan), değilse planlanan; arşiv hariç.
//   * Onay: içeriğin EN SON sürümü; bekleyen talebin süresi dolduysa "expired".
//     Onay bağlantısı (token) YALNIZCA etkin durum "pending" iken açılır.
//   * pending listesi: müşterinin onay bekleyen TÜM içerikleri (ay sınırı yok).
//   * Çekimler: pencere içindeki, iptal edilmemiş çekimler.
//   * Son rapor: dönemi bu aydan sonra olmayan en son kayıtlı aylık rapor.
//   * Rapor görünümü: yalnızca o ay için KAYITLI rapor varsa (yoksa null).
import type {
  ApprovalChecklistItem, ApprovalStatus, Client, ClientPortalToken, ClientReport, ClientReportHighlights,
  Content, ContentApproval, ContentStatus, Shoot, ShootStatus,
} from "./types";

export const PORTAL_TZ = "Europe/Istanbul";
export const PORTAL_TOKEN_RE = /^[0-9a-f]{64}$/;

export const isValidPortalToken = (token: unknown): token is string =>
  typeof token === "string" && PORTAL_TOKEN_RE.test(token);

/** Herkese açık portal yolu. */
export const portalPath = (token: string) => `/portal/${token}`;
/** Portaldaki rapor yazdırma görünümü. */
export const portalReportPath = (token: string, month: string) => `/portal/${token}/rapor/${month}`;

/* ---------------- Token durumu ---------------- */

const toMs = (v: Date | string | number) => (v instanceof Date ? v.getTime() : new Date(v).getTime());

export type PortalTokenState = "active" | "revoked" | "expired";

/** İptal > süre dolumu > aktif (portal_active_token ile aynı). */
export function portalTokenState(
  t: Pick<ClientPortalToken, "revoked_at" | "expires_at">,
  now: Date | string | number,
): PortalTokenState {
  if (t.revoked_at) return "revoked";
  if (t.expires_at) {
    const exp = toMs(t.expires_at);
    if (!Number.isFinite(exp) || exp <= toMs(now)) return "expired";
  }
  return "active";
}

/** Token'a ait AKTİF kayıt; biçim hatalı / bulunamayan / iptal / süresi dolmuş → null. */
export function findActivePortalToken<T extends Pick<ClientPortalToken, "token" | "revoked_at" | "expires_at">>(
  tokens: readonly T[],
  token: unknown,
  now: Date | string | number,
): T | null {
  if (!isValidPortalToken(token)) return null;
  const t = tokens.find((x) => x.token === token);
  return t && portalTokenState(t, now) === "active" ? t : null;
}

/* ---------------- Tarih (Europe/Istanbul) ---------------- */

const pad = (n: number) => String(n).padStart(2, "0");
const HAS_TZ = /(Z|[+-]\d{2}(:?\d{2})?)$/i;

const istanbulParts = (d: Date) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: PORTAL_TZ, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return { day: `${get("year")}-${get("month")}-${get("day")}`, time: `${get("hour")}:${get("minute")}` };
};

/**
 * Tarih / zaman → İstanbul günü "YYYY-MM-DD" ("" geçersiz / boş). Saat dilimi taşımayan değer
 * (date ya da "YYYY-MM-DDTHH:mm") duvar saati kabul edilir; taşıyan değer İstanbul'a çevrilir.
 */
export function istanbulDay(value: string | null | undefined): string {
  if (!value) return "";
  const s = String(value).trim();
  if (!HAS_TZ.test(s) || /^\d{4}-\d{2}-\d{2}$/.test(s)) return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : "";
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? "" : istanbulParts(d).day;
}

/** İstanbul saati "HH:mm" (saat bilgisi yoksa ""). */
export function istanbulTime(value: string | null | undefined): string {
  if (!value) return "";
  const s = String(value).trim();
  if (!HAS_TZ.test(s) || /^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const m = /T(\d{2}):(\d{2})/.exec(s);
    return m ? `${m[1]}:${m[2]}` : "";
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? "" : istanbulParts(d).time;
}

/** "YYYY-MM" ± n ay. */
export function shiftMonth(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const total = y * 12 + (m - 1) + n;
  return `${Math.floor(total / 12)}-${pad((total % 12) + 1)}`;
}

export const isValidPortalMonth = (m: unknown): m is string =>
  typeof m === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(m);

/** Portal penceresi: bugün (İstanbul), bu ay ve geçen ay. */
export function portalMonths(now: Date | string | number): { today: string; current: string; previous: string } {
  const today = istanbulParts(new Date(toMs(now))).day;
  const current = today.slice(0, 7);
  return { today, current, previous: shiftMonth(current, -1) };
}

/* ---------------- Portal özeti (portal_get) ---------------- */

export interface PortalApprovalRef {
  version: number;
  status: ApprovalStatus;
  /** Yalnızca status === "pending" iken dolu (/onay/<token>). */
  token: string | null;
  expires_at: string | null;
}

export interface PortalContentRow {
  date: string;   // "YYYY-MM-DD" ya da ""
  month: string;  // "YYYY-MM"
  title: string;
  channel: string;
  status: ContentStatus;
  approval: PortalApprovalRef | null;
}

export interface PortalPendingRow {
  title: string;
  version: number;
  token: string;
  expires_at: string;
  date: string;
}

export interface PortalShootRow {
  date: string;
  time: string;
  type: string | null;
  location: string | null;
  status: ShootStatus;
}

export interface PortalReportSummary {
  month: string;
  notes: string | null;
  highlights: ClientReportHighlights;
  generated_at: string;
}

export interface PortalPayload {
  client_name: string;
  agency_name: string;
  contact_line: string;
  today: string;
  months: { current: string; previous: string };
  contents: PortalContentRow[];
  pending: PortalPendingRow[];
  pending_count: number;
  shoots: PortalShootRow[];
  latest_report: PortalReportSummary | null;
}

type SrcContent = Pick<Content, "id" | "client_id" | "title" | "platform" | "content_type" | "status" | "planned_date" | "published_date">;
type SrcShoot = Pick<Shoot, "id" | "client_id" | "title" | "shoot_type" | "scheduled_at" | "location" | "status">;
type SrcApproval = Pick<
  ContentApproval,
  "content_id" | "version" | "title" | "status" | "token" | "sent_at" | "expires_at" | "decided_at" | "decided_by_name" | "checklist"
>;
type SrcReport = Pick<ClientReport, "client_id" | "period" | "notes" | "highlights" | "generated_at">;

/** Portal verisinin kaynağı (demo: seed; testler: elle). Org ayrımı veritabanında RLS/RPC ile yapılır. */
export interface PortalSource {
  token: string;
  tokens: readonly ClientPortalToken[];
  clients: readonly Pick<Client, "id" | "name">[];
  contents: readonly SrcContent[];
  shoots: readonly SrcShoot[];
  approvals: readonly SrcApproval[];
  reports: readonly SrcReport[];
  agencyName: string;
  /** Bağlantıyı oluşturan kişinin adı (contact_line boşsa iletişim satırına eklenir). */
  creatorName?: string | null;
  now: Date | string | number;
}

const clean = (s: string | null | undefined) => (s ?? "").trim();

export const channelOf = (c: Pick<SrcContent, "platform" | "content_type">) =>
  [c.platform, c.content_type].map(clean).filter(Boolean).join(" · ");

/** Portalda gösterilen içerik günü (report-logic ile aynı kural). */
export const portalContentDay = (c: Pick<SrcContent, "status" | "planned_date" | "published_date">) =>
  c.status === "published" ? istanbulDay(c.published_date) || istanbulDay(c.planned_date) : istanbulDay(c.planned_date);

/** İçerik → en son onay sürümü. */
function latestApprovals<T extends Pick<SrcApproval, "content_id" | "version">>(approvals: readonly T[]): Map<string, T> {
  const map = new Map<string, T>();
  for (const a of approvals) {
    if (!a.content_id) continue;
    const cur = map.get(a.content_id);
    if (!cur || a.version > cur.version) map.set(a.content_id, a);
  }
  return map;
}

/** En son sürümün etkin durumu ve (yalnızca bekliyorsa) bağlantısı. */
export function portalApprovalRef(
  a: Pick<SrcApproval, "version" | "status" | "token" | "expires_at">,
  now: Date | string | number,
): PortalApprovalRef {
  const exp = toMs(a.expires_at);
  const status: ApprovalStatus =
    a.status === "pending" && (!Number.isFinite(exp) || exp <= toMs(now)) ? "expired" : a.status;
  const pending = status === "pending";
  return { version: a.version, status, token: pending ? a.token : null, expires_at: pending ? a.expires_at : null };
}

export function buildPortalPayload(src: PortalSource): PortalPayload | null {
  const t = findActivePortalToken(src.tokens, src.token, src.now);
  if (!t) return null;
  const client = src.clients.find((c) => c.id === t.client_id);
  if (!client) return null;

  const { today, current, previous } = portalMonths(src.now);
  const own = src.contents.filter((c) => c.client_id === client.id && c.status !== "archived");
  const ownIds = new Set(own.map((c) => c.id));
  const latest = latestApprovals(src.approvals.filter((a) => a.content_id && ownIds.has(a.content_id)));

  const rows = own.map((c) => {
    const date = portalContentDay(c);
    const a = latest.get(c.id);
    return { c, a, date, ref: a ? portalApprovalRef(a, src.now) : null };
  });
  const byTitle = (x: string, y: string) => x.localeCompare(y, "tr");

  const contents: PortalContentRow[] = rows
    .filter((r) => r.date && (r.date.slice(0, 7) === current || r.date.slice(0, 7) === previous))
    .sort((x, y) => x.date.localeCompare(y.date) || byTitle(x.c.title, y.c.title))
    .map((r) => ({
      date: r.date,
      month: r.date.slice(0, 7),
      title: r.c.title,
      channel: channelOf(r.c),
      status: r.c.status,
      approval: r.ref,
    }));

  const pending: PortalPendingRow[] = rows
    .filter((r) => r.ref?.status === "pending" && r.ref.token && r.a)
    .map((r) => ({
      title: clean(r.a!.title) || r.c.title,
      version: r.ref!.version,
      token: r.ref!.token!,
      expires_at: r.ref!.expires_at!,
      date: r.date,
    }))
    .sort((x, y) => toMs(x.expires_at) - toMs(y.expires_at) || byTitle(x.title, y.title));

  const shoots: PortalShootRow[] = src.shoots
    .filter((s) => s.client_id === client.id && s.status !== "cancelled" && s.scheduled_at)
    .map((s) => ({ s, date: istanbulDay(s.scheduled_at) }))
    .filter(({ date }) => date && (date.slice(0, 7) === current || date.slice(0, 7) === previous))
    .sort((x, y) => `${x.date}T${istanbulTime(x.s.scheduled_at)}`.localeCompare(`${y.date}T${istanbulTime(y.s.scheduled_at)}`))
    .map(({ s, date }) => ({
      date,
      time: istanbulTime(s.scheduled_at),
      type: s.shoot_type ?? null,
      location: s.location ?? null,
      status: s.status,
    }));

  const report = src.reports
    .filter((r) => r.client_id === client.id && String(r.period).slice(0, 7) <= current)
    .sort((x, y) => String(y.period).localeCompare(String(x.period)))[0];

  const contact = clean(t.contact_line) || [src.agencyName, clean(src.creatorName)].filter(Boolean).join(" · ");

  return {
    client_name: client.name,
    agency_name: src.agencyName,
    contact_line: contact,
    today,
    months: { current, previous },
    contents,
    pending,
    pending_count: pending.length,
    shoots,
    latest_report: report
      ? {
        month: String(report.period).slice(0, 7),
        notes: report.notes ?? null,
        highlights: report.highlights ?? {},
        generated_at: report.generated_at,
      }
      : null,
  };
}

/** Portal içerik satırlarını aya göre ayırır. */
export function splitByMonth(payload: Pick<PortalPayload, "contents" | "months">) {
  return {
    current: payload.contents.filter((c) => c.month === payload.months.current),
    previous: payload.contents.filter((c) => c.month === payload.months.previous),
  };
}

/* ---------------- Rapor görünümü (portal_report_get) ---------------- */

export interface PortalReportApproval {
  version: number;
  title: string;
  status: ApprovalStatus;
  sent_at: string;
  expires_at: string;
  decided_at: string | null;
  decided_by_name: string | null;
  checklist: ApprovalChecklistItem[];
}

export interface PortalReportContent {
  title: string;
  platform: string | null;
  content_type: string | null;
  status: ContentStatus;
  planned_date: string | null;
  published_date: string | null;
  approvals: PortalReportApproval[];
}

export interface PortalReportShoot {
  title: string;
  shoot_type: string | null;
  scheduled_at: string;
  location: string | null;
  status: ShootStatus;
}

export interface PortalReportData {
  client_name: string;
  agency_name: string;
  brand_names: string[];
  month: string;
  report: { notes: string | null; highlights: ClientReportHighlights; generated_at: string };
  /** Rapor ayının üst kümesi; kesin süzgeç buildMonthlyReport'ta. */
  contents: PortalReportContent[];
  shoots: PortalReportShoot[];
}

/** Demo / test: portal_report_get aynası. Kayıtlı rapor yoksa veya token geçersizse null. */
export function buildPortalReportData(
  src: Omit<PortalSource, "creatorName"> & { brands: readonly { client_id: string; name: string }[] },
  month: string,
): PortalReportData | null {
  if (!isValidPortalMonth(month)) return null;
  const t = findActivePortalToken(src.tokens, src.token, src.now);
  if (!t) return null;
  const client = src.clients.find((c) => c.id === t.client_id);
  if (!client) return null;
  const saved = src.reports.find((r) => r.client_id === client.id && String(r.period).slice(0, 7) === month);
  if (!saved) return null;

  const next = shiftMonth(month, 1);
  const inMonth = (v: string | null | undefined) => istanbulDay(v).slice(0, 7) === month;
  const own = src.contents.filter((c) => c.client_id === client.id);
  const approvalsOf = (id: string) =>
    src.approvals.filter((a) => a.content_id === id).sort((a, b) => a.version - b.version);

  const contents = own
    .filter((c) => {
      const planned = istanbulDay(c.planned_date).slice(0, 7);
      return planned === month || planned === next || inMonth(c.published_date)
        || approvalsOf(c.id).some((a) => inMonth(a.sent_at) || inMonth(a.decided_at));
    })
    .map<PortalReportContent>((c) => ({
      title: c.title,
      platform: c.platform ?? null,
      content_type: c.content_type ?? null,
      status: c.status,
      planned_date: c.planned_date ?? null,
      published_date: c.published_date ?? null,
      approvals: approvalsOf(c.id).map((a) => ({
        version: a.version,
        title: a.title,
        status: a.status,
        sent_at: a.sent_at,
        expires_at: a.expires_at,
        decided_at: a.decided_at ?? null,
        decided_by_name: a.decided_by_name ?? null,
        checklist: Array.isArray(a.checklist) ? a.checklist : [],
      })),
    }));

  const shoots = src.shoots
    .filter((s) => s.client_id === client.id && s.scheduled_at && inMonth(s.scheduled_at))
    .map<PortalReportShoot>((s) => ({
      title: s.title,
      shoot_type: s.shoot_type ?? null,
      scheduled_at: s.scheduled_at!,
      location: s.location ?? null,
      status: s.status,
    }));

  return {
    client_name: client.name,
    agency_name: src.agencyName,
    brand_names: src.brands.filter((b) => b.client_id === client.id).map((b) => b.name).sort((a, b) => a.localeCompare(b, "tr")),
    month,
    report: { notes: saved.notes ?? null, highlights: saved.highlights ?? {}, generated_at: saved.generated_at },
    contents,
    shoots,
  };
}

/**
 * RPC verisi → buildMonthlyReport girdisi. İç id'ler portala hiç gelmez; satırlar burada yapay
 * id'lerle (c0, c0-a1, s0…) bağlanır.
 */
export function portalReportInput(data: PortalReportData, now: string) {
  const clientId = "portal";
  const contents = data.contents.map((c, i) => ({
    id: `c${i}`,
    client_id: clientId,
    title: c.title,
    platform: c.platform ?? undefined,
    content_type: c.content_type ?? undefined,
    status: c.status,
    planned_date: c.planned_date ?? undefined,
    published_date: c.published_date ?? undefined,
  }));
  const approvals = data.contents.flatMap((c, i) =>
    (c.approvals ?? []).map((a) => ({
      id: `c${i}-a${a.version}`,
      content_id: `c${i}`,
      version: a.version,
      title: a.title,
      status: a.status,
      sent_at: a.sent_at,
      expires_at: a.expires_at,
      decided_at: a.decided_at,
      decided_by_name: a.decided_by_name,
      checklist: Array.isArray(a.checklist) ? a.checklist : [],
    })),
  );
  const shoots = data.shoots.map((s, i) => ({
    id: `s${i}`,
    client_id: clientId,
    title: s.title,
    shoot_type: s.shoot_type ?? undefined,
    scheduled_at: s.scheduled_at,
    location: s.location ?? undefined,
    status: s.status,
  }));
  return { clientId, month: data.month, contents, shoots, approvals, now };
}

/* ---------------- Paylaşım ---------------- */

export function portalShareText(p: { clientName: string; url: string }): string {
  return `Merhaba, ${p.clientName} için bu ay ve geçen ayın içeriklerini, çekim günlerini, onayınızı bekleyen içerikleri ve aylık raporu tek sayfada görebilirsiniz: ${p.url} — Bağlantı size özeldir, lütfen başkalarıyla paylaşmayın.`;
}
