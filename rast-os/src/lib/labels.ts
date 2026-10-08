import type {
  LeadStatus, ProjectStatus, TaskStatus, ContentStatus,
  ShootStatus, EquipmentStatus, InvoiceStatus, JobStatus,
  PaymentStatus, Priority, ProposalStatus, ActivityAction, ActivityLog, ApprovalStatus,
} from "./types";

type Tone = "default" | "amber" | "success" | "warning" | "danger" | "muted";

export const leadStatus: Record<LeadStatus, { label: string; tone: Tone }> = {
  new: { label: "Yeni aday", tone: "muted" },
  contacted: { label: "İletişim kuruldu", tone: "default" },
  needs_assessment: { label: "İhtiyaç görüşmesi", tone: "default" },
  proposal_prep: { label: "Teklif hazırlanıyor", tone: "warning" },
  proposal_sent: { label: "Teklif gönderildi", tone: "amber" },
  awaiting_reply: { label: "Geri dönüş bekleniyor", tone: "amber" },
  revision: { label: "Revize istendi", tone: "warning" },
  won: { label: "Kazanıldı", tone: "success" },
  lost: { label: "Kaybedildi", tone: "danger" },
};

export const leadPipeline: LeadStatus[] = [
  "new", "contacted", "needs_assessment", "proposal_prep",
  "proposal_sent", "awaiting_reply", "revision", "won", "lost",
];

export const projectStatus: Record<ProjectStatus, { label: string; tone: Tone }> = {
  planning: { label: "Planlama", tone: "muted" },
  active: { label: "Aktif", tone: "success" },
  on_hold: { label: "Beklemede", tone: "warning" },
  review: { label: "İncelemede", tone: "amber" },
  completed: { label: "Tamamlandı", tone: "default" },
  cancelled: { label: "İptal", tone: "danger" },
};

export const taskStatus: Record<TaskStatus, { label: string; tone: Tone }> = {
  todo: { label: "Bekliyor", tone: "muted" },
  in_progress: { label: "Yapılıyor", tone: "amber" },
  internal_review: { label: "İç kontrol", tone: "warning" },
  client_review: { label: "Müşteri onayı", tone: "amber" },
  revision: { label: "Revize", tone: "danger" },
  done: { label: "Tamamlandı", tone: "success" },
};

export const taskBoard: TaskStatus[] = [
  "todo", "in_progress", "internal_review", "client_review", "revision", "done",
];

export const contentStatus: Record<ContentStatus, { label: string; tone: Tone }> = {
  idea: { label: "Fikir", tone: "muted" },
  brief: { label: "Brief", tone: "muted" },
  script_ready: { label: "Senaryo hazır", tone: "default" },
  awaiting_shoot: { label: "Çekim bekliyor", tone: "warning" },
  shot: { label: "Çekildi", tone: "default" },
  editing: { label: "Kurgu", tone: "amber" },
  internal_review: { label: "İç kontrol", tone: "warning" },
  sent_to_client: { label: "Müşteriye gönderildi", tone: "amber" },
  revision_requested: { label: "Revize istendi", tone: "danger" },
  approved: { label: "Onaylandı", tone: "success" },
  scheduled: { label: "Planlandı", tone: "default" },
  published: { label: "Yayınlandı", tone: "success" },
  archived: { label: "Arşiv", tone: "muted" },
};

export const shootStatus: Record<ShootStatus, { label: string; tone: Tone }> = {
  planned: { label: "Planlandı", tone: "muted" },
  confirmed: { label: "Onaylandı", tone: "amber" },
  shooting: { label: "Çekimde", tone: "warning" },
  completed: { label: "Tamamlandı", tone: "success" },
  cancelled: { label: "İptal", tone: "danger" },
};

export const equipmentStatus: Record<EquipmentStatus, { label: string; tone: Tone }> = {
  planned: { label: "Alınacak", tone: "muted" },
  idle: { label: "Boşta", tone: "success" },
  reserved: { label: "Ayrıldı", tone: "amber" },
  in_use: { label: "Kullanımda", tone: "warning" },
  assigned: { label: "Zimmetli", tone: "default" },
  maintenance: { label: "Bakımda", tone: "warning" },
  broken: { label: "Arızalı", tone: "danger" },
  lost: { label: "Kayıp", tone: "danger" },
  sold: { label: "Satıldı", tone: "muted" },
};

export const invoiceStatus: Record<InvoiceStatus, { label: string; tone: Tone }> = {
  draft: { label: "Taslak", tone: "muted" },
  issued: { label: "Fatura kesildi", tone: "default" },
  partial: { label: "Kısmi ödendi", tone: "warning" },
  paid: { label: "Ödendi", tone: "success" },
  overdue: { label: "Gecikti", tone: "danger" },
  cancelled: { label: "İptal", tone: "muted" },
};

export const jobStatus: Record<JobStatus, { label: string; tone: Tone }> = {
  quote: { label: "Teklif", tone: "muted" },
  confirmed: { label: "Onaylandı", tone: "amber" },
  in_progress: { label: "Yapılıyor", tone: "warning" },
  delivered: { label: "Teslim edildi", tone: "success" },
  cancelled: { label: "İptal", tone: "danger" },
};

export const paymentStatus: Record<PaymentStatus, { label: string; tone: Tone }> = {
  unpaid: { label: "Ödenmedi", tone: "danger" },
  partial: { label: "Kısmi", tone: "warning" },
  paid: { label: "Ödendi", tone: "success" },
};

export const proposalStatus: Record<ProposalStatus, { label: string; tone: Tone }> = {
  draft: { label: "Taslak", tone: "muted" },
  sent: { label: "Gönderildi", tone: "amber" },
  accepted: { label: "Kabul edildi", tone: "success" },
  rejected: { label: "Reddedildi", tone: "danger" },
  expired: { label: "Süresi doldu", tone: "warning" },
};

/** İçerik onayı (0013). `short`: içerik listesindeki küçük rozet. */
export const approvalStatus: Record<ApprovalStatus, { label: string; short: string; tone: Tone }> = {
  pending: { label: "Onay bekliyor", short: "Onay bekliyor", tone: "amber" },
  approved: { label: "Onaylandı", short: "Onaylı", tone: "success" },
  changes_requested: { label: "Değişiklik istendi", short: "Değişiklik", tone: "danger" },
  expired: { label: "Süresi doldu / geri çekildi", short: "Onay süresi doldu", tone: "muted" },
};

export const priority: Record<Priority, { label: string; tone: Tone }> = {
  low: { label: "Düşük", tone: "muted" },
  medium: { label: "Orta", tone: "default" },
  high: { label: "Yüksek", tone: "warning" },
  urgent: { label: "Acil", tone: "danger" },
};

export const TRY = (n: number | undefined) =>
  new Intl.NumberFormat("tr-TR", {
    style: "currency",
    currency: "TRY",
    maximumFractionDigits: 0,
  }).format(n ?? 0);

export const dateTR = (s?: string) =>
  s ? new Date(s).toLocaleDateString("tr-TR", { day: "2-digit", month: "short", year: "numeric" }) : "—";

/** Tarih + saat (işlem geçmişi): "07 Eki 2026 16:42". */
export const dateTimeTR = (s?: string) =>
  s
    ? new Date(s).toLocaleString("tr-TR", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
    : "—";

// ---------------------------------------------------------------------------
// İşlem geçmişi (activity_logs, 0012)
// ---------------------------------------------------------------------------

export const activityAction: Record<ActivityAction, { label: string; verb: string; tone: Tone }> = {
  insert: { label: "Ekleme", verb: "ekledi", tone: "success" },
  update: { label: "Güncelleme", verb: "güncelledi", tone: "amber" },
  delete: { label: "Silme", verb: "sildi", tone: "danger" },
};

/** Trigger'ın izlediği tablolar → modül adı (0012 ile aynı liste). */
export const activityEntity: Record<string, string> = {
  clients: "Müşteri",
  projects: "Proje",
  jobs: "Tekil iş",
  tasks: "Görev",
  invoices: "Fatura",
  payments: "Tahsilat",
  expenses: "Gider",
  proposals: "Teklif",
  proposal_items: "Teklif kalemi",
  content_approvals: "İçerik onayı", // 0013
  client_reports: "Aylık rapor", // 0015
  client_portal_tokens: "Müşteri portalı", // 0018
  outreach_sequences: "Erişim dizisi", // 0019
  outreach_messages: "Temas / mesaj", // 0019
  suppression_list: "Ret listesi", // 0019
};

export const activityEntityLabel = (entity: string) => activityEntity[entity] ?? entity;

/** Kolon adı → Türkçe alan adı (bilinmeyen kolon olduğu gibi gösterilir). */
export const activityField: Record<string, string> = {
  name: "ad", title: "başlık", customer_name: "müşteri adı", company_name: "firma",
  status: "durum", payment_status: "ödeme durumu", priority: "öncelik",
  amount: "tutar", vat: "KDV", vat_rate: "KDV oranı", paid_amount: "tahsil edilen",
  price: "ücret", cost: "maliyet", budget: "bütçe", est_cost: "tahmini maliyet",
  monthly_fee: "aylık ücret", currency: "para birimi", fx_rate: "kur", amount_try: "TL tutarı",
  issue_date: "fatura tarihi", due_date: "vade / teslim", paid_at: "ödeme tarihi", date: "tarih",
  start_date: "başlangıç", end_date: "bitiş", valid_until: "geçerlilik",
  contract_start: "sözleşme başlangıcı", contract_end: "sözleşme bitişi", payment_day: "ödeme günü",
  invoice_no: "fatura no", proposal_no: "teklif no", method: "ödeme yöntemi",
  category: "kategori", vendor: "tedarikçi", description: "açıklama", notes: "notlar", terms: "koşullar",
  client_id: "müşteri", project_id: "proje", brand_id: "marka", invoice_id: "fatura",
  proposal_id: "teklif", content_id: "içerik", assignee_id: "sorumlu", owner_id: "sorumlu",
  service: "hizmet", job_type: "iş türü", contact: "iletişim", type: "tür", tax_id: "vergi no",
  is_active: "aktif", is_recurring: "tekrarlayan", installment_number: "taksit no", installment_total: "taksit sayısı",
  qty: "miktar", unit: "birim", unit_price: "birim fiyat", position: "sıra",
  est_hours: "tahmini saat", actual_hours: "gerçek saat", checklist: "kontrol listesi",
  drive_url: "Drive linki", receipt_url: "fiş", created_by: "oluşturan",
  version: "sürüm", token: "onay bağlantısı", note: "not", script_snapshot: "senaryo",
  sent_at: "gönderim", expires_at: "son geçerlilik", decided_at: "karar tarihi",
  decided_by_name: "karar veren", decided_by_ip: "IP",
  period: "dönem", highlights: "öne çıkanlar", generated_at: "oluşturulma",
  label: "etiket", contact_line: "iletişim satırı", revoked_at: "iptal", last_seen_at: "son görüntülenme",
};

/** Değişen alanların Türkçe adları (diff anahtar sırasıyla). */
export function activityFields(log: Pick<ActivityLog, "diff">): string[] {
  return Object.keys(log.diff ?? {}).map((k) => activityField[k] ?? k);
}

/** Kaydın görünen adı: trigger'ın yazdığı record_label → tahsilatta tutar → kısa id. */
export function activityRecord(log: Pick<ActivityLog, "record_label" | "entity" | "entity_id" | "diff">): string {
  if (log.record_label) return log.record_label;
  const amount = log.diff?.amount;
  const value = amount ? (amount.new ?? amount.old) : undefined;
  if (log.entity === "payments" && value !== undefined && value !== null && Number.isFinite(Number(value))) {
    return TRY(Number(value));
  }
  return log.entity_id ? `#${log.entity_id.slice(0, 8)}` : "—";
}

/** Kaydın açıldığı sayfa (silinen kayıtta yok). */
export function activityHref(log: Pick<ActivityLog, "entity" | "entity_id" | "action">): string | undefined {
  if (log.action === "delete") return undefined;
  if (log.entity === "proposals" && log.entity_id) return `/teklifler/${log.entity_id}`;
  const pages: Record<string, string> = {
    clients: "/crm/clients", projects: "/projects", jobs: "/jobs", tasks: "/tasks",
    invoices: "/finance/invoices", payments: "/finance/invoices", expenses: "/finance/expenses",
    proposal_items: "/teklifler", content_approvals: "/content", client_reports: "/raporlar/aylik",
    client_portal_tokens: "/crm/clients",
  };
  return pages[log.entity];
}

const activityEnums: Record<string, Record<string, { label: string }>> = {
  "invoices.status": invoiceStatus,
  "tasks.status": taskStatus,
  "projects.status": projectStatus,
  "jobs.status": jobStatus,
  "jobs.payment_status": paymentStatus,
  "proposals.status": proposalStatus,
  "content_approvals.status": approvalStatus,
};

/** Diff değerini okunur metne çevirir (durumlar Türkçe etiketiyle, uzun metin kısaltılır). */
export function activityValue(entity: string, key: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  // Onay bağlantısı gizlidir: işlem geçmişinde gösterilmez.
  if (key === "token" || key === "decided_by_ip") return "••••";
  if (typeof value === "boolean") return value ? "Evet" : "Hayır";
  const text = typeof value === "object" ? JSON.stringify(value) : String(value);
  const enumMap = activityEnums[`${entity}.${key}`] ?? (key === "priority" ? priority : undefined);
  if (enumMap?.[text]) return enumMap[text].label;
  return text.length > 40 ? `${text.slice(0, 39)}…` : text;
}
