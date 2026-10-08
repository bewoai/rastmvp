// Müşteri Bulma — saf (React'siz, sunucu/istemci güvenli) mantık:
//   sektör + puanlama · şablon belirteçleri · e-posta adım planlama · günlük limit · ret listesi eşleşmesi ·
//   e-posta bayrağı (OUTREACH_EMAIL_ENABLED) · günlük temas listesi (Bugün) · manuel temas kaydı · seri ·
//   WhatsApp / Instagram / tel bağlantıları · CSV (hedef klinik listesi) · CRM lead taslağı
// Testler: scripts/growth-logic.test.mjs
// Not: Node'un type-stripping'i ile doğrudan test edilir; burada yalnızca `import type` kullanın.
import type {
  FieldSource, OutreachChannel, OutreachMessage, OutreachSequence, Prospect, ProspectStatus,
  SequenceStep, SuppressionEntry,
} from "../types";
import { SECTORS, fold, scoreProspect, sectorKeyOf } from "./score.ts";
import type { SectorKey } from "./score.ts";

export * from "./score.ts";

// ---------------------------------------------------------------------------
// Zaman (Europe/Istanbul = UTC+3, 2016'dan beri yaz saati yok)
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;
const TR_OFFSET_MS = 3 * 3_600_000;

/** Verilen anın İstanbul takvim günü (YYYY-MM-DD). */
export function istanbulDay(at: Date | string | number): string {
  const ms = typeof at === "number" ? at : new Date(at).getTime();
  return new Date(ms + TR_OFFSET_MS).toISOString().slice(0, 10);
}

/** YYYY-MM-DD + n gün (takvim). */
export function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

/** İstanbul günü + saat → UTC ISO. */
function istanbulAt(day: string, hour: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + hour * 3_600_000 - TR_OFFSET_MS).toISOString();
}

// ---------------------------------------------------------------------------
// Şablon belirteçleri
// ---------------------------------------------------------------------------

export const TEMPLATE_TOKENS = ["isim", "sektor", "sehir", "site", "rast_vaka_link"] as const;
export type TemplateToken = (typeof TEMPLATE_TOKENS)[number];

/** Vaka / örnek çalışma bağlantıları (sahip doğrulamalı — vaka sayfaları hazır olunca güncellenir). */
export const CASE_LINKS: Record<SectorKey, string> = {
  hekim: "https://rastcreative.com",
  mobilya: "https://rastcreative.com",
  insaat: "https://rastcreative.com",
  diger: "https://rastcreative.com",
};

export type TemplateContext = Partial<Record<TemplateToken, string | null | undefined>>;

const FALLBACK: Record<TemplateToken, string> = {
  isim: "",
  sektor: "sektörünüz",
  sehir: "bölgeniz",
  site: "web siteniz",
  rast_vaka_link: CASE_LINKS.diger,
};

export interface RenderResult {
  text: string;
  /** Değeri olmayan (yedek metinle doldurulan) belirteçler. */
  missing: TemplateToken[];
  /** Tanınmayan belirteçler (olduğu gibi bırakılır). */
  unknown: string[];
}

/** `{{belirtec}}` doldurur; boşlukları ve "Merhaba ," gibi artıkları toparlar. */
export function renderTemplate(tpl: string, ctx: TemplateContext): RenderResult {
  const missing = new Set<TemplateToken>();
  const unknown = new Set<string>();
  const text = tpl.replace(/\{\{\s*([a-zA-Z_]+)\s*\}\}/g, (whole, rawKey: string) => {
    const key = rawKey.toLowerCase() as TemplateToken;
    if (!(TEMPLATE_TOKENS as readonly string[]).includes(key)) {
      unknown.add(rawKey);
      return whole;
    }
    const v = (ctx[key] ?? "").toString().trim();
    if (v) return v;
    missing.add(key);
    return FALLBACK[key];
  });
  const tidy = text
    .split("\n")
    .map((line) => line.replace(/[ \t]{2,}/g, " ").replace(/ ([,.!?;:])/g, "$1").replace(/[ \t]+$/g, ""))
    .join("\n");
  return { text: tidy, missing: [...missing], unknown: [...unknown] };
}

/** Bir aday görünümünden şablon bağlamı. */
export function templateContext(v: { name?: string | null; sector?: string | null; city?: string | null; district?: string | null; website?: string | null }): TemplateContext {
  const sk = sectorKeyOf(v.sector);
  return {
    isim: v.name ?? "",
    sektor: v.sector ? v.sector.toLocaleLowerCase("tr") : "",
    sehir: [v.district, v.city].filter(Boolean).join(" / "),
    site: v.website ? v.website.replace(/^https?:\/\//i, "").replace(/\/$/, "") : "",
    rast_vaka_link: CASE_LINKS[sk],
  };
}

// ---------------------------------------------------------------------------
// Varsayılan e-posta dizileri (3 sektör) ve manuel kanal metinleri
// ---------------------------------------------------------------------------

const SIGN = "Rast Creative Studio";

export const DEFAULT_SEQUENCES: { sector: Exclude<SectorKey, "diger">; name: string; steps: SequenceStep[] }[] = [
  {
    sector: "hekim",
    name: "Hekim / klinik — bilgilendirme içeriği",
    steps: [
      {
        day: 0,
        subject: "{{isim}} için hasta bilgilendirme içeriği",
        body:
          "Merhaba {{isim}},\n\nSağlıkta reklam yasağı varken hasta güveni, doğru ve anlaşılır bilgilendirme içeriğiyle kazanılıyor. " +
          "Rast Creative olarak {{sehir}} bölgesindeki hekim ve kliniklerle Sağlık Hizmetlerinde Tanıtım Yönetmeliği'ne uygun " +
          "bilgilendirme videoları hazırlıyoruz; her içerik yayından önce hekim onayından geçiyor.\n\n" +
          "{{site}} üzerindeki konuları, hastaların en sık sorduğu sorulara yanıt veren kısa videolara dönüştürebiliriz. " +
          "Örnek çalışma: {{rast_vaka_link}}\n\nUygunsanız 15 dakikalık bir görüşmede nasıl çalıştığımızı anlatmak isterim.\n\nSelamlar,\n" + SIGN,
      },
      {
        day: 4,
        subject: "Kısa hatırlatma: bilgilendirme içerikleri",
        body:
          "Merhaba {{isim}},\n\nGeçen hafta yazdığım öneriyi hatırlatmak istedim. Reklam ya da kampanya değil; hastaların doğru bilgiye " +
          "ulaşmasını sağlayan, hekim onaylı içerikler. Örnek: {{rast_vaka_link}}\n\nİlgilenmiyorsanız kısaca belirtmeniz yeterli, tekrar yazmam.\n\nSelamlar,\n" + SIGN,
      },
      {
        day: 10,
        subject: "Son not",
        body:
          "Merhaba {{isim}},\n\nBu konuda son kez yazıyorum. İleride hasta bilgilendirme içeriği ya da mevzuata uygun video üretimi " +
          "gündeminize gelirse rastcreative.com üzerinden bize ulaşabilirsiniz.\n\nKolaylıklar dilerim,\n" + SIGN,
      },
    ],
  },
  {
    sector: "mobilya",
    name: "Mobilya / perakende — ürün ve mağaza videoları",
    steps: [
      {
        day: 0,
        subject: "{{isim}} için ürün videosu fikri",
        body:
          "Merhaba {{isim}},\n\nRast Creative olarak {{sehir}} bölgesindeki mobilya ve perakende markalarına ürün çekimi, kısa video " +
          "ve sosyal medya içeriği üretiyoruz. {{site}} üzerindeki ürünlerinizi ve mağaza deneyiminizi kısa videolarla anlatabiliriz. " +
          "Benzer bir çalışma: {{rast_vaka_link}}\n\nUygunsanız 15 dakikalık bir görüşme ayarlayalım mı?\n\nSelamlar,\n" + SIGN,
      },
      {
        day: 4,
        subject: "Kısa hatırlatma: ürün videoları",
        body:
          "Merhaba {{isim}},\n\nÜrün ve mağaza videoları önerimi hatırlatmak istedim. Tek bir çekim gününde bir aylık içerik " +
          "çıkarabiliyoruz. Örnek: {{rast_vaka_link}}\n\nİlgilenmiyorsanız kısaca belirtmeniz yeterli.\n\nSelamlar,\n" + SIGN,
      },
      {
        day: 10,
        subject: "Son not",
        body:
          "Merhaba {{isim}},\n\nBu konuda son kez yazıyorum. Yeni sezon ya da kampanya döneminde içerik ihtiyacınız olursa " +
          "rastcreative.com üzerinden bize ulaşabilirsiniz.\n\nKolaylıklar dilerim,\n" + SIGN,
      },
    ],
  },
  {
    sector: "insaat",
    name: "İnşaat / emlak — proje tanıtım videoları",
    steps: [
      {
        day: 0,
        subject: "{{isim}} projeleri için tanıtım videosu",
        body:
          "Merhaba {{isim}},\n\nRast Creative olarak {{sehir}} bölgesindeki inşaat ve emlak firmalarına proje tanıtım videosu, " +
          "drone çekimi ve satış ofisi içerikleri hazırlıyoruz. {{site}} üzerindeki projelerinizi alıcıya daha net anlatan kısa " +
          "videolar üretebiliriz. Örnek çalışma: {{rast_vaka_link}}\n\nUygunsanız 15 dakikalık bir görüşme ayarlayalım mı?\n\nSelamlar,\n" + SIGN,
      },
      {
        day: 4,
        subject: "Kısa hatırlatma: proje videoları",
        body:
          "Merhaba {{isim}},\n\nProje tanıtım videosu önerimi hatırlatmak istedim. Şantiye ilerleme ve teslim videoları da " +
          "hazırlıyoruz. Örnek: {{rast_vaka_link}}\n\nİlgilenmiyorsanız kısaca belirtmeniz yeterli.\n\nSelamlar,\n" + SIGN,
      },
      {
        day: 10,
        subject: "Son not",
        body:
          "Merhaba {{isim}},\n\nBu konuda son kez yazıyorum. Yeni bir proje lansmanında içerik ihtiyacınız olursa " +
          "rastcreative.com üzerinden bize ulaşabilirsiniz.\n\nKolaylıklar dilerim,\n" + SIGN,
      },
    ],
  },
];

/** Manuel kanallar için sektöre özel metinler (WhatsApp, Instagram DM, 20 saniyelik telefon konuşması). */
export const MANUAL_SCRIPTS: Record<SectorKey, { whatsapp: string; instagram: string; phone: string }> = {
  hekim: {
    whatsapp:
      "Merhaba {{isim}}, ben Rast Creative Studio'dan (Serdivan) yazıyorum. Hekimler için mevzuata uygun, hekim onaylı " +
      "hasta bilgilendirme videoları hazırlıyoruz; reklam değil, bilgilendirme. Kısa bir örnek göndermemi ister misiniz? " +
      "İstemezseniz yazmanız yeterli, tekrar rahatsız etmem.",
    instagram:
      "Merhaba {{isim}}, Rast Creative Studio'dan yazıyorum. Hesabınızı inceledik; hastaların sık sorduğu konuları mevzuata " +
      "uygun, hekim onaylı kısa bilgilendirme videolarına dönüştürüyoruz. Bir örnek paylaşmamı ister misiniz?",
    phone:
      "Merhaba, ben Rast Creative Studio'dan arıyorum, {{isim}} ile mi görüşüyorum? 20 saniyenizi alacağım: Serdivan'da " +
      "hekimler için hasta bilgilendirme videoları hazırlıyoruz; reklam yasağına uygun, her içerik yayından önce hekim onayından " +
      "geçiyor. Size kısa bir örnek gönderebilir miyim — WhatsApp mı e-posta mı daha uygun?",
  },
  mobilya: {
    whatsapp:
      "Merhaba {{isim}}, ben Rast Creative Studio'dan (Serdivan) yazıyorum. Mobilya ve perakende markalarına ürün ve mağaza " +
      "videoları çekiyoruz. Kısa bir örnek göndermemi ister misiniz? İstemezseniz yazmanız yeterli.",
    instagram:
      "Merhaba {{isim}}, Rast Creative Studio'dan yazıyorum. Ürünlerinizi kısa video ve reels içerikleriyle anlatmak üzerine " +
      "bir fikrimiz var. Bir örnek paylaşmamı ister misiniz?",
    phone:
      "Merhaba, ben Rast Creative Studio'dan arıyorum, {{isim}} ile mi görüşüyorum? 20 saniyenizi alacağım: Serdivan'da " +
      "mobilya ve perakende markaları için ürün çekimi ve kısa video üretiyoruz; tek çekim gününde bir aylık içerik çıkarıyoruz. " +
      "Size kısa bir örnek gönderebilir miyim — WhatsApp mı e-posta mı uygun?",
  },
  insaat: {
    whatsapp:
      "Merhaba {{isim}}, ben Rast Creative Studio'dan (Serdivan) yazıyorum. İnşaat ve emlak projeleri için tanıtım videosu " +
      "ve drone çekimi yapıyoruz. Kısa bir örnek göndermemi ister misiniz? İstemezseniz yazmanız yeterli.",
    instagram:
      "Merhaba {{isim}}, Rast Creative Studio'dan yazıyorum. Projelerinizi alıcıya daha net anlatan kısa tanıtım videoları " +
      "üretiyoruz. Bir örnek paylaşmamı ister misiniz?",
    phone:
      "Merhaba, ben Rast Creative Studio'dan arıyorum, {{isim}} ile mi görüşüyorum? 20 saniyenizi alacağım: Serdivan'da " +
      "inşaat ve emlak firmaları için proje tanıtım videosu ve drone çekimi yapıyoruz. Size kısa bir örnek gönderebilir miyim — " +
      "WhatsApp mı e-posta mı uygun?",
  },
  diger: {
    whatsapp:
      "Merhaba {{isim}}, ben Rast Creative Studio'dan (Serdivan) yazıyorum. İşletmeler için kısa video ve sosyal medya içeriği " +
      "üretiyoruz. Kısa bir örnek göndermemi ister misiniz? İstemezseniz yazmanız yeterli.",
    instagram:
      "Merhaba {{isim}}, Rast Creative Studio'dan yazıyorum. İşletmenizi kısa videolarla anlatmak üzerine bir fikrimiz var. " +
      "Bir örnek paylaşmamı ister misiniz?",
    phone:
      "Merhaba, ben Rast Creative Studio'dan arıyorum, {{isim}} ile mi görüşüyorum? 20 saniyenizi alacağım: Serdivan'da " +
      "işletmeler için kısa video ve sosyal medya içeriği üretiyoruz. Size kısa bir örnek gönderebilir miyim?",
  },
};

export function manualScript(sector: string | null | undefined, kind: "whatsapp" | "instagram" | "phone", ctx: TemplateContext): string {
  return renderTemplate(MANUAL_SCRIPTS[sectorKeyOf(sector)][kind], ctx).text;
}

// ---------------------------------------------------------------------------
// E-posta bayrağı ve günlük limit
// ---------------------------------------------------------------------------

type Env = Record<string, string | undefined>;

/** OUTREACH_EMAIL_ENABLED yalnızca "true" / "1" ise açık (varsayılan KAPALI — İYS kaydı bekleniyor). */
export function emailSendingEnabled(env: Env): boolean {
  const v = (env.OUTREACH_EMAIL_ENABLED ?? "").trim().toLowerCase();
  return v === "true" || v === "1";
}

/**
 * Cron'un e-posta kararı (route bunu uygular): bayrak kapalıysa "disabled" → hiçbir RPC çağrılmaz, hiçbir şey
 * gönderilmez; SMTP yoksa "no-smtp"; pencere dışıysa "outside-window"; aksi halde "send".
 */
export function cronEmailDecision(opts: { env: Env; mailerKind: "smtp" | "noop"; now: Date | number }): "disabled" | "no-smtp" | "outside-window" | "send" {
  if (!emailSendingEnabled(opts.env)) return "disabled";
  if (opts.mailerKind !== "smtp") return "no-smtp";
  if (!isWithinSendWindow(opts.now)) return "outside-window";
  return "send";
}

export const DEFAULT_DAILY_CAP = 20;
export const MAX_DAILY_CAP = 200;

/** DAILY_SEND_CAP: tam sayı, 0..200; geçersizse 20. */
export function parseDailyCap(raw: string | undefined | null): number {
  if (raw === undefined || raw === null || raw.trim() === "") return DEFAULT_DAILY_CAP;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) return DEFAULT_DAILY_CAP;
  return Math.min(n, MAX_DAILY_CAP);
}

export function remainingCap(cap: number, sentToday: number): number {
  return Math.max(0, cap - Math.max(0, sentToday));
}

/** Bugün (İstanbul) gönderilmiş e-posta sayısı (manuel temaslar sayılmaz). */
export function emailsSentToday(messages: ReadonlyArray<Pick<OutreachMessage, "channel" | "manual" | "sent_at">>, now: Date | number): number {
  const today = istanbulDay(now);
  return messages.filter((m) => m.channel === "email" && !m.manual && m.sent_at && istanbulDay(m.sent_at) === today).length;
}

// ---------------------------------------------------------------------------
// Gönderim penceresi ve adım planlama
// ---------------------------------------------------------------------------

/** Hafta içi 09:00–18:00 (İstanbul). */
export function isWithinSendWindow(now: Date | number): boolean {
  const local = new Date((typeof now === "number" ? now : now.getTime()) + TR_OFFSET_MS);
  const dow = local.getUTCDay();
  const h = local.getUTCHours();
  return dow >= 1 && dow <= 5 && h >= 9 && h < 18;
}

/** Gönderim penceresinin başlangıcı (İstanbul saati). Günlük cron (vercel.json `0 6 * * *` = 09:00 İstanbul)
 *  bu saatte çalışır; planlanan her an bu saate hizalanır ki o günün tek çalışması onu "vadesi gelmiş" görsün. */
export const SEND_WINDOW_START_HOUR = 9;

/** Verilen anı ilk uygun gönderim anına taşır (pencere içindeyse aynen; değilse sonraki iş günü 09:00). */
export function nextSendSlot(at: Date | number | string): string {
  const ms = new Date(at).getTime();
  if (isWithinSendWindow(ms)) return new Date(ms).toISOString();
  let day = istanbulDay(ms);
  const local = new Date(ms + TR_OFFSET_MS);
  if (local.getUTCHours() >= 9) day = addDays(day, 1); // bugünün penceresi kaçtı
  for (let i = 0; i < 7; i++) {
    const dow = new Date(`${day}T00:00:00Z`).getUTCDay();
    if (dow >= 1 && dow <= 5) return istanbulAt(day, SEND_WINDOW_START_HOUR);
    day = addDays(day, 1);
  }
  return istanbulAt(day, SEND_WINDOW_START_HOUR);
}

/**
 * Gönderilen adımdan sonraki adımın TASLAĞI (onaysız). Şablon olarak döner (belirteçler doldurulmaz;
 * Places adayının adı DB'ye kopyalanmaz). Plan: gönderim + (sonraki.day − mevcut.day) gün; o günün 09:00'ına
 * (İstanbul) hizalanır ve gönderim penceresine taşınır. Gün hassasiyeti bilinçli: cron günde BİR kez (09:00–09:59
 * İstanbul) çalışır; saat hizalanmasaydı ör. 09:40'ta gönderilen adımın takibi, hedef günün çalışması 09:10'da
 * olursa bir gün kayardı.
 */
export function nextStepDraft(
  steps: ReadonlyArray<SequenceStep> | null | undefined,
  currentStepNo: number,
  sentAt: string | Date,
): { step_no: number; subject: string; body: string; scheduled_for: string } | null {
  if (!steps || currentStepNo < 1 || currentStepNo >= steps.length) return null;
  const cur = steps[currentStepNo - 1];
  const next = steps[currentStepNo];
  if (!cur || !next) return null;
  const delta = Math.max(1, Math.round((Number(next.day) || 0) - (Number(cur.day) || 0)));
  const dueDay = istanbulDay(new Date(sentAt).getTime() + delta * DAY_MS);
  return { step_no: currentStepNo + 1, subject: next.subject, body: next.body, scheduled_for: nextSendSlot(istanbulAt(dueDay, SEND_WINDOW_START_HOUR)) };
}

/**
 * Onay yaması. Bayrak KAPALIYKEN yalnızca 'approved' işaretlenir, `scheduled_for` boş kalır (cron almaz).
 * Açıkken: planlanmış gelecek bir an varsa korunur, yoksa ilk uygun gönderim anı.
 */
export function approvalPatch(
  msg: Pick<OutreachMessage, "scheduled_for">,
  opts: { emailEnabled: boolean; now: Date | number },
): { status: "approved"; scheduled_for: string | null } {
  if (!opts.emailEnabled) return { status: "approved", scheduled_for: null };
  const nowMs = new Date(opts.now).getTime();
  const planned = msg.scheduled_for ? Date.parse(msg.scheduled_for) : NaN;
  return { status: "approved", scheduled_for: Number.isFinite(planned) && planned > nowMs ? new Date(planned).toISOString() : nextSendSlot(nowMs) };
}

export type SkipReason = "disabled" | "not_due" | "unscheduled" | "no_recipient" | "suppressed" | "prospect_closed" | "cap" | "not_email";

/**
 * Cron'un gönderecekleri (SQL outreach_cron_claim ile aynı kurallar; route ikinci kez süzer).
 * Bayrak kapalıysa hiçbir şey gönderilmez.
 */
export function planSendBatch(
  messages: ReadonlyArray<Pick<OutreachMessage, "id" | "status" | "channel" | "manual" | "scheduled_for" | "to_email" | "created_at" | "prospect_id">>,
  opts: {
    now: Date | number;
    cap: number;
    sentToday: number;
    emailEnabled: boolean;
    suppression: ReadonlyArray<Pick<SuppressionEntry, "kind" | "value">>;
    closedProspectIds?: ReadonlySet<string>;
  },
): { send: string[]; skipped: { id: string; reason: SkipReason }[] } {
  const skipped: { id: string; reason: SkipReason }[] = [];
  const approved = messages.filter((m) => m.status === "approved");
  if (!opts.emailEnabled) return { send: [], skipped: approved.map((m) => ({ id: m.id, reason: "disabled" as const })) };
  const nowMs = new Date(opts.now).getTime();
  const due: typeof approved = [];
  for (const m of approved) {
    if (m.channel !== "email" || m.manual) skipped.push({ id: m.id, reason: "not_email" });
    else if (!m.scheduled_for) skipped.push({ id: m.id, reason: "unscheduled" });
    else if (Date.parse(m.scheduled_for) > nowMs) skipped.push({ id: m.id, reason: "not_due" });
    else if (!m.to_email) skipped.push({ id: m.id, reason: "no_recipient" });
    else if (isSuppressed(opts.suppression, { email: m.to_email })) skipped.push({ id: m.id, reason: "suppressed" });
    else if (opts.closedProspectIds?.has(m.prospect_id)) skipped.push({ id: m.id, reason: "prospect_closed" });
    else due.push(m);
  }
  due.sort((a, b) => Date.parse(a.scheduled_for!) - Date.parse(b.scheduled_for!) || a.created_at.localeCompare(b.created_at));
  const room = remainingCap(opts.cap, opts.sentToday);
  for (const m of due.slice(room)) skipped.push({ id: m.id, reason: "cap" });
  return { send: due.slice(0, room).map((m) => m.id), skipped };
}

// ---------------------------------------------------------------------------
// Ret listesi
// ---------------------------------------------------------------------------

/** Telefon anahtarı: son 10 hane (lead_phone_key / lead-logic phoneKey ile aynı kural). */
export function phoneKey(value: unknown): string | null {
  const digits = String(value ?? "").slice(0, 40).replace(/\D/g, "");
  if (digits.length >= 10) return digits.slice(-10);
  return digits.length >= 7 ? digits : null;
}

export function normalizeEmail(value: unknown): string | null {
  const s = String(value ?? "").trim().toLowerCase().slice(0, 160);
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s) ? s : null;
}

/** E-posta tam, alan adı (alt alan adları dahil) veya telefon anahtarı (SQL outreach_is_suppressed ile aynı). */
export function isSuppressed(
  entries: ReadonlyArray<Pick<SuppressionEntry, "kind" | "value">>,
  who: { email?: string | null; phone?: string | null },
): boolean {
  const email = normalizeEmail(who.email);
  const dom = email ? email.split("@")[1] : null;
  const ph = phoneKey(who.phone);
  return entries.some((e) =>
    (e.kind === "email" && email !== null && e.value === email) ||
    (e.kind === "domain" && dom !== null && (dom === e.value || dom.endsWith(`.${e.value}`))) ||
    (e.kind === "phone" && ph !== null && e.value === ph),
  );
}

/** Ret listesi girdisi doğrulama/normalize (DB check kısıtıyla aynı). */
export function suppressionValue(kind: SuppressionEntry["kind"], raw: string): string | null {
  const v = raw.trim().toLowerCase();
  if (kind === "email") return normalizeEmail(v);
  if (kind === "domain") {
    const d = v.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/^.*@/, "").split("/")[0];
    return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(d) ? d : null;
  }
  const k = phoneKey(v);
  return k && /^[0-9]{7,10}$/.test(k) ? k : null;
}

// ---------------------------------------------------------------------------
// Günlük temas listesi (Bugün)
// ---------------------------------------------------------------------------

export const DAILY_LIST_SIZE = 10;
export const CONTACT_COOLDOWN_DAYS = 14;
export const SNOOZE_DAYS = 7;
const DAILY_STATUSES: ReadonlySet<ProspectStatus> = new Set(["qualified", "queued", "contacted"]);

type ContactMsg = Pick<OutreachMessage, "prospect_id" | "channel" | "manual" | "status" | "sent_at">;

const isContact = (m: ContactMsg) => Boolean(m.sent_at) && (m.status === "sent" || m.status === "replied");

/** Aday başına son temas anı (ms) — mesajlardan ve prospect.last_contacted_at'ten. */
export function lastContactByProspect(
  prospects: ReadonlyArray<Pick<Prospect, "id" | "last_contacted_at">>,
  messages: ReadonlyArray<ContactMsg>,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const p of prospects) {
    const t = p.last_contacted_at ? Date.parse(p.last_contacted_at) : NaN;
    if (Number.isFinite(t)) out.set(p.id, t);
  }
  for (const m of messages) {
    if (!isContact(m)) continue;
    const t = Date.parse(m.sent_at!);
    if (Number.isFinite(t) && t > (out.get(m.prospect_id) ?? -Infinity)) out.set(m.prospect_id, t);
  }
  return out;
}

export interface DailyItem<P> {
  prospect: P;
  /** Bugün bu adayla yapılan manuel temas kanalları (kart "yapıldı" görünür; liste gün içinde sabit kalır). */
  doneToday: OutreachChannel[];
}

/**
 * Bugünün listesi: durumu qualified / queued / contacted olan, ret listesinde olmayan, ertelenmemiş
 * (next_action_at ≤ bugün), son 14 günde temas edilmemiş adaylardan puana göre ilk N. Bugün temas edilenler
 * listede "yapıldı" olarak kalır (yerlerine yenisi gelmez, liste gün içinde sabit).
 */
export function selectDailyList<P extends Pick<Prospect, "id" | "status" | "score" | "next_action_at" | "last_contacted_at" | "email" | "phone"> & { name?: string | null }>(
  prospects: ReadonlyArray<P>,
  messages: ReadonlyArray<ContactMsg>,
  suppression: ReadonlyArray<Pick<SuppressionEntry, "kind" | "value">>,
  opts: { now: Date | number; limit?: number; cooldownDays?: number },
): DailyItem<P>[] {
  const nowMs = new Date(opts.now).getTime();
  const today = istanbulDay(nowMs);
  const limit = opts.limit ?? DAILY_LIST_SIZE;
  const cooldownMs = (opts.cooldownDays ?? CONTACT_COOLDOWN_DAYS) * DAY_MS;
  const last = lastContactByProspect(prospects, messages);

  const todayChannels = new Map<string, OutreachChannel[]>();
  for (const m of messages) {
    if (!m.manual || !isContact(m) || istanbulDay(m.sent_at!) !== today) continue;
    const arr = todayChannels.get(m.prospect_id) ?? [];
    if (!arr.includes(m.channel)) arr.push(m.channel);
    todayChannels.set(m.prospect_id, arr);
  }

  const eligible = prospects.filter((p) => {
    const done = todayChannels.has(p.id);
    if (!done && !DAILY_STATUSES.has(p.status)) return false;
    if (p.status === "suppressed" || p.status === "replied" || p.status === "converted") return false;
    if (isSuppressed(suppression, { email: p.email, phone: p.phone })) return false;
    if (done) return true;
    if (p.next_action_at && p.next_action_at.slice(0, 10) > today) return false;
    const lc = last.get(p.id);
    return lc === undefined || nowMs - lc >= cooldownMs;
  });

  eligible.sort((a, b) => b.score - a.score || (a.name ?? "").localeCompare(b.name ?? "", "tr") || a.id.localeCompare(b.id));
  return eligible.slice(0, limit).map((p) => ({ prospect: p, doneToday: todayChannels.get(p.id) ?? [] }));
}

/** "Sonra": next_action_at = bugün + 7 gün (İstanbul). */
export function snoozePatch(now: Date | number, days = SNOOZE_DAYS): { next_action_at: string } {
  return { next_action_at: addDays(istanbulDay(now), days) };
}

export const MANUAL_CHANNEL_LABEL: Record<Exclude<OutreachChannel, "email">, { done: string; label: string }> = {
  phone: { done: "Aradım", label: "Telefon" },
  whatsapp: { done: "WhatsApp attım", label: "WhatsApp" },
  instagram: { done: "DM attım", label: "Instagram DM" },
};

/**
 * Manuel temas kaydı (outreach_messages satırı): channel phone | whatsapp | instagram, manual = true,
 * status 'sent'. `body` şablon olarak saklanır (Places adı DB'ye kopyalanmaz). sent_at'i DB guard'ı yazar;
 * burada yerel (demo / iyimser) görünüm için doldurulur.
 */
export function manualContactRecord(
  prospectId: string,
  channel: Exclude<OutreachChannel, "email">,
  opts: { id: string; now: Date | number; template?: string },
): OutreachMessage {
  const at = new Date(opts.now).toISOString();
  return {
    id: opts.id,
    prospect_id: prospectId,
    sequence_id: null,
    step_no: 1,
    channel,
    manual: true,
    to_email: null,
    subject: MANUAL_CHANNEL_LABEL[channel].done,
    body: opts.template ?? "",
    status: "sent",
    scheduled_for: null,
    sent_at: at,
    created_at: at,
  };
}

/** Günlük sayaç (bugünkü manuel temas) ve seri (art arda en az bir manuel temas yapılan gün sayısı). */
export function contactStats(messages: ReadonlyArray<ContactMsg>, now: Date | number): { today: number; streak: number } {
  const days = new Map<string, number>();
  for (const m of messages) {
    if (!m.manual || !isContact(m)) continue;
    const d = istanbulDay(m.sent_at!);
    days.set(d, (days.get(d) ?? 0) + 1);
  }
  const today = istanbulDay(now);
  const todayCount = days.get(today) ?? 0;
  // Bugün henüz temas yoksa seri dünden geriye sayılır (gün bitmeden "kırılmış" görünmesin).
  let day = todayCount > 0 ? today : addDays(today, -1);
  let streak = 0;
  while (days.has(day)) {
    streak++;
    day = addDays(day, -1);
  }
  return { today: todayCount, streak };
}

// ---------------------------------------------------------------------------
// Manuel kanal bağlantıları (otomatik gönderim YOK — kişi kendisi gönderir)
// ---------------------------------------------------------------------------

/** wa.me için uluslararası numara (90XXXXXXXXXX) ya da null. Türkiye numaraları varsayılır. */
export function waNumber(phone: string | null | undefined): string | null {
  let d = String(phone ?? "").replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (d.length === 10 && d.startsWith("5")) return `90${d}`;
  if (d.length === 11 && d.startsWith("05")) return `90${d.slice(1)}`;
  if (d.length === 12 && d.startsWith("905")) return d;
  if (d.length === 10 && /^[2-4]/.test(d)) return `90${d}`; // sabit hat (WhatsApp Business olabilir)
  if (d.length === 11 && /^0[2-4]/.test(d)) return `90${d.slice(1)}`;
  if (d.length === 12 && d.startsWith("90")) return d;
  return null;
}

/** Önceden doldurulmuş WhatsApp bağlantısı (mesajı kişi gönderir). Numara yoksa kişi seçme ekranı açılır. */
export function whatsappLink(phone: string | null | undefined, text: string): string {
  const n = waNumber(phone);
  return `https://wa.me/${n ?? ""}?text=${encodeURIComponent(text)}`;
}

/** Instagram kullanıcı adı: @, URL ve sondaki / temizlenir; geçersizse null. */
export function normalizeInstagram(raw: string | null | undefined): string | null {
  let s = String(raw ?? "").trim();
  const m = s.match(/instagram\.com\/([A-Za-z0-9._]{1,30})/i);
  if (m) s = m[1];
  s = s.replace(/^@/, "").replace(/\/+$/, "");
  return /^[A-Za-z0-9._]{1,30}$/.test(s) ? s : null;
}

/** Instagram profil bağlantısı (DM metni panoya kopyalanır; Instagram URL'den metin doldurmayı desteklemez). */
export function instagramLink(handle: string | null | undefined): string | null {
  const h = normalizeInstagram(handle);
  return h ? `https://www.instagram.com/${h}/` : null;
}

export function telLink(phone: string | null | undefined): string | null {
  const n = waNumber(phone);
  return n ? `tel:+${n}` : null;
}

// ---------------------------------------------------------------------------
// Aday görünümü (saklanan + canlı Places), CRM lead taslağı
// ---------------------------------------------------------------------------

/** Canlı Place Details (saklanmaz). */
export interface LivePlace {
  placeId: string;
  name?: string;
  address?: string;
  phone?: string;
  website?: string;
  rating?: number;
  reviewsCount?: number;
  mapsUrl?: string;
}

export interface ProspectView {
  name: string | null;
  address: string | null;
  phone: string | null;
  website: string | null;
  email: string | null;
  instagram: string | null;
  sector: string | null;
  city: string | null;
  district: string | null;
  /** Hangi alan canlı Google verisinden geldi (atıf için). */
  fromGoogle: ("name" | "address" | "phone" | "website")[];
}

/** Saklanan alan önceliklidir (elle / siteden); boşsa canlı Places verisi (yalnızca gösterim). */
export function prospectView(p: Prospect, live?: LivePlace | null): ProspectView {
  const fromGoogle: ProspectView["fromGoogle"] = [];
  const pick = (stored: string | null | undefined, liveVal: string | undefined, key: ProspectView["fromGoogle"][number]) => {
    if (stored) return stored;
    if (p.source === "places" && liveVal) {
      fromGoogle.push(key);
      return liveVal;
    }
    return null;
  };
  return {
    name: pick(p.name, live?.name, "name"),
    address: pick(p.address, live?.address, "address"),
    phone: pick(p.phone, live?.phone, "phone"),
    website: pick(p.website, live?.website, "website"),
    email: p.email ?? null,
    instagram: p.instagram ?? null,
    sector: p.sector ?? null,
    city: p.city ?? null,
    district: p.district ?? null,
    fromGoogle,
  };
}

/** "Yanıt geldi" → CRM lead form taslağı (kullanıcı onaylar; kaynak "Müşteri Bulma"). */
export function prospectToLeadDraft(v: ProspectView, channel: OutreachChannel | null, today: string) {
  const via = channel ? { email: "e-posta", phone: "telefon", whatsapp: "WhatsApp", instagram: "Instagram" }[channel] : null;
  return {
    company_name: v.name ?? "",
    phone: v.phone ?? "",
    email: v.email ?? "",
    instagram: v.instagram ? `@${v.instagram}` : "",
    website: v.website ?? "",
    source: `Müşteri Bulma${via ? ` (${via} yanıtı)` : ""}`,
    interested_in: SECTORS[sectorKeyOf(v.sector)].label,
    next_followup_at: addDays(today, 1),
  };
}

/** Saklanmasına izin verilen köken etiketi (Places adayında ad/adres/site yalnızca manual). */
export function allowedFieldSource(source: Prospect["source"], field: "name" | "address" | "website" | "phone" | "email" | "instagram", fs: FieldSource): boolean {
  if (source !== "places") return true;
  if (field === "name" || field === "address" || field === "website") return fs === "manual";
  return fs === "website" || fs === "manual";
}

// ---------------------------------------------------------------------------
// CSV (hedef klinik listesi — elle araştırılmış, Places değil)
// ---------------------------------------------------------------------------

/** RFC 4180 CSV (tırnaklı alan, "" kaçışı, BOM). */
export function parseCsv(text: string): string[][] {
  const s = text.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows;
}

export type ProspectDraft = Omit<Prospect, "id" | "created_at">;

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
};

/**
 * Hedef klinik CSV'si (Firma adı, Kaynak, Instagram, Web sitesi, İlgilendiği hizmet, Notlar) → aday taslakları.
 * Şehir/ilçe "Şehir: Sakarya / Serdivan" notundan okunur. Durum doğrudan `qualified`. external_id = "csv:<alan-adı>"
 * (yeniden içe aktarmada çoğalmaz).
 */
export function clinicCsvToProspects(text: string): ProspectDraft[] {
  const rows = parseCsv(text);
  if (rows.length < 2) return [];
  const header = rows[0].map((h) => fold(h.trim()));
  const col = (name: string) => header.indexOf(fold(name));
  const iName = col("Firma adı"), iIg = col("Instagram"), iWeb = col("Web sitesi"), iSvc = col("İlgilendiği hizmet"), iNotes = col("Notlar"), iSrc = col("Kaynak");
  const out: ProspectDraft[] = [];
  for (const r of rows.slice(1)) {
    const name = (r[iName] ?? "").trim();
    if (!name) continue;
    const website = /^https?:\/\//i.test((r[iWeb] ?? "").trim()) ? (r[iWeb] ?? "").trim() : null;
    const instagram = normalizeInstagram(r[iIg]);
    const notes = (r[iNotes] ?? "").trim();
    const m = notes.match(/Şehir:\s*([^|/]+?)\s*\/\s*([^|]+?)\s*(?:\||$)/);
    const city = m ? m[1].trim() : null;
    const district = m ? m[2].replace(/\s*\(.*?\)\s*/g, " ").trim() : null;
    const sector = (r[iSvc] ?? "").trim() || null;
    const { score, breakdown } = scoreProspect({ sector: `${sector ?? ""} ${r[iSrc] ?? ""}`, website, instagram, city });
    const host = website ? hostOf(website) : null;
    const fs: Prospect["field_sources"] = { name: "csv" };
    if (website) fs.website = "csv";
    if (instagram) fs.instagram = "csv";
    out.push({
      source: "csv",
      external_id: host ? `csv:${host}` : `csv:${fold(name).replace(/[^a-z0-9]+/g, "-").slice(0, 80)}`,
      name,
      sector,
      city,
      district,
      website,
      instagram,
      field_sources: fs,
      score,
      score_breakdown: breakdown,
      status: "qualified",
      notes: [r[iSrc]?.trim(), notes].filter(Boolean).join(" — ") || null,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Dizi → ilk taslak
// ---------------------------------------------------------------------------

/** "Diziye ekle": adayın e-postası varsa 1. adımın ŞABLON taslağı (onaysız, planlanmamış). */
export function firstStepDraft(
  seq: Pick<OutreachSequence, "id" | "steps">,
  prospect: Pick<Prospect, "id" | "email" | "status">,
  opts: { id: string; now: Date | number },
): OutreachMessage | null {
  const email = normalizeEmail(prospect.email);
  const step = seq.steps[0];
  if (!email || !step) return null;
  const at = new Date(opts.now).toISOString();
  return {
    id: opts.id,
    prospect_id: prospect.id,
    sequence_id: seq.id,
    step_no: 1,
    channel: "email",
    manual: false,
    to_email: email,
    subject: step.subject,
    body: step.body,
    status: "draft",
    scheduled_for: null,
    created_at: at,
  };
}
