// İçerik onayının saf (React'siz) mantığı: token biçimi, 14 günlük süre, 8 maddelik kontrol listesi,
// karar doğrulaması ve durum geçişleri. Veritabanındaki approval_decide (0013) ile aynı kuralları uygular;
// demo modunda kararı bu modül simüle eder.
// Testler: scripts/approval-logic.test.mjs
// Not: Node'un type-stripping'i ile doğrudan test edilir; burada yalnızca `import type` kullanın.
import type {
  ApprovalChecklistItem, ApprovalDecision, ApprovalStatus, ContentApproval,
} from "./types";

/** Onay bağlantısının geçerlilik süresi (gün). */
export const APPROVAL_TTL_DAYS = 14;
/** Token: 32 rastgele bayt → 64 küçük harf hex (256 bit). */
export const TOKEN_BYTES = 32;
export const TOKEN_RE = /^[0-9a-f]{64}$/;
export const NAME_MIN = 3;
export const NAME_MAX = 120;
export const NOTE_MAX = 2000;

/**
 * 8 maddelik mevzuat kontrol listesi — vault şablonu `icerik-onay-formu.md` §2 ile birebir
 * (2025 Yönetmeliği, RG 12.11.2025/33075). Veritabanındaki kopya:
 * 0013_content_approvals.sql → approval_default_checklist() (npm test ikisini karşılaştırır).
 */
export const APPROVAL_CHECKLIST: readonly Omit<ApprovalChecklistItem, "checked">[] = [
  { key: "uzmanlik", label: "Konu ve ifadeler hekimin tescilli uzmanlık alanında; unvan diplomadaki haliyle, sertifikaya dayalı unvan (\"estetik hekimi\" vb.) yok", basis: "5/d" },
  { key: "bilgilendirme", label: "Bilgilendirme niteliğinde: \"tedavi eder\", kanıtlanmamış veya Bakanlıkça düzenlenmemiş yöntem iddiası yok", basis: "4/h, 5/ç" },
  { key: "ustunluk", label: "Üstünlük/garanti yok: \"en iyi\", \"bir numara\", \"garantili\", \"kesin sonuç\", \"ağrısız/risksiz\", \"kalıcı çözüm\", \"tek seansta\", \"mucize\"; rakip ima/kıyas yok", basis: "5/c, 5/ı" },
  { key: "ucret", label: "Ücret, indirim, kampanya, hediye, çekiliş yok", basis: "5/n, 5/m" },
  { key: "yonlendirme", label: "Yönlendirme yok: \"hemen randevu alın\", check-up çağrısı, doğrudan/dolaylı çağrı", basis: "5/f, 5/g" },
  { key: "hasta", label: "Hasta içeriği yok: hasta görüntüsü, öncesi/sonrası, hasta yorumu/teşekkürü, ameliyat anı, mahrem bölge", basis: "5/e, 7" },
  { key: "urun", label: "Ürün/firma/marka adı, cihaz logosu, ürün linki yok", basis: "5/ı" },
  { key: "dogruluk", label: "Tıbbi doğruluk: bilgi hekimin beyanına veya onayladığı kaynağa dayanıyor, doğrulanmamış bilgi kalmadı; korku, yapay aciliyet, tanı koyan ifade yok", basis: "4/h, 5/c" },
];

/** Hekim beyanı (şablon §4) — onay sayfasında "Onaylıyorum" düğmesinin üstünde gösterilir. */
export const PHYSICIAN_DECLARATION =
  "Yukarıda künyesi yazılı içeriğin metnini ve görselini inceledim; tıbbi doğruluğunu ve yukarıdaki kontrol listesine uygunluğunu kabul ediyorum. Yayınına onay veriyorum. Onayımdan sonra içerikte değişiklik olursa yeniden onayıma sunulacağını biliyorum. Sorumluluğun md. 5/2 kapsamında paylaşılabileceğinin farkındayım.";

/** Yeni talep için işaretsiz kontrol listesi. */
export function newChecklist(): ApprovalChecklistItem[] {
  return APPROVAL_CHECKLIST.map((item) => ({ ...item, checked: false }));
}

/* ---------------- Token ---------------- */

export function isValidToken(token: unknown): token is string {
  return typeof token === "string" && TOKEN_RE.test(token);
}

export function tokenFromBytes(bytes: Uint8Array): string {
  if (bytes.length !== TOKEN_BYTES) throw new Error(`Token ${TOKEN_BYTES} bayt olmalı`);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Kriptografik rastgele token (yalnızca demo modu; canlıda token'ı veritabanı üretir).
 * Math.random'a ASLA düşmez: crypto yoksa hata verir.
 */
export function generateToken(): string {
  const c = globalThis.crypto;
  if (!c?.getRandomValues) throw new Error("Güvenli rastgele sayı üreteci yok");
  return tokenFromBytes(c.getRandomValues(new Uint8Array(TOKEN_BYTES)));
}

/** Herkese açık onay sayfasının yolu. */
export const approvalPath = (token: string) => `/onay/${token}`;

/* ---------------- Süre ---------------- */

const toMs = (d: Date | string | number) => (d instanceof Date ? d.getTime() : new Date(d).getTime());

/** Gönderim anından itibaren son geçerlilik (ISO). */
export function expiresAtFrom(sentAt: Date | string | number, days = APPROVAL_TTL_DAYS): string {
  return new Date(toMs(sentAt) + days * 86_400_000).toISOString();
}

/** Süre doldu mu? (expires_at anı dahil — veritabanıyla aynı: expires_at <= now) */
export function isPastExpiry(a: Pick<ContentApproval, "expires_at">, now: Date | string | number): boolean {
  const exp = toMs(a.expires_at);
  return !Number.isFinite(exp) || exp <= toMs(now);
}

/** Kalan tam gün (en az 0). */
export function daysLeft(a: Pick<ContentApproval, "expires_at">, now: Date | string | number): number {
  return Math.max(0, Math.ceil((toMs(a.expires_at) - toMs(now)) / 86_400_000));
}

/**
 * Etkin durum: bekleyen talep süresi dolduysa veya aynı içeriğe daha yeni bir sürüm gönderildiyse
 * "expired" sayılır (approval_get ile aynı).
 */
export function effectiveStatus(
  a: Pick<ContentApproval, "status" | "expires_at">,
  now: Date | string | number,
  newerVersionExists = false,
): ApprovalStatus {
  if (a.status === "pending" && (newerVersionExists || isPastExpiry(a, now))) return "expired";
  return a.status;
}

/* ---------------- Durum geçişleri ---------------- */

/** İzin verilen geçişler: yalnızca bekleyen talep karara bağlanır / geri çekilir; kararlar kesindir. */
export const APPROVAL_TRANSITIONS: Record<ApprovalStatus, readonly ApprovalStatus[]> = {
  pending: ["approved", "changes_requested", "expired"],
  approved: [],
  changes_requested: [],
  expired: [],
};

export function canTransition(from: ApprovalStatus, to: ApprovalStatus): boolean {
  return APPROVAL_TRANSITIONS[from]?.includes(to) ?? false;
}

/* ---------------- Kontrol listesi ---------------- */

/** İşaretlenmemiş madde anahtarları (liste sırasıyla). */
export function missingChecks(
  checklist: readonly Pick<ApprovalChecklistItem, "key">[],
  checkedKeys: Iterable<string>,
): string[] {
  const set = new Set(checkedKeys);
  return checklist.map((i) => i.key).filter((k) => !set.has(k));
}

/** Onay kapısı: listenin TÜM maddeleri işaretlenmeden onay verilemez (boş liste de geçmez). */
export function isChecklistComplete(
  checklist: readonly Pick<ApprovalChecklistItem, "key">[],
  checkedKeys: Iterable<string>,
): boolean {
  return checklist.length > 0 && missingChecks(checklist, checkedKeys).length === 0;
}

/** İşaretlenen anahtarları listeye yazar (karar kaydı). */
export function applyChecks(
  checklist: readonly ApprovalChecklistItem[],
  checkedKeys: Iterable<string>,
): ApprovalChecklistItem[] {
  const set = new Set(checkedKeys);
  return checklist.map((i) => ({ ...i, checked: set.has(i.key) }));
}

export const checkedCount = (checklist: readonly Pick<ApprovalChecklistItem, "checked">[] | null | undefined) =>
  (checklist ?? []).filter((i) => i.checked).length;

/* ---------------- Karar ---------------- */

export type DecisionError =
  | "not_found" | "invalid_decision" | "name_required" | "note_required" | "note_too_long"
  | "checklist_incomplete" | "expired" | "already_decided";

export const decisionErrorText: Record<DecisionError, string> = {
  not_found: "Onay bağlantısı bulunamadı. Bağlantıyı eksiksiz açtığınızdan emin olun.",
  invalid_decision: "Geçersiz karar.",
  name_required: `Lütfen adınızı ve soyadınızı yazın (${NAME_MIN}–${NAME_MAX} karakter).`,
  note_required: "Değişiklik talebi için ne değişmesi gerektiğini nota yazın.",
  note_too_long: `Not en fazla ${NOTE_MAX} karakter olabilir.`,
  checklist_incomplete: "Onaylamak için kontrol listesindeki 8 maddenin tamamını işaretleyin.",
  expired: "Bu onay bağlantısının süresi dolmuş ya da yerine yeni bir sürüm gönderilmiş. Ajanstan yeni bağlantı isteyin.",
  already_decided: "Bu içerik için karar zaten verilmiş.",
};

export interface DecisionInput {
  decision: string;
  name: string;
  note?: string | null;
  checked?: Iterable<string> | null;
}

/** Kayıttan bağımsız girdi kontrolleri: karar türü, ad, not (approval_decide ile aynı sıra). */
function inputError(input: DecisionInput): DecisionError | null {
  if (input.decision !== "approved" && input.decision !== "changes_requested") return "invalid_decision";
  const name = (input.name ?? "").trim();
  if (name.length < NAME_MIN || name.length > NAME_MAX) return "name_required";
  const note = (input.note ?? "").trim();
  if (note.length > NOTE_MAX) return "note_too_long";
  if (input.decision === "changes_requested" && !note) return "note_required";
  return null;
}

/** Girdi + kontrol listesi kapısı: "approved" için listenin tamamı işaretli olmalı. */
export function validateDecision(
  input: DecisionInput,
  checklist: readonly Pick<ApprovalChecklistItem, "key">[],
): DecisionError | null {
  const err = inputError(input);
  if (err) return err;
  if (input.decision === "approved" && !isChecklistComplete(checklist, input.checked ?? [])) return "checklist_incomplete";
  return null;
}

export type DecideResult =
  | { ok: true; approval: ContentApproval }
  | { ok: false; error: DecisionError; approval?: ContentApproval };

/**
 * Kararı kayda uygular (approval_decide'in istemci karşılığı; demo modu ve testler için).
 * Süresi dolan / yenisi gönderilen bekleyen talep "expired" olarak döner.
 */
export function decide(
  approval: ContentApproval,
  input: DecisionInput,
  now: Date | string | number,
  newerVersionExists = false,
): DecideResult {
  // Girdi hataları (karar türü / ad / not) kayıt durumundan önce raporlanır (RPC ile aynı).
  const pre = inputError(input);
  if (pre) return { ok: false, error: pre };
  if (approval.status !== "pending") {
    return { ok: false, error: approval.status === "expired" ? "expired" : "already_decided" };
  }
  if (effectiveStatus(approval, now, newerVersionExists) === "expired") {
    return { ok: false, error: "expired", approval: { ...approval, status: "expired" } };
  }
  const err = validateDecision(input, approval.checklist);
  if (err) return { ok: false, error: err };
  const decision = input.decision as ApprovalDecision;
  const note = (input.note ?? "").trim();
  return {
    ok: true,
    approval: {
      ...approval,
      status: decision,
      checklist: applyChecks(approval.checklist, input.checked ?? []),
      note: note || null,
      decided_at: new Date(toMs(now)).toISOString(),
      decided_by_name: input.name.trim(),
    },
  };
}

/* ---------------- Sürümler ---------------- */

/** İçeriğin sıradaki sürüm numarası (en büyük + 1). */
export function nextVersion(approvals: readonly Pick<ContentApproval, "content_id" | "version">[], contentId: string): number {
  let max = 0;
  for (const a of approvals) if (a.content_id === contentId) max = Math.max(max, Number(a.version) || 0);
  return max + 1;
}

/** İçeriğin sürümleri, en yeni önce. */
export function versionsFor<T extends Pick<ContentApproval, "content_id" | "version">>(approvals: readonly T[], contentId: string): T[] {
  return approvals.filter((a) => a.content_id === contentId).sort((a, b) => b.version - a.version);
}

/** İçerik → en son sürüm. */
export function latestByContent<T extends Pick<ContentApproval, "content_id" | "version">>(approvals: readonly T[]): Map<string, T> {
  const map = new Map<string, T>();
  for (const a of approvals) {
    if (!a.content_id) continue;
    const cur = map.get(a.content_id);
    if (!cur || a.version > cur.version) map.set(a.content_id, a);
  }
  return map;
}

/* ---------------- Paylaşım ---------------- */

/** WhatsApp paylaşım bağlantısı (alıcı seçilmez; kullanıcı kişiyi WhatsApp'ta seçer). */
export const whatsappShareUrl = (text: string) => `https://wa.me/?text=${encodeURIComponent(text)}`;

export function approvalShareText(p: { title: string; version: number; url: string; expiresAt?: string }): string {
  const until = p.expiresAt
    ? ` Bağlantı ${new Date(p.expiresAt).toLocaleDateString("tr-TR", { day: "numeric", month: "long" })} tarihine kadar geçerlidir.`
    : "";
  return `Merhaba, "${p.title}" içeriğinin metni (v${p.version}) yayından önce onayınıza hazır. Kontrol listesini işaretleyip onaylayabilir veya değişiklik isteyebilirsiniz: ${p.url}${until}`;
}
