# rastmvp

Rast Creative ajans operasyon sistemi (Rast OS) MVP'si. Asıl uygulama `rast-os/` altında: Next.js 16 + React 19 + TypeScript + Tailwind 4 + Supabase (CRM, proje, içerik, çekim, finans, lead/müşteri bulma).

## Komutlar (`cd rast-os`)
```bash
npm install
cp .env.example .env.local   # değerleri doldur; Supabase yoksa demo verisiyle açılır
npm run dev                  # http://localhost:3000
npm run lint
npx tsc --noEmit
npm test                     # node --test, scripts/*.test.mjs (Node 22.18+)
npm run test:e2e             # Playwright
npm run build
npm run db:check | npm run ads:check
```
CI (`.github/workflows/ci.yml`): `main` push/PR'da lint, tsc, test, build (boş Supabase env ile demo modu).

## Yapı
- `rast-os/src/app/(app)/`: giriş yapılmış ekranlar; `rast-os/src/lib/supabase/`: client/server/proxy yardımcıları
- `rast-os/supabase/migrations/`: şema + RLS (numara sırasıyla uygulanır; `README-00xx.md` kurulum notları)
- `rast-os/docs/`: ads bağlantısı, lead bildirimi, müşteri bulma, performans
- `rast-os/AGENTS.md`: bu Next.js sürümü eğitim verisinden farklı; kod yazmadan önce `node_modules/next/dist/docs/` rehberini oku
- `_work/`: tek seferlik veri/finans içe aktarma betikleri
- Kökteki `ECC`, `claude-skills`, `andrej-karpathy-skills`, `creative-writing-skills`, `last30days-skill`: harici skill referansları (gitlink); uygulama kodu değil

## Kurallar
- `.env*` git'e girmez (yalnız `.env.example`). Sunucu anahtarları (`SUPABASE_SERVICE_ROLE_KEY`, Ads, SMTP, Places) client koduna sızmaz.
- `NEXT_PUBLIC_REQUIRE_AUTH` üretimde asla `false` değil.
- `OUTREACH_EMAIL_ENABLED` İYS kaydı olmadan açılmaz; müşteri bulmada otomatik gönderim yok.
- Yeni şema değişikliği = yeni numaralı migration; eskisini düzenleme.
