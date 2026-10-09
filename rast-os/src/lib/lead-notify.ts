// Yeni lead için EKİBE İÇ e-posta bildirimi (POST /api/leads başarıyla kaydettikten sonra). YALNIZCA SUNUCU.
//  - Ekibin kendi kutusuna giden iç bildirimdir (ticari ileti değil): Müşteri Bulma'nın OUTREACH_EMAIL_ENABLED
//    bayrağından BAĞIMSIZDIR; yalnızca LEAD_NOTIFY_TO + SMTP_* tanımlıysa çalışır, yoksa sessizce no-op.
//  - Lead kaydını asla bloklamaz/bozmaz: hiçbir zaman fırlatmaz, ≤5 sn zaman aşımı, hatada yalnızca kısa
//    console.error (kişisel veri / SMTP ayrıntısı loglanmaz).
//  - İçerik üretimi saf fonksiyonlardır (escape, başlık enjeksiyonu temizliği, mesaj kırpma) → ağsız test edilir.
// Testler: scripts/lead-notify.test.mjs · Kurulum: docs/lead-bildirim.md
// Not: type-stripping ile doğrudan test edilir; yalnızca `import type` + .ts uzantılı göreli importlar kullanın.
import { sourceLabelFor } from "./lead-logic.ts";
import type { LeadIntake } from "./lead-logic.ts";
import { createSmtpTransport, smtpConfigFromEnv } from "./mailer.ts";
import type { SmtpConfig, SmtpTimeouts } from "./mailer.ts";

/** Bildirim gönderimi için toplam üst süre (bağlan + gönder). */
export const LEAD_NOTIFY_TIMEOUT_MS = 5000;
/** E-postadaki mesaj alanının en fazla uzunluğu (karakter, "…" dahil). */
export const NOTIFY_MESSAGE_MAX = 1000;
/** Tek seferde en fazla alıcı (yanlış yapılandırmaya karşı üst sınır). */
export const MAX_RECIPIENTS = 10;
/** Rast OS lead listesi (lead başına ayrı bir rota yok). */
export const DEFAULT_LEADS_URL = "https://mvp.rastcreative.com/crm/leads";

const SUBJECT_MAX = 200;
const FIELD_MAX = 300;
const NOTIFY_TIMEOUTS: SmtpTimeouts = { connectionTimeout: 4000, greetingTimeout: 4000, socketTimeout: 5000 };

type Env = Record<string, string | undefined>;

// ---------------------------------------------------------------------------
// Saf yardımcılar
// ---------------------------------------------------------------------------

/** Satır sonu / kontrol karakterlerini (CR, LF, NUL, U+0085, U+2028, U+2029…) boşluğa çevirir → başlık enjeksiyonu olmaz. */
export function cleanHeader(value: unknown, max = SUBJECT_MAX): string {
  const s = String(value ?? "")
    .replace(/[\u0000-\u001F\u007F\u0085\u2028\u2029]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return truncate(s, max);
}

/** Kod noktası güvenli kırpma: sınırı aşarsa son karakter "…" olur (toplam ≤ max). */
export function truncate(value: string, max: number): string {
  const chars = Array.from(value);
  return chars.length <= max ? value : `${chars.slice(0, max - 1).join("").trimEnd()}…`;
}

export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Tek satırlık alan: kontrol/satır sonu karakterleri atılır, uzunluk sınırlanır. */
const oneLine = (v: unknown) => cleanHeader(v, FIELD_MAX);

/** Çok satırlık mesaj: satır sonları korunur (\n), diğer kontrol karakterleri atılır, ≤1000 karakter. */
function messageText(v: unknown): string {
  const s = String(v ?? "")
    .replace(/\r\n?|\u2028|\u2029|\u0085/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return truncate(s, NOTIFY_MESSAGE_MAX);
}

const ADDRESS_RE = /^[^@\s<>"'(),;:\\[\]]{1,64}@[^@\s<>"'(),;:\\[\]]{1,255}\.[^@\s<>"'(),;:\\[\]]{2,}$/;

export interface ParsedRecipients {
  to: string[];
  /** Geçersiz sayılıp atlanan öğe sayısı (içerik loglanmaz). */
  invalid: number;
}

/** LEAD_NOTIFY_TO ayrıştırma: virgül / noktalı virgül / boşlukla ayrılmış çıplak adresler; tekrarlar ve geçersizler atılır. */
export function parseRecipients(raw: string | null | undefined): ParsedRecipients {
  const seen = new Set<string>();
  const to: string[] = [];
  let invalid = 0;
  for (const token of String(raw ?? "").split(/[\s,;]+/)) {
    if (!token) continue;
    if (!ADDRESS_RE.test(token)) {
      invalid++;
      continue;
    }
    const key = token.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (to.length < MAX_RECIPIENTS) to.push(token);
  }
  return { to, invalid };
}

export interface LeadNotifyConfig {
  to: string[];
  invalid: number;
  smtp: SmtpConfig;
}

/** LEAD_NOTIFY_TO (en az bir geçerli adres) ve SMTP_* birlikte tanımlıysa yapılandırma; aksi halde null (= no-op). */
export function leadNotifyConfig(env: Env): LeadNotifyConfig | null {
  const { to, invalid } = parseRecipients(env.LEAD_NOTIFY_TO);
  if (!to.length) return null;
  const smtp = smtpConfigFromEnv(env);
  return smtp ? { to, invalid, smtp } : null;
}

/** Rast OS lead listesi bağlantısı: APP_BASE_URL (http/https) varsa onun altında, yoksa üretim adresi. */
export function leadsUrlFromEnv(env: Env): string {
  const base = (env.APP_BASE_URL ?? "").trim();
  return /^https?:\/\/[^\s"'<>]+$/.test(base) ? `${base.replace(/\/+$/, "")}/crm/leads` : DEFAULT_LEADS_URL;
}

// ---------------------------------------------------------------------------
// İçerik
// ---------------------------------------------------------------------------

export interface LeadNotification {
  subject: string;
  text: string;
  html: string;
}

type NotifyLead = Pick<LeadIntake, "name" | "company" | "phone" | "email" | "project_type" | "message" | "kaynak" | "paket" | "utm">;

export function buildLeadNotification(lead: NotifyLead, opts: { duplicate?: boolean; leadsUrl?: string } = {}): LeadNotification {
  const duplicate = Boolean(opts.duplicate);
  const leadsUrl = opts.leadsUrl ?? DEFAULT_LEADS_URL;
  const name = oneLine(lead.name) || "(adsız)";
  const source = sourceLabelFor(lead.kaynak ?? null);

  // Konu: tüm CR/LF vb. temizlenmiş tek satır.
  const subject = cleanHeader(`${duplicate ? "Yeni lead (tekrar başvuru)" : "Yeni lead"}: ${name} (${source})`);

  const utm = Object.entries(lead.utm ?? {})
    .filter(([, v]) => v)
    .map(([k, v]) => `${oneLine(k)}=${oneLine(v)}`)
    .join(", ");

  // [etiket, değer, boşsa da göster]
  const rows: Array<[string, string, boolean]> = [
    ["Ad", name, true],
    ["Telefon", oneLine(lead.phone), true],
    ["E-posta", oneLine(lead.email), true],
    ["Şirket/Kurum", oneLine(lead.company), false],
    ["İlgi alanı", oneLine(lead.project_type), false],
    ["Paket", oneLine(lead.paket), false],
    ["Kaynak", source, true],
    ["UTM", utm, false],
  ];
  const shown = rows.filter(([, v, always]) => v || always).map(([k, v]) => [k, v || "—"] as const);
  const message = messageText(lead.message);

  const intro = duplicate
    ? "Mevcut bir lead'den tekrar başvuru geldi (yeni kayıt açılmadı; mevcut kayda not eklendi)."
    : "Web sitesinden yeni bir lead geldi.";

  const text = [
    intro,
    "",
    ...shown.map(([k, v]) => `${k}: ${v}`),
    ...(message ? ["", "Mesaj:", message] : []),
    "",
    `Rast OS: ${leadsUrl}`,
    "",
  ].join("\n");

  const cell = "padding:4px 12px 4px 0;vertical-align:top";
  const html = [
    '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#1a1a1a">',
    `<p style="margin:0 0 12px">${escapeHtml(intro)}</p>`,
    '<table style="border-collapse:collapse">',
    ...shown.map(([k, v]) => `<tr><td style="${cell};color:#666">${escapeHtml(k)}</td><td style="${cell}">${escapeHtml(v)}</td></tr>`),
    "</table>",
    ...(message
      ? [`<p style="margin:12px 0 4px;color:#666">Mesaj</p>`, `<p style="margin:0;white-space:pre-wrap">${escapeHtml(message)}</p>`]
      : []),
    `<p style="margin:16px 0 0"><a href="${escapeHtml(leadsUrl)}">Rast OS'ta aç</a></p>`,
    "</div>",
  ].join("\n");

  return { subject, text, html };
}

// ---------------------------------------------------------------------------
// Gönderim
// ---------------------------------------------------------------------------

export interface NotifyMail {
  from: string;
  to: string[];
  subject: string;
  text: string;
  html: string;
}

/** Gönderici: sinyal iptal edilince (zaman aşımı) bağlantıyı kapatmalıdır. Test için enjekte edilebilir. */
export type NotifySender = (mail: NotifyMail, smtp: SmtpConfig, signal: AbortSignal) => Promise<void>;

/** Varsayılan: ortak SMTP taşıyıcısı (src/lib/mailer.ts), kısa zaman aşımlarıyla. */
export const smtpNotifySender: NotifySender = async (mail, smtp, signal) => {
  const transport = await createSmtpTransport(smtp, NOTIFY_TIMEOUTS);
  const onAbort = () => transport.close();
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    const info = await transport.sendMail({ from: mail.from, to: mail.to, subject: mail.subject, text: mail.text, html: mail.html });
    if ((info.accepted ?? []).length === 0) throw new Error("REJECTED");
  } finally {
    signal.removeEventListener("abort", onAbort);
    transport.close();
  }
};

export type NotifyResult = "skipped" | "sent" | "failed";

/** Hata türünü (kişisel veri / SMTP ayrıntısı içermeyen) kısa bir etikete çevirir. */
function errorLabel(e: unknown): string {
  const err = e as { code?: unknown; responseCode?: unknown; name?: unknown; message?: unknown } | null;
  if (typeof err?.code === "string") return err.code;
  if (typeof err?.responseCode === "number") return `SMTP ${err.responseCode}`;
  if (err?.message === "TIMEOUT" || err?.message === "REJECTED") return String(err.message);
  return typeof err?.name === "string" ? err.name : "bilinmiyor";
}

/**
 * Bildirimi gönderir. ASLA fırlatmaz; env yoksa sessizce "skipped" döner. Hata/zaman aşımında yalnızca kısa
 * bir console.error yazar (ad, telefon, e-posta, mesaj gibi kişisel veri loglanmaz).
 */
export async function sendLeadNotification(
  lead: NotifyLead,
  opts: { duplicate?: boolean; env?: Env; send?: NotifySender; timeoutMs?: number } = {},
): Promise<NotifyResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const ac = new AbortController();
  try {
    const env = opts.env ?? process.env;
    const cfg = leadNotifyConfig(env);
    if (!cfg) return "skipped";
    if (cfg.invalid > 0) console.error(`[leads] LEAD_NOTIFY_TO içinde ${cfg.invalid} geçersiz adres atlandı.`);

    const { subject, text, html } = buildLeadNotification(lead, { duplicate: opts.duplicate, leadsUrl: leadsUrlFromEnv(env) });
    const mail: NotifyMail = { from: cleanHeader(cfg.smtp.from, FIELD_MAX), to: cfg.to, subject, text, html };

    const timeoutMs = Math.min(opts.timeoutMs ?? LEAD_NOTIFY_TIMEOUT_MS, LEAD_NOTIFY_TIMEOUT_MS);
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        ac.abort();
        reject(new Error("TIMEOUT"));
      }, timeoutMs);
    });
    const sending = (opts.send ?? smtpNotifySender)(mail, cfg.smtp, ac.signal);
    sending.catch(() => undefined); // zaman aşımından sonra gelen reddedilme işlenmemiş kalmasın
    await Promise.race([sending, timeout]);
    return "sent";
  } catch (e) {
    console.error("[leads] bildirim gönderilemedi:", errorLabel(e));
    return "failed";
  } finally {
    if (timer) clearTimeout(timer);
  }
}
