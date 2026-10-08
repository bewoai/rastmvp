# Rast OS — Ajans Operasyon Sistemi

Rast Creative için CRM + proje + içerik + prodüksiyon + finans yönetimini tek veri modelinde birleştiren ajans işletim sistemi (MVP).

## Teknoloji
- **Next.js 16** (App Router) + **React 19** + **TypeScript**
- **TailwindCSS v4** (dark-first marka teması, amber vurgu)
- **Supabase** (PostgreSQL + Auth + Storage + RLS)

## Kurulum
1. Bağımlılıklar:
   ```bash
   npm install
   ```
2. Supabase projesi oluşturun (https://supabase.com/dashboard).
3. Ortam değişkenleri:
   ```bash
   cp .env.example .env.local
   ```
   `NEXT_PUBLIC_SUPABASE_URL` ve `NEXT_PUBLIC_SUPABASE_ANON_KEY` değerlerini girin.
4. Veritabanı şeması: `supabase/migrations/` klasöründeki SQL dosyalarını numara sırasıyla Supabase → SQL Editor'de çalıştırın. Mevcut kurulumlarda yalnızca henüz uygulanmamış yeni migration dosyalarını çalıştırın.
5. İlk kullanıcı: Supabase → Authentication → Users'tan bir kullanıcı ekleyin. Otomatik olarak "Rast Creative" organizasyonuna `editor` rolüyle bağlanır; `profiles` tablosundan rolü `admin` yapın.
6. Geliştirme:
   ```bash
   npm run dev   # http://localhost:3000
   ```

> Not: Supabase yapılandırılmadan da uygulama açılır ve örnek verilerle önizleme gösterir (üstte kurulum uyarısı çıkar).

## Yapı
```
src/
├── app/
│   ├── (app)/           # Giriş yapılmış kabuk (sidebar + topbar)
│   │   ├── page.tsx      # Dashboard
│   │   ├── crm/ projects/ tasks/ content/ shoots/ finance/ equipment/ files/ settings/
│   ├── login/           # Giriş ekranı
│   └── auth/signout/    # Çıkış route'u
├── components/          # Sidebar, Topbar, AppShell, ui.tsx
└── lib/
    ├── supabase/        # client / server / middleware (proxy) helper'ları
    └── nav.ts           # menü yapısı
supabase/migrations/                # tam şema, RLS ve sürüm migration'ları
```

## Marka
- Renkler: near-black `#00000b`, beyaz `#fff`, amber `#b84203`
- Logolar: `public/brand/rast-white.svg` (ana), `rast-black.svg`, `rast-amber.svg`

## Yol Haritası
- **Faz 1 (MVP):** Dashboard, CRM, Projeler, İçerik, Çekimler, Finans, Ekipman, Dosyalar, Yetki, Hatırlatmalar
- **Faz 2:** Teklif/Sözleşme, Müşteri portalı, İçerik onay/revizyon, Freelancer, paket hak takibi
- **Faz 3:** Meta Ads / GA entegrasyonu, OCR, AI asistan, Drive otomasyonu

## Lead akışı (Growth Engine)

- **Web formu → CRM:** `POST /api/leads` (Web3Forms webhook'u) lead'i ekler/tekilleştirir ve "Lead'i 24 saat içinde ara: <ad>" görevi açar. Kurulum (migration 0017, `LEAD_WEBHOOK_SECRET`, `LEAD_INTAKE_ORG_ID`, Web3Forms webhook'u PRO plan ister): `supabase/migrations/README-0017.md`.
- **CRM → Potansiyel Müşteriler:** "Kaynak" sütunu + filtre (Hekim / Site / Manuel); son 48 saatte gelen ve arama görevi tamamlanmamış lead'lerde "Aranmadı · yeni" rozeti.

### Hedef klinik listesini içe aktarma

`scripts/data/` altında Sakarya / Kocaeli hedef klinik listesi (`hedef-klinik-listesi.md`, 2026-10-08 taraması) hazır:

| Dosya | İçerik |
| --- | --- |
| `hedef-klinikler-2026-10.csv` | 18 doğrulanmış aday → önce bunu içe aktar |
| `hedef-klinikler-2026-10-dogrulanacak.csv` | 7 "DOĞRULANACAK" satırı (web/Instagram/ilçe/kayıt teyit edilecek) → teyit sonrası, elle düzeltip aktar |

1. Uygulamada **İçe Aktar** → hedef olarak **Potansiyel Müşteriler** seç → CSV dosyasını yükle (UTF-8, BOM'lu; başlıklar otomatik eşleşir: Firma adı, Kaynak, Instagram, Web sitesi, İlgilendiği hizmet, Notlar).
2. **Önizleme / kuru çalıştırma** ekranında 18 "Ekle" satırını kontrol et, sonra **Uygula**. Aynı dosya tekrar yüklenirse aynı firmalar "tekrar" sayılıp atlanır.
3. Kayıtlar `Kaynak = Hekim hedef listesi (2026-10)` ile gelir → Potansiyel Müşteriler'de **Hekim** filtresinde görünür. Şehir, öncelik (ilk 10 için 1–10) ve ilk tarama notları **Notlar** alanındadır; branş **İlgilendiği hizmet**'tedir. Bu kayıtlar "gelen talep" olmadığı için "Aranmadı" rozeti almaz.

Dosyalarda yalnızca herkese açık iş bilgisi vardır (iş adı, branş, şehir/ilçe, web, herkese açık Instagram); telefon / e-posta / kişisel veri yok. Notlar içeride kullanım içindir (ön gözlemler, teyitsizdir); müşteriye veya üçüncü kişiye iletme. Toplu SMS/e-posta/DM yapılmaz: ilk temas tek, kişiye özel mesajdır.
