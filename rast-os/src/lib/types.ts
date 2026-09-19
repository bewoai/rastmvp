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
  source?: string;
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
  created_at: string;
}

export interface Task {
  id: ID;
  project_id?: ID;
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
  caption?: string;
  goal?: string;
  hook?: string;
  script?: string;
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

export type Currency = "TRY" | "USD" | "EUR";
export type ExpensePaymentStatus = "paid" | "pending";

export interface Expense {
  id: ID;
  category?: string;
  vendor?: string;
  amount: number;
  vat: number;
  currency?: Currency;   // varsayılan TRY; USD/EUR ise kurla TL'ye çevrilir
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
  expenses: Expense[];
}
