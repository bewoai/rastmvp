"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.IMPORT_TARGETS = void 0;
exports.coerce = coerce;
exports.norm = norm;
exports.IMPORT_TARGETS = [
    {
        key: "clients",
        label: "Müşteriler",
        defaults: { is_active: true },
        fields: [
            { name: "name", label: "Müşteri / firma adı", type: "text", required: true, aliases: ["firma adı", "firma", "ünvan", "müşteri", "müşteri / kaynak", "kaynak"] },
            { name: "tax_id", label: "Vergi no", type: "text" },
            { name: "monthly_fee", label: "Aylık ücret", type: "number", aliases: ["aylık tutar", "ücret", "tutar", "toplam gelir"] },
            { name: "payment_day", label: "Ödeme günü", type: "number" },
            { name: "contract_start", label: "Sözleşme başlangıç", type: "date" },
            { name: "contract_end", label: "Sözleşme bitiş", type: "date" },
            { name: "notes", label: "Notlar", type: "text" },
        ],
    },
    {
        key: "leads",
        label: "Potansiyel Müşteriler",
        defaults: { status: "new" },
        fields: [
            { name: "company_name", label: "Firma adı", type: "text", required: true, aliases: ["firma", "şirket", "müşteri", "kaynak"] },
            { name: "contact_person", label: "Yetkili kişi", type: "text", aliases: ["yetkili", "kişi", "ad soyad"] },
            { name: "phone", label: "Telefon", type: "text" },
            { name: "email", label: "E-posta", type: "text" },
            { name: "source", label: "Kaynak", type: "text" },
            { name: "interested_in", label: "İlgilendiği hizmet", type: "text" },
            { name: "est_budget", label: "Tahmini bütçe", type: "number" },
            { name: "next_followup_at", label: "Sonraki takip", type: "date" },
            { name: "notes", label: "Notlar", type: "text" },
        ],
    },
    {
        key: "contacts",
        label: "İletişim Kişileri",
        defaults: { is_approver: false },
        fields: [
            { name: "full_name", label: "Ad soyad", type: "text", required: true },
            { name: "client_id", label: "Müşteri (ada göre)", type: "text", clientLookup: true },
            { name: "title", label: "Ünvan", type: "text" },
            { name: "phone", label: "Telefon", type: "text" },
            { name: "email", label: "E-posta", type: "text" },
        ],
    },
    {
        key: "brands",
        label: "Markalar",
        defaults: {},
        fields: [
            { name: "name", label: "Marka adı", type: "text", required: true },
            { name: "client_id", label: "Müşteri (ada göre)", type: "text", clientLookup: true },
            { name: "tone", label: "Marka tonu", type: "text" },
            { name: "target_audience", label: "Hedef kitle", type: "text" },
            { name: "instagram", label: "Instagram", type: "text" },
            { name: "website", label: "Web sitesi", type: "text" },
        ],
    },
    {
        key: "jobs",
        label: "Tekil İşler",
        defaults: { status: "quote", payment_status: "unpaid", paid_amount: 0, price: 0 },
        fields: [
            { name: "customer_name", label: "Müşteri / kişi", type: "text", required: true },
            { name: "contact", label: "İletişim", type: "text" },
            { name: "service", label: "Hizmet / iş", type: "text" },
            { name: "job_type", label: "Tür", type: "text" },
            { name: "date", label: "Tarih", type: "date" },
            { name: "price", label: "Ücret", type: "number" },
            { name: "cost", label: "Maliyet", type: "number" },
            { name: "paid_amount", label: "Tahsil edilen", type: "number" },
            { name: "notes", label: "Notlar", type: "text" },
        ],
    },
    {
        key: "equipment",
        label: "Ekipmanlar",
        defaults: { status: "idle" },
        fields: [
            { name: "name", label: "Ekipman adı", type: "text", required: true, aliases: ["ekipman", "ürün", "cihaz", "malzeme"] },
            { name: "brand_model", label: "Marka / model", type: "text", aliases: ["marka", "model"] },
            { name: "category", label: "Kategori", type: "text" },
            { name: "purchase_price", label: "Değer", type: "number", aliases: ["birim fiyat", "fiyat", "tutar", "toplam"] },
            { name: "assigned_to", label: "Zimmet", type: "text" },
            { name: "next_service", label: "Sonraki bakım", type: "date" },
            { name: "notes", label: "Not", type: "text", aliases: ["not / ödeme", "açıklama"] },
        ],
    },
    {
        key: "expenses",
        label: "Giderler",
        defaults: { is_recurring: false, amount: 0, vat: 0, currency: "TRY", payment_status: "paid" },
        fields: [
            { name: "category", label: "Kategori", type: "text" },
            { name: "vendor", label: "Tedarikçi", type: "text", aliases: ["firma", "satıcı"] },
            { name: "currency", label: "Para birimi", type: "text", aliases: ["döviz", "döviz cinsi", "kur", "currency"] },
            { name: "amount", label: "Tutar", type: "number", required: true, aliases: ["aylık tutar", "gider", "fiyat", "toplam"] },
            { name: "vat", label: "KDV", type: "number" },
            { name: "paid_at", label: "Ödeme tarihi", type: "date", aliases: ["tarih", "ödeme"] },
            { name: "method", label: "Ödeme yöntemi", type: "text", aliases: ["ödeme durumu", "yöntem"] },
            { name: "installment_number", label: "Taksit no", type: "number", aliases: ["kaçıncı taksit"] },
            { name: "installment_total", label: "Toplam taksit", type: "number", aliases: ["taksit sayısı"] },
            { name: "description", label: "Açıklama", type: "text", aliases: ["hizmet", "kalem", "gider adı", "gider"] },
        ],
    },
    {
        key: "invoices",
        label: "Faturalar",
        defaults: { status: "issued", amount: 0, vat: 0, paid_amount: 0 },
        fields: [
            { name: "invoice_no", label: "Fatura no", type: "text" },
            { name: "client_id", label: "Müşteri (ada göre)", type: "text", clientLookup: true },
            { name: "amount", label: "Tutar", type: "number", required: true },
            { name: "vat", label: "KDV", type: "number" },
            { name: "paid_amount", label: "Tahsil edilen", type: "number" },
            { name: "issue_date", label: "Fatura tarihi", type: "date" },
            { name: "due_date", label: "Vade tarihi", type: "date" },
        ],
    },
];
/** Excel tarih/sayı/metin değerini alan tipine göre normalize eder */
function coerce(value, type) {
    if (value === null || value === undefined || value === "")
        return undefined;
    if (type === "number") {
        // Excel hücresi zaten sayıysa olduğu gibi kullan (en doğru yol)
        if (typeof value === "number")
            return value;
        let s = String(value).trim().replace(/[^\d.,-]/g, "");
        if (s.includes(",")) {
            // TR ondalık: "25.000,50" -> binlik "." at, "," -> "."
            s = s.replace(/\./g, "").replace(",", ".");
        }
        else if (s.includes(".")) {
            // Sadece "." var: binlik mi ondalık mı? Son grup 3 haneyse binlik say.
            const parts = s.split(".");
            const last = parts[parts.length - 1];
            if (parts.length > 2 || last.length === 3)
                s = s.replace(/\./g, "");
            // aksi halde (ör. "1249.02") ondalık nokta olarak bırak
        }
        const n = Number(s);
        return Number.isFinite(n) ? n : undefined;
    }
    if (type === "bool") {
        const s = String(value).trim().toLowerCase();
        return ["evet", "true", "1", "yes", "x", "✓"].includes(s);
    }
    if (type === "date") {
        // Excel seri numarası
        if (typeof value === "number") {
            const d = new Date(Math.round((value - 25569) * 86400 * 1000));
            return d.toISOString().slice(0, 10);
        }
        const s = String(value).trim();
        // GG.AA.YYYY veya GG/AA/YYYY
        const m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
        if (m) {
            const [, d, mo, y] = m;
            const yy = y.length === 2 ? "20" + y : y;
            return `${yy}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
        }
        const parsed = new Date(s);
        return isNaN(parsed.getTime()) ? undefined : parsed.toISOString().slice(0, 10);
    }
    return String(value).trim();
}
/** Başlık eşleştirme için normalize (küçük harf, TR karakter, boşluk temizle) */
function norm(s) {
    return s
        .toLocaleLowerCase("tr")
        .replace(/ı/g, "i").replace(/ş/g, "s").replace(/ğ/g, "g")
        .replace(/ü/g, "u").replace(/ö/g, "o").replace(/ç/g, "c")
        .replace(/[^a-z0-9]/g, "");
}
