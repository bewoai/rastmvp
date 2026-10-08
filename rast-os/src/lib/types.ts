// Rast OS — veri tipleri (Supabase şemasıyla uyumlu, yerel store için)

export type ID = string;

export type LeadStatus =
  | "new" | "contacted" | "needs_assessment" | "proposal_prep"
  | "proposal_sent" | "awaiting_reply" | "revision" | "won" | "lost";

export type ProjectStatus =
  | "planning" | "active" | "on_hold" | "review" | "completed" | "cancelled";

export type TaskStatus =
  | "todo" | "in_progress" | "internal_review" | "client_review" | "revision" | "done";

export type ContentStatus =
  | "idea" | "brief" | "script_ready" | "awaiting_shoot" | "shot" | "editing"
  | "internal_review" | "sent_to_client" | "revision_requested" | "approved"
  | "scheduled" | "published" | "archived";

export type ShootStatus = "planned" | "confirmed" | "shooting" | "completed" | "cancelled";

export type EquipmentStatus =
  | "planned" | "idle" | "reserved" | "in_use" | "assigned" | "maintenance" | "broken" | "lost" | "sold";

export type InvoiceStatus = "draft" | "issued" | "partial" | "paid" | "overdue" | "cancelled";

export type JobStatus = "quote" | "confirmed" | "in_progress" | "delivered" | "cancelled";

export type PaymentStatus = "unpaid" | "partial" | "paid";

export type Priority = "low" | "medium" | "high" | "urgent";

export interface Lead {
  id: ID;
  company_name: string;
  contact_person?: string;
  phone?: string;
  email?: string;
  instagram?: string;
  website?: string;
  source?: string;
  source_package?: string | null;               // 0017: web formundaki paket (ör. "standart")
  source_utm?: Record<string, string> | null;   // 0017: utm_* parametreleri
  interested_in?: string;
  est_budget?: number;
  notes?: string;
  status: LeadStatus;
  next_followup_at?: string;
  created_at: string;
}

export interface Client {
  id: ID;
  name: string;
  tax_id?: string;
  monthly_fee?: number;
  contract_start?: string;
  contract_end?: string;
  payment_day?: number;
  is_active: boolean;
  notes?: string;
  created_at: string;
}

export interface Brand {
  id: ID;
  client_id: ID;
  name: string;
  tone?: string;
  target_audience?: string;
  color_palette?: string;
  website?: string;
  instagram?: string;
  notes?: string;
  created_at: string;
}

export interface Contact {
  id: ID;
  client_id?: ID;
  full_name: string;
  title?: string;
  phone?: string;
  email?: string;
  is_approver: boolean;
  created_at: string;
}

export interface Project {
  id: ID;
  client_id?: ID;
  brand_id?: ID;
  name: string;
  type?: string;
  owner?: string;
  start_date?: string;
  end_date?: string;
  budget?: number;
  status: ProjectStatus;
  priority: Priority;
  notes?: string;
  proposal_id?: ID | null; // 0015: kabul edilen tekliften oluşturulduysa (teklif başına tek proje)
  created_at: string;
}

export interface Task {
  id: ID;
  project_id?: ID;
  lead_id?: ID | null;     // 0017: lead girişinden doğan arama görevi
  title: string;
  assignee?: string;
  due_date?: string;
  priority: Priority;
  status: TaskStatus;
  created_at: string;
}

export interface Content {
  id: ID;
  client_id?: ID;
  brand_id?: ID;
  title: string;
  platform?: string;
  content_type?: string;
  status: ContentStatus;
  planned_date?: string;
  published_date?: string; // 0001'de var; boşsa yayınlanan içerikte planned_date esas alınır
  caption?: string;
  goal?: string;
  hook?: string;
  script?: string;
  script_source?: string | null; // 0016: senaryonun kaynağı ("claude-code" = senaryo-uret taslağından içe aktarıldı)
  cta?: string;
  references_url?: string;
  attachments?: ContentAttachment[];
  created_at: string;
}

export interface ContentAttachment {
  id: ID;
  name: string;
  mime_type?: string;
  size: number;
  storage_path?: string;
  url?: string;
  extracted_text?: string;
  sheet_names?: string[];
  page_count?: number;
  uploaded_at: string;
}

export interface Shoot {
  id: ID;
  client_id?: ID;
  brand_id?: ID;
  title: string;
  shoot_type?: string;
  scheduled_at?: string;
  location?: string;
  status: ShootStatus;
  notes?: string;
  created_at: string;
}

export interface Equipment {
  id: ID;
  name: string;
  brand_model?: string;
  category?: string;
  status: EquipmentStatus;
  assigned_to?: string;
  purchase_price?: number;
  next_service?: string;
  notes?: string;
  created_at: string;
}

export interface Invoice {
  id: ID;
  client_id?: ID;
  project_id?: ID | null; // 0001'de var; tekliften oluşturulan taslak fatura projeye bağlanır
  invoice_no?: string;
  issue_date?: string;
  due_date?: string;
  amount: number;
  vat: number;
  paid_amount: number;
  status: InvoiceStatus;
  notes?: string;
  created_at: string;
}

// Tahsilat kaydı: faturaya yapılan her ödeme (paid_at = paranın girdiği gün).
// Dashboard geliri fatura tarihine değil bu tarihe göre hesaplanır.
export interface Payment {
  id: ID;
  invoice_id?: ID;
  amount: number;
  method?: string;
  paid_at: string;
  notes?: string;
  created_at: string;
}

export type Currency = "TRY" | "USD" | "EUR";
export type ExpensePaymentStatus = "paid" | "pending";

export interface Expense {
  id: ID;
  category?: string;
  vendor?: string;
  amount: number;
  vat: number;
  currency?: Currency;   // varsayılan TRY; USD/EUR ise kurla TL'ye çevrilir
  fx_rate?: number | null;    // 0009: giriş anındaki kur (USD/EUR); TRY'de null
  amount_try?: number | null; // 0009: amount * fx_rate (KDV hariç), giriş anında sabit
  paid_at?: string;
  method?: string;
  payment_status?: ExpensePaymentStatus;
  installment_number?: number;
  installment_total?: number;
  is_recurring: boolean;
  description?: string;
  created_at: string;
}

// Tekil (tek seferlik) iş — aylık müşteri olmayan, tek seferlik ücretli işler.
// Düğün/etkinlik çekimi, tek tanıtım videosu, tek tasarım işi vb.
export interface Job {
  id: ID;
  customer_name: string;   // kişi/firma (tam müşteri kaydı gerektirmez)
  contact?: string;        // telefon/e-posta
  service?: string;        // ne işi yapıldı
  job_type?: string;       // kategori: çekim, tasarım, video, etkinlik...
  date?: string;           // iş / teslim tarihi
  price: number;           // alınan ücret
  cost?: number;           // maliyet (kârlılık için, opsiyonel)
  paid_amount: number;     // tahsil edilen
  status: JobStatus;
  payment_status: PaymentStatus;
  notes?: string;
  created_at: string;
}

// Teklif (0011): kapsam → fiyat → markalı PDF. Kalemler ayrı koleksiyonda (proposal_items).
export type ProposalStatus = "draft" | "sent" | "accepted" | "rejected" | "expired";

export interface Proposal {
  id: ID;
  client_id?: ID;
  title: string;
  proposal_no: string;     // RC-YYYY-NNN (uygulamada üretilir, org içinde tekil)
  status: ProposalStatus;
  currency: Currency;      // varsayılan TRY
  vat_rate: number;        // yüzde (varsayılan 20)
  valid_until?: string;
  notes?: string;          // süreç / takvim
  terms?: string;          // karşılıklı sorumluluklar + ödeme koşulları
  created_by?: ID;
  created_at: string;
  updated_at?: string;
}

export interface ProposalItem {
  id: ID;
  proposal_id: ID;
  position: number;
  name: string;
  description?: string;
  qty: number;
  unit: string;            // varsayılan "ay"
  unit_price: number;      // KDV hariç
  is_recurring: boolean;   // aylık (true) / tek seferlik (false)
  created_at: string;
}

// İşlem geçmişi (0012): yalnızca DB trigger'ı yazar, uygulama salt okur.
export type ActivityAction = "insert" | "update" | "delete";
export type ActivityDiff = Record<string, { old?: unknown; new?: unknown }>;

export interface ActivityLog {
  id: ID;
  actor_id?: ID | null;
  actor_name?: string | null;   // işlem anındaki profil adı
  entity: string;               // tablo adı (clients, invoices, …)
  entity_id?: ID | null;
  record_label?: string | null; // kaydın görünen adı (silinse de okunur)
  action: ActivityAction;
  diff?: ActivityDiff | null;   // { kolon: { old, new } } — yalnızca değişen alanlar
  created_at: string;
}

// İçerik onayı (0013): hekim / müşteri yayından önce gizli bağlantıyla onaylar.
export type ApprovalStatus = "pending" | "approved" | "changes_requested" | "expired";
export type ApprovalDecision = Extract<ApprovalStatus, "approved" | "changes_requested">;

export interface ApprovalChecklistItem {
  key: string;
  label: string;
  basis?: string;   // yönetmelik dayanağı (ör. "5/d")
  checked: boolean;
}

export interface ContentApproval {
  id: ID;
  content_id?: ID | null;        // içerik silinirse null (kayıt kanıt olarak kalır)
  version: number;               // içerik başına 1, 2, 3…
  token: string;                 // 64 hex — gizli bağlantı (/onay/<token>)
  title: string;                 // gönderim anındaki içerik başlığı
  checklist: ApprovalChecklistItem[];
  script_snapshot?: string | null;
  note?: string | null;          // onaylayanın notu / değişiklik talebi
  status: ApprovalStatus;
  sent_at: string;
  decided_at?: string | null;
  decided_by_name?: string | null;
  decided_by_ip?: string | null;
  expires_at: string;
  created_by?: ID | null;
  created_at: string;
}

/** approval_get RPC'nin döndürdüğü asgari (public) görünüm. */
export interface PublicApproval {
  title: string;
  version: number;
  status: ApprovalStatus;        // etkin durum (süresi dolan / yenisi gönderilen bekleyen → expired)
  script_snapshot: string | null;
  checklist: ApprovalChecklistItem[];
  note: string | null;
  sent_at: string;
  expires_at: string;
  decided_at: string | null;
  decided_by_name: string | null;
  client_name: string | null;
  brand_name: string | null;
  agency_name: string | null;
}

// Aylık müşteri raporu (0015): yalnızca elle yazılan kısımlar saklanır; sayılar her açılışta
// içerik / çekim / onay kayıtlarından hesaplanır (src/lib/report-logic.ts).
export interface ClientReportHighlights {
  points?: string[];   // öne çıkanlar (madde listesi)
  ads_note?: string;   // Reklam / GİP notları — serbest metin, metrik YOK
}

export interface ClientReport {
  id: ID;
  client_id: ID;
  period: string;      // "YYYY-MM-01"
  notes?: string | null;
  highlights: ClientReportHighlights;
  generated_at: string;
  created_at: string;
  updated_at?: string;
}

export interface RastData {
  leads: Lead[];
  jobs: Job[];
  clients: Client[];
  brands: Brand[];
  contacts: Contact[];
  projects: Project[];
  tasks: Task[];
  contents: Content[];
  shoots: Shoot[];
  equipment: Equipment[];
  invoices: Invoice[];
  payments: Payment[];
  expenses: Expense[];
  proposals: Proposal[];
  proposal_items: ProposalItem[];
  content_approvals: ContentApproval[];
  client_reports: ClientReport[];
  activity_logs: ActivityLog[];
}

/** Uygulamanın yazabildiği koleksiyonlar (activity_logs salt okunur — trigger yazar). */
export type WritableCollection = Exclude<keyof RastData, "activity_logs">;
