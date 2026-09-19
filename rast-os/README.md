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
