// Lead akışının saf (React'siz, sunucu/istemci güvenli) mantığı:
//  - web sitesi iletişim formu payload'ının normalizasyonu (/api/leads)
//  - tekilleştirme anahtarları (e-posta / telefon) — SQL tarafı (0017 lead_intake) ile AYNI kurallar
//  - CRM görünümü: kaynak türü (hekim / site / manuel) ve "ilk arama yapılmadı" rozeti
// Testler: scripts/lead-logic.test.mjs
// Not: Node'un type-stripping'i ile doğrudan test edilir; burada yalnızca `import type` kullanın.
import type { Lead, Task } from "./types";

// ---------------------------------------------------------------------------
// Sabitler
// ---------------------------------------------------------------------------

/** Lead girişinde oluşan görevin başlık öneki. Rozet mantığı görevi bu önekle tanır (0017 ile aynı). */
export const CALL_TASK_PREFIX = "Lead'i 24 saat içinde ara";
/** Lead'in "yeni" sayıldığı süre (rozet): 48 saat. */
export const NEW_LEAD_WINDOW_MS = 48 * 60 * 60 * 1000;
/** /api/leads gövde sınırı. */
export const MAX_BODY_BYTES = 20 * 1024;

const MAX = { name: 120, company: 160, phone: 40, email: 160, projectType: 120, message: 4000, slug: 40, utm: 120 } as const;
const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"] as const;
export type UtmKey = (typeof UTM_KEYS)[number];

// ---------------------------------------------------------------------------
// Tekilleştirme anahtarları
// ---------------------------------------------------------------------------

/** E-posta anahtarı: küçük harf + kırpılmış; geçersizse null. */
export function emailKey(value: unknown): string | null {
  const s = String(value ?? "").trim().toLowerCase().slice(0, MAX.email);
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s) ? s : null;
}

/**
 * Telefon anahtarı: yalnızca rakamlar; 10+ hanede SON 10 hane (+90 / 0 / 90 öneki fark etmez),
 * 7-9 hanede olduğu gibi, daha kısaysa null. SQL karşılığı: public.lead_phone_key().
 */
export function phoneKey(value: unknown): string | null {
  const digits = String(value ?? "").slice(0, MAX.phone).replace(/\D/g, "");
  if (digits.length >= 10) return digits.slice(-10);
  return digits.length >= 7 ? digits : null;
}

export interface DedupeKeys {
  email: string | null;
  phone: string | null;
}

export function leadDedupeKeys(lead: { email?: unknown; phone?: unknown }): DedupeKeys {
  return { email: emailKey(lead.email), phone: phoneKey(lead.phone) };
}

/** İki kayıt aynı kişi mi? (en az bir anahtar boş olmayan ve eşit) */
export function isSameLead(a: { email?: unknown; phone?: unknown }, b: { email?: unknown; phone?: unknown }): boolean {
  const ka = leadDedupeKeys(a);
  const kb = leadDedupeKeys(b);
  return Boolean((ka.email && ka.email === kb.email) || (ka.phone && ka.phone === kb.phone));
}

// ---------------------------------------------------------------------------
// Payload normalizasyonu
// ---------------------------------------------------------------------------

export interface LeadIntake {
  name: string;
  company: string | null;
  phone: string | null;
  phone_key: string | null;
  email: string | null;
  project_type: string | null;
  message: string | null;
  /** Küçük harfli kısa kimlik (ör. "hekim"); yoksa null. */
  kaynak: string | null;
  paket: string | null;
  utm: Partial<Record<UtmKey, string>>;
}

export type NormalizeResult =
  | { ok: true; value: LeadIntake }
  | { ok: false; error: string }
  /** Bot kapanı (botcheck) dolu: kaydedilmez, istemciye başarılıymış gibi yanıt verilir. */
  | { ok: false; spam: true; error: string };

const clean = (v: unknown, max: number): string => {
  // Kontrol karakterleri (satır sonu hariç) atılır; metin kırpılır ve sınırlanır.
  const s = typeof v === "string" || typeof v === "number" ? String(v) : "";
  return s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim().slice(0, max);
};
const orNull = (s: string) => (s ? s : null);
const slug = (v: unknown): string | null => {
  const s = clean(v, MAX.slug).toLowerCase();
  return /^[a-z0-9_-]{1,40}$/.test(s) ? s : null;
};

const truthy = (v: unknown) => {
  const s = String(v ?? "").trim().toLowerCase();
  return s !== "" && s !== "0" && s !== "false" && s !== "off";
};

/**
 * Site iletişim formunun (ContactForm.astro) alan adlarıyla gelen JSON / form gövdesini normalize eder:
 * name*, company, phone, email, project_type, message, kaynak, paket, utm_*, botcheck (honeypot).
 * Zorunlu: ad (≥2 karakter) ve geçerli bir telefon VEYA e-posta. Bilinmeyen alanlar (access_key, subject…) yok sayılır.
 */
export function normalizeLeadPayload(raw: unknown): NormalizeResult {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "Geçersiz gövde." };
  const r = raw as Record<string, unknown>;

  if (truthy(r.botcheck)) return { ok: false, spam: true, error: "Bot." };

  const name = clean(r.name, MAX.name);
  if (name.length < 2) return { ok: false, error: "Ad zorunludur." };

  const phone = orNull(clean(r.phone, MAX.phone));
  const phone_key = phoneKey(phone);
  const email = emailKey(r.email);
  if (!phone_key && !email) return { ok: false, error: "Geçerli bir telefon veya e-posta gerekli." };

  const utm: Partial<Record<UtmKey, string>> = {};
  for (const k of UTM_KEYS) {
    const v = clean(r[k], MAX.utm);
    if (v) utm[k] = v;
  }

  return {
    ok: true,
    value: {
      name,
      company: orNull(clean(r.company, MAX.company)),
      phone: phone_key ? phone : null,
      phone_key,
      email,
      project_type: orNull(clean(r.project_type, MAX.projectType)),
      message: orNull(clean(r.message, MAX.message)),
      kaynak: slug(r.kaynak),
      paket: slug(r.paket),
      utm,
    },
  };
}

/** CRM "Kaynak" etiketi (leads.source). 0017'deki SQL ile aynı metinler. */
export function sourceLabelFor(kaynak: string | null): string {
  return kaynak === "hekim" ? "Hekim sistemi (web sitesi)" : "Web sitesi";
}

/** Görev başlığı: "Lead'i 24 saat içinde ara: <ad>" (0017 ile aynı). */
export const callTaskTitle = (name: string) => `${CALL_TASK_PREFIX}: ${name}`;

// ---------------------------------------------------------------------------
// CRM görünümü
// ---------------------------------------------------------------------------

export type LeadSourceKind = "hekim" | "site" | "manuel";

export const leadSourceKinds: Record<LeadSourceKind, { label: string; tone: "accent" | "default" | "muted" }> = {
  hekim: { label: "Hekim", tone: "accent" },
  site: { label: "Site", tone: "default" },
  manuel: { label: "Manuel", tone: "muted" },
};

const fold = (s: string) =>
  s.toLocaleLowerCase("tr").replace(/ı/g, "i").replace(/ş/g, "s").replace(/ğ/g, "g").replace(/ü/g, "u").replace(/ö/g, "o").replace(/ç/g, "c");

/**
 * Kaynak türü, `source` metninden türetilir (ek kolon gerekmez; migration uygulanmadan da çalışır):
 * "hekim" geçiyorsa → hekim (hedef klinik listesi + hekim formu); "web" / "site" / "form" geçiyorsa → site;
 * diğer her şey (Referans, Instagram, boş…) → manuel.
 */
export function leadSourceKind(lead: Pick<Lead, "source">): LeadSourceKind {
  const s = fold(lead.source ?? "");
  if (s.includes("hekim")) return "hekim";
  if (/\b(web|site|form)/.test(s)) return "site";
  return "manuel";
}

/** Bir görev "lead arama" görevi mi? (lead'e bağlı ve başlığı önekle başlar) */
export function isCallTask(task: Pick<Task, "title" | "lead_id">): boolean {
  return Boolean(task.lead_id) && fold(task.title).startsWith(fold(CALL_TASK_PREFIX));
}

/**
 * Rozet: son 48 saatte açılmış, açık (kazanılmamış/kaybedilmemiş), lead girişinden doğan (bağlı bir "Lead'i ara"
 * görevi var) ve bu görevlerden HİÇBİRİ tamamlanmamış lead. Bağlı arama görevi olmayan lead'ler (elle girilenler,
 * toplu içe aktarılan hedef listesi) rozet almaz: onlar "gelen talep" değildir ve 24 saat sözü yoktur.
 * `created_at` tarih-saat veya yalnızca tarih (YYYY-MM-DD) olabilir.
 */
export function leadNeedsFirstCall(
  lead: Pick<Lead, "id" | "created_at" | "status">,
  tasks: ReadonlyArray<Pick<Task, "title" | "lead_id" | "status">>,
  nowMs: number,
): boolean {
  if (lead.status === "won" || lead.status === "lost") return false;
  const created = Date.parse(lead.created_at);
  if (!Number.isFinite(created)) return false;
  const age = nowMs - created;
  if (age < 0 || age > NEW_LEAD_WINDOW_MS) return false;
  const calls = tasks.filter((t) => t.lead_id === lead.id && isCallTask(t));
  return calls.length > 0 && !calls.some((t) => t.status === "done");
}

/** Kenar menü rozeti: `status` "new" olan (henüz ele alınmamış) lead sayısı. */
export function countNewLeads(leads: readonly Pick<Lead, "status">[]): number {
  let n = 0;
  for (const l of leads) if (l.status === "new") n++;
  return n;
}

/** Rozeti olan lead id'leri (tek geçiş: görevler lead'e göre indekslenir). */
export function leadsNeedingFirstCall(
  leads: ReadonlyArray<Pick<Lead, "id" | "created_at" | "status">>,
  tasks: ReadonlyArray<Pick<Task, "title" | "lead_id" | "status">>,
  nowMs: number,
): Set<string> {
  const byLead = new Map<string, Pick<Task, "title" | "lead_id" | "status">[]>();
  for (const t of tasks) {
    if (!t.lead_id || !isCallTask(t)) continue;
    const arr = byLead.get(t.lead_id);
    if (arr) arr.push(t);
    else byLead.set(t.lead_id, [t]);
  }
  const out = new Set<string>();
  for (const l of leads) {
    const calls = byLead.get(l.id);
    if (calls && leadNeedsFirstCall(l, calls, nowMs)) out.add(l.id);
  }
  return out;
}
