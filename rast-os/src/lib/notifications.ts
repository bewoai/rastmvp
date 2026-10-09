// Bildirim zili (Topbar) — saf mantık: store'daki koleksiyonlardan bildirim türetme, okunmamış sayısı,
// sekme başlığı öneki ve okundu kimliklerinin birleştirilmesi. Ağ isteği yok; koleksiyonların hepsi açılış
// isteğiyle gelir (bootstrap-logic → NOTIFICATION_COLLECTIONS ⊂ CORE_COLLECTIONS).
// Testler: scripts/notifications-logic.test.mjs
import type { Client, Content, ContentApproval, Expense, Invoice, Lead, Proposal, Task } from "./types";

export type NoticeKind =
  | "lead" | "leads-more" | "approval" | "proposal"
  | "invoices" | "expenses" | "tasks" | "contents";

export type NoticeTone = "accent" | "danger" | "warning" | "success";

export interface Notice {
  /** Kararlı kimlik: okundu durumu buna göre saklanır. Olay değişince (ör. yeni sayı / yeni karar) yeni kimlik. */
  id: string;
  kind: NoticeKind;
  title: string;
  body: string;
  href: string;
  tone: NoticeTone;
  /** Olay zamanı (ISO) — olay bildirimleri yeniden eskiye sıralanır. Toplu bildirimlerde yok. */
  at?: string;
}

export interface NoticeInput {
  invoices: readonly Invoice[];
  expenses: readonly Expense[];
  tasks: readonly Task[];
  contents: readonly Content[];
  leads: readonly Lead[];
  content_approvals: readonly ContentApproval[];
  proposals: readonly Proposal[];
  clients?: readonly Client[];
}

/** "Yakın zamanda" penceresi: müşteri kararı / teklif sonucu bu kadar gün zilde kalır. */
export const RECENT_DAYS = 14;
/** Tek tek gösterilen en fazla yeni lead; fazlası tek "N yeni lead daha" satırında. */
export const MAX_LEAD_NOTICES = 5;

const DAY = 86_400_000;

function dayStamp(value?: string) {
  return value ? new Date(`${value.slice(0, 10)}T12:00:00`).getTime() : Number.POSITIVE_INFINITY;
}

const ms = (iso?: string | null) => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? t : NaN;
};

const clip = (s: string | null | undefined, n = 90) => {
  const v = (s ?? "").replace(/\s+/g, " ").trim();
  return v.length > n ? `${v.slice(0, n - 1)}…` : v;
};

/**
 * Bildirimleri türetir. Olaylar (yeni lead, müşteri kararı, teklif sonucu) en yeni önce; ardından toplu
 * hatırlatmalar (bekleyen gelir / gider, yaklaşan görev / içerik).
 */
export function deriveNotices(input: NoticeInput, now: Date = new Date()): Notice[] {
  const nowMs = now.getTime();
  const since = nowMs - RECENT_DAYS * DAY;
  const clientName = new Map((input.clients ?? []).map((c) => [c.id, c.name]));
  const events: Notice[] = [];

  // 1) Yeni lead'ler (status new) — en yeni önce
  const newLeads = input.leads
    .filter((l) => l.status === "new")
    .sort((a, b) => (ms(b.created_at) || 0) - (ms(a.created_at) || 0));
  for (const l of newLeads.slice(0, MAX_LEAD_NOTICES)) {
    events.push({
      id: `lead:${l.id}`,
      kind: "lead",
      title: `Yeni lead: ${l.company_name}`,
      body: [l.contact_person, l.source, l.interested_in].filter(Boolean).join(" · ") || "Potansiyel müşteriyi ara.",
      href: `/crm/leads?ac=${encodeURIComponent(l.id)}`,
      tone: "accent",
      at: l.created_at,
    });
  }

  // 2) Müşterinin karar verdiği içerik onayları (son RECENT_DAYS gün)
  for (const a of input.content_approvals) {
    if (a.status !== "approved" && a.status !== "changes_requested") continue;
    const t = ms(a.decided_at);
    if (!(t >= since) || t > nowMs + DAY) continue;
    const approved = a.status === "approved";
    events.push({
      id: `approval:${a.id}:${a.status}`,
      kind: "approval",
      title: `${approved ? "Müşteri onayladı" : "Revize istendi"}: ${a.title}`,
      body: [a.decided_by_name, clip(a.note)].filter(Boolean).join(" · ") || (approved ? "İçerik yayına hazır." : "Değişiklik talebini incele."),
      href: a.content_id ? `/content?ac=${encodeURIComponent(a.content_id)}` : "/content",
      tone: approved ? "success" : "warning",
      at: a.decided_at ?? undefined,
    });
  }

  // 3) Kabul / red edilen teklifler (son RECENT_DAYS gün; zaman = son güncelleme)
  for (const p of input.proposals) {
    if (p.status !== "accepted" && p.status !== "rejected") continue;
    const at = p.updated_at || p.created_at;
    const t = ms(at);
    if (!(t >= since) || t > nowMs + DAY) continue;
    const accepted = p.status === "accepted";
    events.push({
      id: `proposal:${p.id}:${p.status}`,
      kind: "proposal",
      title: `Teklif ${accepted ? "kabul edildi" : "reddedildi"}: ${p.title}`,
      body: [p.proposal_no, p.client_id ? clientName.get(p.client_id) : undefined].filter(Boolean).join(" · "),
      href: `/teklifler/${encodeURIComponent(p.id)}`,
      tone: accepted ? "success" : "danger",
      at,
    });
  }

  events.sort((a, b) => (ms(b.at) || 0) - (ms(a.at) || 0));

  if (newLeads.length > MAX_LEAD_NOTICES) {
    const rest = newLeads.length - MAX_LEAD_NOTICES;
    events.push({
      id: `leads-more:${newLeads.length}`,
      kind: "leads-more",
      title: `${rest} yeni lead daha`,
      body: "Potansiyel müşteriler listesinde.",
      href: "/crm/leads",
      tone: "accent",
    });
  }

  // 4) Toplu hatırlatmalar (kimlik sayıyı içerir: sayı değişince yeniden okunmamış olur)
  const totals: Notice[] = [];
  const unpaid = input.invoices.filter((i) => i.status !== "paid" && i.status !== "cancelled" && i.paid_amount < i.amount + i.vat).length;
  if (unpaid) totals.push({ id: `unpaid-invoices:${unpaid}`, kind: "invoices", title: `${unpaid} bekleyen gelir`, body: "Tahsilat bekleyen faturaları kontrol et.", href: "/finance/invoices", tone: "accent" });

  const pendingExpenses = input.expenses.filter((e) => e.payment_status === "pending").length;
  if (pendingExpenses) totals.push({ id: `pending-expenses:${pendingExpenses}`, kind: "expenses", title: `${pendingExpenses} bekleyen gider`, body: "Taksit veya ödeme durumlarını kontrol et.", href: "/finance/expenses", tone: "danger" });

  const weekEnd = nowMs + 7 * DAY;
  // Gün başı: bugünün tarihi (öğlen damgası) dahil
  const todayStart = dayStamp(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`);
  const upcomingTasks = input.tasks.filter((t) => t.status !== "done" && dayStamp(t.due_date) >= todayStart && dayStamp(t.due_date) <= weekEnd).length;
  if (upcomingTasks) totals.push({ id: `upcoming-tasks:${upcomingTasks}`, kind: "tasks", title: `${upcomingTasks} yaklaşan görev`, body: "Önümüzdeki 7 gün içindeki görevler.", href: "/tasks", tone: "warning" });

  const upcomingContents = input.contents.filter((c) => c.status !== "published" && c.status !== "archived" && dayStamp(c.planned_date) >= todayStart && dayStamp(c.planned_date) <= weekEnd).length;
  if (upcomingContents) totals.push({ id: `upcoming-content:${upcomingContents}`, kind: "contents", title: `${upcomingContents} yaklaşan içerik`, body: "İçerik takvimindeki yayınları kontrol et.", href: "/content", tone: "accent" });

  return [...events, ...totals];
}

export function countUnread(notices: readonly Notice[], read: ReadonlySet<string> | readonly string[]): number {
  const set = read instanceof Set ? read : new Set(read as readonly string[]);
  let n = 0;
  for (const x of notices) if (!set.has(x.id)) n++;
  return n;
}

const COUNT_PREFIX = /^\(\d+\+?\)\s/;

/** Sekme başlığı: okunmamış varsa "(n) " öneki; yoksa önek kaldırılır. Tekrar uygulanınca bozulmaz. */
export function titleWithCount(title: string, unread: number): string {
  const base = title.replace(COUNT_PREFIX, "");
  if (unread <= 0) return base;
  return `(${unread > 99 ? "99+" : unread}) ${base}`;
}

/** Okundu kimliklerini birleştirir (yeniler sonda), tekrarsız; en fazla `cap` (en yeniler kalır). */
export function mergeReadIds(existing: readonly string[], add: readonly string[], cap = 300): string[] {
  const set = new Set(existing);
  for (const id of add) {
    set.delete(id);
    set.add(id);
  }
  const all = [...set];
  return all.length > cap ? all.slice(all.length - cap) : all;
}

/** localStorage'dan okunan ham değeri doğrular (bozuk / beklenmeyen → boş). */
export function parseReadIds(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}
