import type { RastData } from "./types";

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
    { id: "co3", client_id: "c2", brand_id: "b2", title: "Doktor tanıtımı — Kardiyoloji", platform: "Instagram", content_type: "reels", status: "internal_review", planned_date: "2026-08-06", created_at: "2026-07-30" },
    { id: "co4", client_id: "c3", brand_id: "b4", title: "Yeni ruj lansmanı", platform: "TikTok", content_type: "reels", status: "idea", planned_date: "2026-08-10", created_at: "2026-07-28" },
    { id: "co5", client_id: "c2", brand_id: "b3", title: "Global hasta deneyimi", platform: "YouTube", content_type: "video", status: "script_ready", planned_date: "2026-08-12", created_at: "2026-07-29" },
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
  expenses: [
    { id: "x1", category: "Yazılım", vendor: "Adobe", amount: 3200, vat: 640, paid_at: "2026-08-01", is_recurring: true, description: "Creative Cloud", created_at: "2026-08-01" },
    { id: "x2", category: "Freelancer", vendor: "Seslendirme — Onur", amount: 4500, vat: 0, paid_at: "2026-08-02", is_recurring: false, description: "Adatıp video seslendirme", created_at: "2026-08-02" },
    { id: "x3", category: "Ulaşım", vendor: "—", amount: 1800, vat: 0, paid_at: "2026-08-02", is_recurring: false, description: "Çekim ulaşım", created_at: "2026-08-02" },
    { id: "x4", category: "Ekipman", vendor: "Kiralama", amount: 6000, vat: 1200, paid_at: "2026-07-30", is_recurring: false, description: "Ekstra ışık kiralama", created_at: "2026-07-30" },
  ],
};
