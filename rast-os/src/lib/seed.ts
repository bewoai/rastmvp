import type { RastData } from "./types";
import { findPreset, presetToItems } from "./proposal-presets";
import { APPROVAL_CHECKLIST, expiresAtFrom } from "./approval-logic";

// Demo içerik onayları: tarihler sayfanın açıldığı ana göre (bekleyen talep demo'da hiç "süresi dolmuş" olmasın).
const DAY = 86_400_000;
const demoNow = Date.now();
const daysAgo = (d: number) => new Date(demoNow - d * DAY).toISOString();
/** Demo onay bağlantıları: /onay/<token> (Supabase yokken sunucu seed'den okur). */
export const DEMO_APPROVAL_TOKENS = {
  pending: "7c1e9a4b2d6f80135ae9c47d2b18f6a0c3d5e7f91b2a4c6d8e0f13579bdf2468",
  approved: "e4b7a91c3f5d2086b9e1a7c4d3f60852a1c9e7b5d3f1a2c4e6b8d0f2a4c6e8b0",
} as const;

const SCRIPT_KARDIYOLOJI = `[0-3 sn] Hook: "Merdiven çıkarken nefesiniz mi daralıyor?"
[3-20 sn] Uzm. Dr. anlatır: Efor sırasında nefes darlığı ve göğüste baskı hissi kalple ilgili olabilir; tek başına tanı koymaz, değerlendirme gerekir.
[20-35 sn] Hangi durumlarda bir kardiyoloji uzmanına başvurmak gerektiğini genel bilgi olarak sıralar.
[35-40 sn] Kapanış: "Şikâyetleriniz varsa bir hekime danışın." (randevu çağrısı yok)`;

const SCRIPT_GLOBAL = `[0-5 sn] Hastane girişi, genel mekan görüntüleri (hasta yüzü yok).
[5-30 sn] Uluslararası hasta birimi sorumlusu, tercüman ve transfer süreçlerini genel olarak anlatır.
[30-45 sn] Kapanış: kurum adı ve web sitesi (fiyat, kampanya, garanti ifadesi yok).`;

// Demo teklif: Hekim İçerik Sistemi — Standart (25.000 + KDV / ay)
const demoProposalItems = (() => {
  const preset = findPreset("hekim:standart");
  let n = 0;
  return preset ? presetToItems(preset.pkg, "pr1", () => `pi${++n}`, "2026-10-01") : [];
})();

// Demo MRR: kabul edilmiş 3 teklif, aylık (tekrarlayan) kalemler, KDV hariç → toplam 75.000 TL/ay
// (Aytaş Home 30.000 + Adatıp Global 25.000 + Mira Kozmetik 20.000). Eşik demo'da 90.000 (src/lib/orgSettings.ts).
const demoAcceptedItems: RastData["proposal_items"] = [
  { id: "pi-a1", proposal_id: "pr2", position: 0, name: "Sosyal medya yönetimi", description: "Instagram içerik planı, paylaşım ve topluluk yönetimi", qty: 1, unit: "ay", unit_price: 12000, is_recurring: true, created_at: "2026-02-15" },
  { id: "pi-a2", proposal_id: "pr2", position: 1, name: "Aylık video üretimi (8 video)", qty: 1, unit: "ay", unit_price: 18000, is_recurring: true, created_at: "2026-02-15" },
  { id: "pi-a3", proposal_id: "pr2", position: 2, name: "Kampanya çekim günü", qty: 1, unit: "gün", unit_price: 9000, is_recurring: false, created_at: "2026-02-15" },
  { id: "pi-b1", proposal_id: "pr3", position: 0, name: "Uluslararası içerik yönetimi", qty: 1, unit: "ay", unit_price: 17000, is_recurring: true, created_at: "2026-03-10" },
  { id: "pi-b2", proposal_id: "pr3", position: 1, name: "Çok dilli video (4 / ay)", qty: 1, unit: "ay", unit_price: 8000, is_recurring: true, created_at: "2026-03-10" },
  { id: "pi-c1", proposal_id: "pr4", position: 0, name: "Sosyal medya yönetimi", qty: 1, unit: "ay", unit_price: 8000, is_recurring: true, created_at: "2026-06-20" },
  { id: "pi-c2", proposal_id: "pr4", position: 1, name: "Aylık reels paketi (6 video)", qty: 1, unit: "ay", unit_price: 12000, is_recurring: true, created_at: "2026-06-20" },
];

// Gerçekçi tohum veri (Rast Creative örnek müşterileri).
export const seed: RastData = {
  jobs: [
    { id: "j1", customer_name: "Selin & Emre (Düğün)", contact: "0533 100 00 01", service: "Düğün çekimi + edit", job_type: "Çekim", date: "2026-08-16", price: 28000, cost: 6000, paid_amount: 14000, status: "confirmed", payment_status: "partial", notes: "Kapora alındı, kalan çekim günü.", created_at: "2026-07-20" },
    { id: "j2", customer_name: "Elit Emlak", contact: "info@elitemlak.com", service: "Tek tanıtım videosu", job_type: "Video", date: "2026-08-09", price: 15000, cost: 3000, paid_amount: 15000, status: "delivered", payment_status: "paid", created_at: "2026-07-28" },
    { id: "j3", customer_name: "Cafe Nar", contact: "0533 100 00 03", service: "Menü tasarımı", job_type: "Tasarım", date: "2026-08-12", price: 6500, cost: 500, paid_amount: 0, status: "quote", payment_status: "unpaid", notes: "Teklif gönderildi.", created_at: "2026-08-01" },
  ],
  clients: [
    { id: "c1", name: "Aytaş Home", monthly_fee: 35000, contract_start: "2026-01-01", contract_end: "2026-12-31", payment_day: 5, is_active: true, created_at: "2026-01-02", notes: "Mobilya & ev tekstili markası." },
    { id: "c2", name: "Adatıp Sağlık Grubu", monthly_fee: 60000, contract_start: "2026-03-01", contract_end: "2027-02-28", payment_day: 1, is_active: true, created_at: "2026-03-01", notes: "Hastane grubu, çok markalı." },
    { id: "c3", name: "Mira Kozmetik", monthly_fee: 22000, contract_start: "2026-06-15", payment_day: 15, is_active: true, created_at: "2026-06-15" },
  ],
  brands: [
    { id: "b1", client_id: "c1", name: "Aytaş Home", tone: "Sıcak, sade, davetkâr", target_audience: "25-45 ev sahibi kadınlar", instagram: "@aytashome", created_at: "2026-01-02" },
    { id: "b2", client_id: "c2", name: "Adatıp Hastanesi", tone: "Güven veren, profesyonel", target_audience: "Genel hasta kitlesi", instagram: "@adatiphastanesi", created_at: "2026-03-01" },
    { id: "b3", client_id: "c2", name: "Adatıp Global", tone: "Uluslararası, prestijli", target_audience: "Yurtdışı hastalar", instagram: "@adatipglobal", created_at: "2026-03-01" },
    { id: "b4", client_id: "c3", name: "Mira Kozmetik", tone: "Genç, enerjik, renkli", target_audience: "18-30 Gen-Z", instagram: "@miracosmetics", created_at: "2026-06-15" },
  ],
  contacts: [
    { id: "ct1", client_id: "c1", full_name: "Elif Aytaş", title: "Pazarlama Müdürü", phone: "0532 000 00 01", email: "elif@aytashome.com", is_approver: true, created_at: "2026-01-02" },
    { id: "ct2", client_id: "c2", full_name: "Dr. Kemal Sarı", title: "Kurumsal İletişim", phone: "0532 000 00 02", email: "kemal@adatip.com", is_approver: true, created_at: "2026-03-01" },
    { id: "ct3", client_id: "c3", full_name: "Selin Demir", title: "Marka Yöneticisi", phone: "0532 000 00 03", email: "selin@mira.com", is_approver: false, created_at: "2026-06-15" },
  ],
  leads: [
    { id: "l1", company_name: "Kavis Mimarlık", contact_person: "Burak Yıldız", phone: "0532 111 11 11", source: "Instagram", interested_in: "Sosyal medya + tanıtım filmi", est_budget: 40000, status: "proposal_sent", next_followup_at: "2026-08-05", created_at: "2026-07-20", notes: "Ofis tanıtımı istiyor." },
    { id: "l2", company_name: "Deniz Restoran", contact_person: "Ayşe Kaya", phone: "0532 222 22 22", source: "Referans", interested_in: "Menü çekimi + reels", est_budget: 18000, status: "needs_assessment", next_followup_at: "2026-08-04", created_at: "2026-07-25" },
    { id: "l3", company_name: "Form Fitness", contact_person: "Can Öz", source: "Reklam", interested_in: "Aylık yönetim", est_budget: 25000, status: "new", created_at: "2026-08-01" },
    { id: "l4", company_name: "Nar Cafe", contact_person: "Melis Ak", source: "Web sitesi", interested_in: "Ürün çekimi", est_budget: 12000, status: "awaiting_reply", next_followup_at: "2026-08-06", created_at: "2026-07-15" },
    { id: "l5", company_name: "Tekno Bilişim", contact_person: "Ozan Er", source: "LinkedIn", interested_in: "Kurumsal video", est_budget: 55000, status: "won", created_at: "2026-06-30" },
  ],
  projects: [
    { id: "p1", client_id: "c1", brand_id: "b1", name: "Aytaş Home — Ağustos Sosyal Medya", type: "Aylık yönetim", owner: "Berat", start_date: "2026-08-01", end_date: "2026-08-31", budget: 35000, status: "active", priority: "high", created_at: "2026-08-01" },
    { id: "p2", client_id: "c2", brand_id: "b2", name: "Adatıp — Doktor Tanıtım Serisi", type: "Video serisi", owner: "Berat", start_date: "2026-07-15", end_date: "2026-08-20", budget: 48000, status: "active", priority: "urgent", created_at: "2026-07-15" },
    { id: "p3", client_id: "c3", brand_id: "b4", name: "Mira — Yaz Kampanyası", type: "Kampanya", owner: "Berat", start_date: "2026-08-05", end_date: "2026-09-05", budget: 30000, status: "planning", priority: "medium", created_at: "2026-07-28" },
  ],
  tasks: [
    { id: "t1", project_id: "p1", title: "Reels #8 kurgu", assignee: "Editör", due_date: "2026-08-03", priority: "high", status: "in_progress", created_at: "2026-08-01" },
    { id: "t2", project_id: "p1", title: "Ağustos caption seti", assignee: "İçerik", due_date: "2026-08-04", priority: "medium", status: "todo", created_at: "2026-08-01" },
    { id: "t3", project_id: "p2", title: "Dr. röportaj kurgusu", assignee: "Editör", due_date: "2026-08-05", priority: "urgent", status: "internal_review", created_at: "2026-07-30" },
    { id: "t4", project_id: "p2", title: "Alt yazı + renk", assignee: "Editör", due_date: "2026-08-06", priority: "high", status: "todo", created_at: "2026-07-30" },
    { id: "t5", project_id: "p3", title: "Kampanya moodboard", assignee: "Tasarım", due_date: "2026-08-07", priority: "medium", status: "todo", created_at: "2026-07-28" },
    { id: "t6", project_id: "p1", title: "Story serisi tasarım", assignee: "Tasarım", due_date: "2026-08-02", priority: "high", status: "client_review", created_at: "2026-08-01" },
  ],
  contents: [
    { id: "co1", client_id: "c1", brand_id: "b1", title: "Yatak odası ilhamı — Reels", platform: "Instagram", content_type: "reels", status: "editing", planned_date: "2026-08-04", created_at: "2026-08-01" },
    { id: "co2", client_id: "c1", brand_id: "b1", title: "Ürün kombin — Carousel", platform: "Instagram", content_type: "post", status: "sent_to_client", planned_date: "2026-08-05", created_at: "2026-08-01" },
    { id: "co3", client_id: "c2", brand_id: "b2", title: "Doktor tanıtımı — Kardiyoloji", platform: "Instagram", content_type: "reels", status: "sent_to_client", planned_date: "2026-08-06", hook: "Merdiven çıkarken nefesiniz mi daralıyor?", script: SCRIPT_KARDIYOLOJI, created_at: "2026-07-30" },
    { id: "co4", client_id: "c3", brand_id: "b4", title: "Yeni ruj lansmanı", platform: "TikTok", content_type: "reels", status: "idea", planned_date: "2026-08-10", created_at: "2026-07-28" },
    { id: "co5", client_id: "c2", brand_id: "b3", title: "Global hasta deneyimi", platform: "YouTube", content_type: "video", status: "approved", planned_date: "2026-08-12", script: SCRIPT_GLOBAL, created_at: "2026-07-29" },
  ],
  shoots: [
    { id: "s1", client_id: "c1", brand_id: "b1", title: "Aytaş Home — Ürün Çekimi", shoot_type: "Ürün", scheduled_at: "2026-08-05T10:00", location: "Rast Stüdyo", status: "confirmed", created_at: "2026-07-28" },
    { id: "s2", client_id: "c2", brand_id: "b2", title: "Adatıp — Doktor Röportajı", shoot_type: "Röportaj", scheduled_at: "2026-08-07T14:00", location: "Adatıp Hastanesi", status: "planned", created_at: "2026-07-29" },
    { id: "s3", client_id: "c3", brand_id: "b4", title: "Mira — Kampanya Çekimi", shoot_type: "Kampanya", scheduled_at: "2026-08-11T11:00", location: "Dış mekan", status: "planned", created_at: "2026-07-30" },
  ],
  equipment: [
    { id: "e1", name: "Sony A7 IV", brand_model: "Sony", category: "Kamera", status: "idle", purchase_price: 95000, next_service: "2026-10-01", created_at: "2026-01-01" },
    { id: "e2", name: "Sony 24-70 GM II", brand_model: "Sony", category: "Lens", status: "reserved", purchase_price: 78000, created_at: "2026-01-01" },
    { id: "e3", name: "DJI RS 4 Gimbal", brand_model: "DJI", category: "Sabitleyici", status: "in_use", assigned_to: "Editör", purchase_price: 22000, created_at: "2026-02-01" },
    { id: "e4", name: "Aputure 300X", brand_model: "Aputure", category: "Işık", status: "idle", purchase_price: 34000, created_at: "2026-02-01" },
    { id: "e5", name: "DJI Mic 2", brand_model: "DJI", category: "Ses", status: "maintenance", purchase_price: 12000, next_service: "2026-08-10", created_at: "2026-03-01" },
    { id: "e6", name: "MacBook Pro M3 Max", brand_model: "Apple", category: "Bilgisayar", status: "assigned", assigned_to: "Berat", purchase_price: 145000, created_at: "2026-01-01" },
  ],
  invoices: [
    { id: "i1", client_id: "c1", invoice_no: "2026-081", issue_date: "2026-08-01", due_date: "2026-08-05", amount: 35000, vat: 7000, paid_amount: 42000, status: "paid", created_at: "2026-08-01" },
    { id: "i2", client_id: "c2", invoice_no: "2026-082", issue_date: "2026-08-01", due_date: "2026-08-01", amount: 60000, vat: 12000, paid_amount: 30000, status: "partial", created_at: "2026-08-01" },
    { id: "i3", client_id: "c3", invoice_no: "2026-079", issue_date: "2026-07-15", due_date: "2026-07-25", amount: 22000, vat: 4400, paid_amount: 0, status: "overdue", created_at: "2026-07-15" },
    { id: "i4", client_id: "c2", invoice_no: "2026-083", issue_date: "2026-08-02", due_date: "2026-08-15", amount: 18000, vat: 3600, paid_amount: 0, status: "issued", created_at: "2026-08-02" },
  ],
  // Tahsilatlar: faturalardaki paid_amount ile tutarlı (i1 tamamı, i2 yarısı)
  payments: [
    { id: "p1", invoice_id: "i1", amount: 42000, method: "Havale", paid_at: "2026-08-04", created_at: "2026-08-04" },
    { id: "p2", invoice_id: "i2", amount: 30000, method: "Havale", paid_at: "2026-08-10", created_at: "2026-08-10" },
  ],
  expenses: [
    { id: "x1", category: "Yazılım", vendor: "Adobe", amount: 3200, vat: 640, paid_at: "2026-08-01", is_recurring: true, description: "Creative Cloud", created_at: "2026-08-01" },
    { id: "x2", category: "Freelancer", vendor: "Seslendirme — Onur", amount: 4500, vat: 0, paid_at: "2026-08-02", is_recurring: false, description: "Adatıp video seslendirme", created_at: "2026-08-02" },
    { id: "x3", category: "Ulaşım", vendor: "—", amount: 1800, vat: 0, paid_at: "2026-08-02", is_recurring: false, description: "Çekim ulaşım", created_at: "2026-08-02" },
    { id: "x4", category: "Ekipman", vendor: "Kiralama", amount: 6000, vat: 1200, paid_at: "2026-07-30", is_recurring: false, description: "Ekstra ışık kiralama", created_at: "2026-07-30" },
  ],
  proposals: [
    {
      id: "pr1", client_id: "c2", title: "Hekim İçerik Sistemi — Standart", proposal_no: "RC-2026-001",
      status: "sent", currency: "TRY", vat_rate: 20, valid_until: "2026-10-31",
      notes: findPreset("hekim:standart")?.group.notes, terms: findPreset("hekim:standart")?.group.terms,
      created_at: "2026-10-01", updated_at: "2026-10-01",
    },
    { id: "pr2", client_id: "c1", title: "Aytaş Home — Aylık içerik paketi", proposal_no: "RC-2026-002", status: "accepted", currency: "TRY", vat_rate: 20, created_at: "2026-02-15", updated_at: "2026-02-20" },
    { id: "pr3", client_id: "c2", title: "Adatıp Global — Uluslararası içerik", proposal_no: "RC-2026-003", status: "accepted", currency: "TRY", vat_rate: 20, created_at: "2026-03-10", updated_at: "2026-03-14" },
    { id: "pr4", client_id: "c3", title: "Mira Kozmetik — Aylık sosyal medya", proposal_no: "RC-2026-004", status: "accepted", currency: "TRY", vat_rate: 20, created_at: "2026-06-20", updated_at: "2026-06-25" },
  ],
  proposal_items: [...demoProposalItems, ...demoAcceptedItems],
  // İçerik onayları (0013): biri hekim onayı bekliyor, biri onaylandı.
  content_approvals: [
    {
      id: "ca2", content_id: "co3", version: 1, token: DEMO_APPROVAL_TOKENS.pending,
      title: "Doktor tanıtımı — Kardiyoloji", script_snapshot: SCRIPT_KARDIYOLOJI,
      checklist: APPROVAL_CHECKLIST.map((i) => ({ ...i, checked: false })),
      status: "pending", sent_at: daysAgo(1), expires_at: expiresAtFrom(daysAgo(1)), created_at: daysAgo(1),
    },
    {
      id: "ca1", content_id: "co5", version: 1, token: DEMO_APPROVAL_TOKENS.approved,
      title: "Global hasta deneyimi", script_snapshot: SCRIPT_GLOBAL,
      checklist: APPROVAL_CHECKLIST.map((i) => ({ ...i, checked: true })),
      note: "Uygundur.", status: "approved",
      sent_at: daysAgo(5), expires_at: expiresAtFrom(daysAgo(5)), created_at: daysAgo(5),
      decided_at: daysAgo(4), decided_by_name: "Dr. Kemal Sarı",
    },
  ],
  // İşlem geçmişi örnekleri (canlıda 0012 trigger'ı yazar). En yeni önce.
  activity_logs: [
    { id: "al10", actor_name: "Berat", entity: "invoices", entity_id: "i2", record_label: "2026-082", action: "update", diff: { paid_amount: { old: 0, new: 30000 }, status: { old: "issued", new: "partial" } }, created_at: "2026-10-07T16:42:00+03:00" },
    { id: "al9", actor_name: "Berat", entity: "payments", entity_id: "p2", action: "insert", diff: { invoice_id: { old: null, new: "i2" }, amount: { old: null, new: 30000 }, method: { old: null, new: "Havale" }, paid_at: { old: null, new: "2026-08-10" } }, created_at: "2026-10-07T16:42:00+03:00" },
    { id: "al8", actor_name: "Ece", entity: "tasks", entity_id: "t3", record_label: "Dr. röportaj kurgusu", action: "update", diff: { status: { old: "in_progress", new: "internal_review" } }, created_at: "2026-10-07T11:05:00+03:00" },
    { id: "al7", actor_name: "Berat", entity: "proposals", entity_id: "pr1", record_label: "Hekim İçerik Sistemi — Standart", action: "update", diff: { status: { old: "draft", new: "sent" } }, created_at: "2026-10-06T18:20:00+03:00" },
    { id: "al6", actor_name: "Ece", entity: "expenses", entity_id: "x2", record_label: "Adatıp video seslendirme", action: "insert", diff: { category: { old: null, new: "Freelancer" }, vendor: { old: null, new: "Seslendirme — Onur" }, amount: { old: null, new: 4500 } }, created_at: "2026-10-06T10:12:00+03:00" },
    { id: "al5", actor_name: "Berat", entity: "jobs", entity_id: "j1", record_label: "Selin & Emre (Düğün)", action: "update", diff: { paid_amount: { old: 0, new: 14000 }, payment_status: { old: "unpaid", new: "partial" } }, created_at: "2026-10-05T15:30:00+03:00" },
    { id: "al4", actor_name: "Ece", entity: "expenses", entity_id: "x9", record_label: "Eski ekipman kirası", action: "delete", diff: { category: { old: "Ekipman", new: null }, amount: { old: 2500, new: null } }, created_at: "2026-10-04T09:48:00+03:00" },
    { id: "al3", actor_name: "Berat", entity: "projects", entity_id: "p3", record_label: "Mira — Yaz Kampanyası", action: "update", diff: { status: { old: "on_hold", new: "planning" }, end_date: { old: "2026-08-31", new: "2026-09-05" } }, created_at: "2026-10-03T14:02:00+03:00" },
    { id: "al2", actor_name: "Berat", entity: "proposals", entity_id: "pr1", record_label: "Hekim İçerik Sistemi — Standart", action: "insert", diff: { title: { old: null, new: "Hekim İçerik Sistemi — Standart" }, proposal_no: { old: null, new: "RC-2026-001" }, status: { old: null, new: "draft" } }, created_at: "2026-10-01T12:15:00+03:00" },
    { id: "al1", actor_name: "Berat", entity: "clients", entity_id: "c3", record_label: "Mira Kozmetik", action: "update", diff: { monthly_fee: { old: 20000, new: 22000 } }, created_at: "2026-10-01T09:30:00+03:00" },
  ],
};
