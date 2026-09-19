import type {
  LeadStatus, ProjectStatus, TaskStatus, ContentStatus,
  ShootStatus, EquipmentStatus, InvoiceStatus, JobStatus,
  PaymentStatus, Priority,
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
