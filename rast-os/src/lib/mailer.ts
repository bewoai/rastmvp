// Ortak SMTP altyapısı. YALNIZCA SUNUCU.
//   smtpConfigFromEnv: SMTP_HOST/PORT/USER/PASS/FROM → yapılandırma (eksikse null)
//   createSmtpTransport: nodemailer taşıyıcısı (nodemailer dinamik yüklenir; testler ağsız çalışır)
// Kullananlar: Müşteri Bulma (src/lib/growth/mailer.ts — ticari/outreach gönderimi, OUTREACH_EMAIL_ENABLED ile korunur)
// ve iç lead bildirimi (src/lib/lead-notify.ts — ekibin kendi kutusuna, bu bayraktan bağımsız).
// Not: yalnızca `import type` + dinamik import kullanın (Node type-stripping ile doğrudan test edilir).
import type { Transporter } from "nodemailer";

export interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
}

export function smtpConfigFromEnv(env: Record<string, string | undefined>): SmtpConfig | null {
  const host = (env.SMTP_HOST ?? "").trim();
  const user = (env.SMTP_USER ?? "").trim();
  const pass = env.SMTP_PASS ?? "";
  const from = (env.SMTP_FROM ?? "").trim();
  const port = Number(env.SMTP_PORT ?? 587);
  if (!host || !user || !pass || !from || !Number.isInteger(port) || port <= 0 || port > 65535) return null;
  return { host, port, user, pass, from };
}

export interface SmtpTimeouts {
  /** TCP bağlantısı (ms). */
  connectionTimeout: number;
  /** Sunucu karşılama (greeting) bekleme süresi (ms). */
  greetingTimeout: number;
  /** Soket hareketsizlik süresi (ms). */
  socketTimeout: number;
}

/** Müşteri Bulma'nın mevcut değerleri (greetingTimeout = nodemailer varsayılanı; davranış değişmez). */
export const DEFAULT_SMTP_TIMEOUTS: SmtpTimeouts = { connectionTimeout: 10_000, greetingTimeout: 30_000, socketTimeout: 20_000 };

/** 465 → örtük TLS (SSL); diğer portlar (587) → STARTTLS. */
export async function createSmtpTransport(cfg: SmtpConfig, timeouts: SmtpTimeouts = DEFAULT_SMTP_TIMEOUTS): Promise<Transporter> {
  const nodemailer = await import("nodemailer");
  return nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.port === 465,
    auth: { user: cfg.user, pass: cfg.pass },
    connectionTimeout: timeouts.connectionTimeout,
    greetingTimeout: timeouts.greetingTimeout,
    socketTimeout: timeouts.socketTimeout,
  });
}
