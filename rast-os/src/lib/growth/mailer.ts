// Müşteri Bulma — e-posta gönderici. YALNIZCA SUNUCU.
//   Mailer arayüzü · SmtpMailer (nodemailer; SMTP_HOST/PORT/USER/PASS/FROM) · NoopMailer (SMTP yokken)
//   buildOutgoingEmail: gönderen kimliği + iletişim nedeni (B2B) + ret bağlantısı altbilgisi, List-Unsubscribe
// E-POSTA GÖNDERİMİ VARSAYILAN KAPALI: cron route'u OUTREACH_EMAIL_ENABLED=true olmadan hiçbir Mailer çağırmaz.
// Not: nodemailer yalnızca SmtpMailer.send içinde dinamik yüklenir; testler ağsız çalışır (type-stripping).

export interface OutgoingEmail {
  from: string;
  to: string;
  subject: string;
  text: string;
  headers: Record<string, string>;
}

export type SendResult =
  | { ok: true; messageId: string }
  /** permanent: kalıcı hata (adres yok vb.) → bounced + ret listesi; değilse 1 saat sonra tekrar. */
  | { ok: false; error: string; permanent: boolean };

export interface Mailer {
  readonly kind: "smtp" | "noop";
  send(mail: OutgoingEmail): Promise<SendResult>;
}

export const SENDER_IDENTITY = "Rast Creative Studio · Serdivan / Sakarya";

export interface ComposeInput {
  to: string;
  subject: string;
  /** Belirteçleri doldurulmuş gövde. */
  body: string;
  unsubscribeUrl: string;
  from: string;
  /** Ret için mailto adresi (genelde gönderen adres). */
  unsubscribeMailto?: string | null;
}

const clean = (s: string) => s.replace(/[\r\n]+/g, " ").trim();

/**
 * Altbilgi: gönderen kimliği, iletişim nedeni (B2B, herkese açık kurumsal iletişim bilgisi) ve tek tıkla ret.
 * Başlıklar: List-Unsubscribe (https + isteğe bağlı mailto) ve List-Unsubscribe-Post (RFC 8058 tek tık).
 */
export function buildOutgoingEmail(input: ComposeInput): OutgoingEmail {
  const footer = [
    "",
    "—",
    SENDER_IDENTITY,
    "Bu e-postayı, işletmenizin herkese açık kurumsal iletişim bilgileri üzerinden, kurumsal (B2B) bir iş birliği önerisi için gönderdik.",
    `Bir daha e-posta almak istemiyorsanız tek tıkla listeden çıkın: ${input.unsubscribeUrl}`,
  ].join("\n");
  const list = [`<${input.unsubscribeUrl}>`];
  if (input.unsubscribeMailto) list.push(`<mailto:${input.unsubscribeMailto}?subject=${encodeURIComponent("Listeden çıkar")}>`);
  return {
    from: input.from,
    to: clean(input.to),
    subject: clean(input.subject).slice(0, 300),
    text: `${input.body.trimEnd()}\n${footer}\n`,
    headers: {
      "List-Unsubscribe": list.join(", "),
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  };
}

/** SMTP yapılandırılmamışken: hiçbir şey göndermez, başarısız döner (cron zaten çağırmaz). */
export class NoopMailer implements Mailer {
  readonly kind = "noop" as const;
  readonly outbox: OutgoingEmail[] = [];
  async send(mail: OutgoingEmail): Promise<SendResult> {
    this.outbox.push(mail);
    return { ok: false, error: "SMTP yapılandırılmamış (NoopMailer)", permanent: false };
  }
}

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

/** "Ad <adres>" ya da "adres" → adres. */
export function addressOf(from: string): string | null {
  const m = from.match(/<([^>]+)>/);
  const a = (m ? m[1] : from).trim();
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(a) ? a : null;
}

export class SmtpMailer implements Mailer {
  readonly kind = "smtp" as const;
  private cfg: SmtpConfig;
  constructor(cfg: SmtpConfig) {
    this.cfg = cfg;
  }
  async send(mail: OutgoingEmail): Promise<SendResult> {
    const nodemailer = await import("nodemailer");
    const transport = nodemailer.createTransport({
      host: this.cfg.host,
      port: this.cfg.port,
      secure: this.cfg.port === 465,
      auth: { user: this.cfg.user, pass: this.cfg.pass },
      connectionTimeout: 10_000,
      socketTimeout: 20_000,
    });
    try {
      const info = await transport.sendMail({ from: mail.from, to: mail.to, subject: mail.subject, text: mail.text, headers: mail.headers });
      const rejected = (info.rejected ?? []).length > 0;
      if (rejected) return { ok: false, error: "Alıcı reddedildi", permanent: true };
      return { ok: true, messageId: String(info.messageId ?? "") };
    } catch (e) {
      const err = e as { responseCode?: number; message?: string };
      const code = Number(err.responseCode ?? 0);
      // 5xx SMTP yanıtı = kalıcı (adres yok vb.); diğerleri geçici. Mesaj loglanmaz (kişisel veri olabilir).
      return { ok: false, error: code ? `SMTP ${code}` : "SMTP bağlantı hatası", permanent: code >= 500 && code < 600 };
    } finally {
      transport.close();
    }
  }
}

export function createMailerFromEnv(env: Record<string, string | undefined>): Mailer {
  const cfg = smtpConfigFromEnv(env);
  return cfg ? new SmtpMailer(cfg) : new NoopMailer();
}
