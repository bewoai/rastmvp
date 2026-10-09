// Müşteri Bulma — e-posta gönderici. YALNIZCA SUNUCU.
//   Mailer arayüzü · SmtpMailer (nodemailer; SMTP_HOST/PORT/USER/PASS/FROM) · NoopMailer (SMTP yokken)
//   buildOutgoingEmail: gönderen kimliği + iletişim nedeni (B2B) + ret bağlantısı altbilgisi, List-Unsubscribe
// E-POSTA GÖNDERİMİ VARSAYILAN KAPALI: cron route'u OUTREACH_EMAIL_ENABLED=true olmadan hiçbir Mailer çağırmaz.
// Not: nodemailer yalnızca SmtpMailer.send içinde (ortak src/lib/mailer.ts üzerinden) dinamik yüklenir; testler ağsız çalışır (type-stripping).
import { createSmtpTransport, smtpConfigFromEnv } from "../mailer.ts";
import type { SmtpConfig } from "../mailer.ts";

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

// SMTP yapılandırması ve taşıyıcı (transport) ortak modülde (src/lib/mailer.ts); burada geriye uyumlu yeniden dışa aktarım.
export { smtpConfigFromEnv };
export type { SmtpConfig };

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
    const transport = await createSmtpTransport(this.cfg);
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
