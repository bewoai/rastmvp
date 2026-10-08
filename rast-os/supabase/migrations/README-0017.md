# Migration 0017 — Lead girişi (web sitesi formu → CRM + arama görevi)

> **Durum: hiçbir veritabanına uygulanmadı.** Yazıldı ve gözden geçirildi; canlıya / staging'e
> dokunulmadı. Önce staging / branch veritabanında dene. Yalnızca 0001'e bağlıdır (leads, tasks,
> profiles); numara olarak 0015'ten sonra uygulanır. (0016 numarası kullanılmadı.)

## Amaç

Sitedeki iletişim formundan (`rastcreativesite/src/components/ContactForm.astro`) gelen talep, CRM'de
**kendiliğinden** potansiyel müşteri olur ve sorumluya "Lead'i 24 saat içinde ara: <ad>" görevi düşer.

```
Web3Forms (form + e-posta)  ──webhook (JSON)──▶  POST /api/leads  ──anon RPC──▶  lead_intake()  ──▶  leads + tasks
```

## Ne değişir

| Nesne | Açıklama |
| --- | --- |
| `leads.source_package`, `leads.source_utm` | Formdaki `paket` ve `utm_*` değerleri. `leads.source` = "Web sitesi" veya `kaynak=hekim` ise "Hekim sistemi (web sitesi)". |
| `tasks.lead_id` | Lead'e bağlı arama görevi (lead silinirse görev de silinir). CRM'deki "Aranmadı" rozeti bunu okur. |
| `lead_phone_key(text)` | Telefon tekilleştirme anahtarı: son 10 hane (+90 / 0 öneki fark etmez). `src/lib/lead-logic.ts` `phoneKey()` ile aynı kural. |
| `lead_intake_settings` | Org başına `token_hash` (SHA-256) + `default_owner_id`. RLS açık, politika yok → anon/authenticated göremez. |
| `lead_intake(p_org, p_payload, p_token)` | `SECURITY DEFINER`, anon çağırır. Sırrı doğrular → e-posta/telefonla tekilleştirir → lead ekler/günceller → arama görevi açar. Dönüş `{ok, lead_id, task_id, duplicate}`. |

**Neden 3. parametre (`p_token`)?** Anon key tarayıcı paketlerinde herkese görünür; yalnızca
`(p_org, p_payload)` alan bir `SECURITY DEFINER` RPC'yi herkes doğrudan çağırıp CRM'e çöp lead
yazabilirdi (Next route'undaki sır kontrolü atlanırdı). Bu yüzden RPC'nin kendisi de sırrı ister;
sır DB'de yalnızca SHA-256 olarak durur. Kod tabanında service-role kullanan bir desen olmadığı için
(`SUPABASE_SERVICE_ROLE_KEY` yalnızca `.env.example`'da) RPC yolu seçildi.

**Tekilleştirme:** aynı org içinde e-posta (küçük harf) **veya** telefon anahtarı eşleşirse yeni
lead açılmaz; mevcut lead'e `[GG.AA.YYYY] Yeni form talebi…` notu eklenir, boş alanlar doldurulur,
"kaybedildi" ise "yeni"ye döner, gecikmiş takip tarihi yarına çekilir. Açık bir arama görevi varsa
ikincisi açılmaz. Eşzamanlı çift gönderim `pg_advisory_xact_lock` ile tek kayda iner.

**Görev:** başlık `Lead'i 24 saat içinde ara: <ad>`, son tarih = yarın (Europe/Istanbul), öncelik
yüksek, sorumlu = `lead_intake_settings.default_owner_id` → yoksa org'un en eski aktif admin'i → yoksa
en eski aktif profil. Görev notuna telefon / e-posta / proje türü / kaynak yazılır.

## Uygulama adımları (sahip yapar)

1. **SQL Editor'de** `0017_lead_intake_rpc.sql` dosyasını çalıştır (idempotent).
2. **Sır üret** (≥ 32 karakter rastgele) ve hash'ini al — sırrı SQL'e yazmana gerek yok:
   ```bash
   node -e "const s=require('crypto').randomBytes(32).toString('hex');console.log('SECRET=',s);console.log('HASH=',require('crypto').createHash('sha256').update(s).digest('hex'))"
   ```
3. **Ayarı ekle** (SQL Editor, `<ORG_ID>` = `select id, name from organizations;`; `<HASH>` yukarıdaki HASH):
   ```sql
   insert into public.lead_intake_settings (organization_id, token_hash, default_owner_id)
   values ('<ORG_ID>', '<HASH>', null)          -- null = en eski aktif admin; istersen bir profiles.id yaz
   on conflict (organization_id) do update
     set token_hash = excluded.token_hash, default_owner_id = excluded.default_owner_id, updated_at = now();
   ```
4. **Vercel ortam değişkenleri** (Production + Preview; değerleri repoya yazma):

   | Değişken | Değer |
   | --- | --- |
   | `LEAD_WEBHOOK_SECRET` | 2. adımdaki `SECRET` (≥ 16 karakter; kısaysa endpoint 503 verir) |
   | `LEAD_INTAKE_ORG_ID` | 3. adımdaki `<ORG_ID>` (uuid) |
   | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | zaten var |

5. Deploy et, sonra uçtan uca dene:
   ```bash
   curl -sS -X POST https://<rast-os-alan-adi>/api/leads \
     -H "x-rast-lead-secret: $SECRET" -H "Content-Type: application/json" \
     -d '{"name":"Test Kişi","phone":"0532 000 00 00","kaynak":"hekim","paket":"standart","project_type":"Hekim İçerik Sistemi","utm_source":"test"}'
   # → {"ok":true,"leadId":"…","taskId":"…","duplicate":false}   (aynı komutu tekrarla → "duplicate":true, aynı leadId)
   ```
   CRM → Potansiyel Müşteriler'de "Hekim" rozetli lead ve Görevler'de yarına görev görünmeli. Test kaydını sil.

## Endpoint davranışı (`src/app/api/leads/route.ts`)

- Yetki: `x-rast-lead-secret` başlığı, `LEAD_WEBHOOK_SECRET` ile **sabit-zamanlı** karşılaştırılır.
  *Yedek:* `?secret=<SECRET>` sorgu parametresi — yalnızca webhook gönderen taraf özel başlık
  ekleyemiyorsa (aşağıya bak). URL'ler erişim loglarına düşebilir; mümkünse başlık kullan, yedeği
  kullanıyorsan sırrı periyodik değiştir.
- Gövde: `application/json`, `application/x-www-form-urlencoded` veya `multipart/form-data`; **en fazla 20 KB**
  (akış sınırlıdır, `Content-Length` yalansa da kesilir) → 413.
- Alanlar (form alan adları): `name`* (≥2), `company`, `phone`, `email`, `project_type`, `message`, `kaynak`, `paket`,
  `utm_source|medium|campaign|term|content`. En az geçerli bir telefon **veya** e-posta gerekir (formda telefon zorunlu).
  `botcheck` doluysa kayıt açılmaz, `{ok:true}` döner. Bilinmeyen alanlar (`access_key`, `subject`, …) yok sayılır.
  `kaynak` / `paket` yalnızca `[a-z0-9_-]{1,40}` olabilir.
- Hız sınırı: IP başına **30 istek/dk** (kayan pencere) → 429 + `Retry-After`. **Bellek içidir**: Vercel'de her
  örnek (instance) kendi sayacını tutar; yani sert bir kota değil, "hafif" bir fren. Asıl koruma sırdır.
- Yanıtlar: 200 `{ok, leadId, taskId, duplicate}`; 400 geçersiz alan; 401 sır yanlış; 413; 415 tanınmayan tür;
  429; 502 RPC hatası (kişisel veri loglanmaz); 503 yapılandırma eksik (fail-closed).
- `src/lib/supabase/middleware.ts`'te yalnızca **tam yol** `/api/leads` oturumsuz erişime açıldı.

## Web3Forms kurulumu — neyi doğruladım, neyi varsaydım

Kaynak: Web3Forms resmi dokümanları (docs.web3forms.com), 2026-10-08'de okundu. Fiyat / ürün sayfaları
(`web3forms.com/pricing`, `/integrations/webhooks`, blog) `403` döndürdüğü için **doğrudan okunamadı**;
oradaki bilgiler yalnızca arama sonucu özetlerinden.

**Doğrulandı (dokümandan):**
- Webhook, **PRO plan özelliğidir**: "You must have an active PRO plan subscription". Ücretsiz planda webhook yok.
- Dashboard → form → *Integrations* sekmesinde webhook'u açıp HTTPS URL'si girilir; her gönderimde
  **JSON POST** (`Content-Type: application/json`, `User-Agent: Web3Forms/1.0`) gider; tüm form alanları +
  `subject`, `from_name`, `submittedAt` içerir; `access_key`, `attachment`, `botcheck` vb. çıkarılır.
  Başarısız istekler otomatik yeniden denenir; uç nokta 30 sn içinde yanıt vermeli.
- Webhook için **imza / sır / özel başlık belgelenmemiş.** Dokümanda yalnızca gönderilen standart başlıklar var.
- Submissions API (`GET https://api.web3forms.com/v1/submissions`, `Authorization: Bearer w3f_live_…`,
  imleç sayfalama, 20 istek/sn) da **PRO** özelliğidir; her kayıtta `fields` nesnesi (form verisi) vardır.

**Doğrulanamadı / varsayım:**
- Sahibin hesabının hangi planda olduğunu bilmiyorum (ücretsiz plan varsayıldı: `ContactForm.astro` yalnızca
  `access_key` ile klasik gönderim yapıyor). PRO fiyatı arama özetinde ~12 $/ay geçiyor; **fiyat sayfası okunamadı**.
- Bir arama özeti dashboard'da "optional headers" alanından söz etti; resmi dokümanda bu **yok**. Başlık
  alanı varsa `x-rast-lead-secret: <SECRET>` ekle; yoksa `?secret=` yedeğini kullan veya aşağıdaki B/C'ye geç.
- Webhook'un kullanıcı arayüzünü ve gerçek bir gönderimi **ben denemedim** (hesap erişimim yok).

### Seçenekler

**A) Web3Forms PRO + webhook (önerilen, form koduna dokunmaz).** Integrations → Webhook → URL:
`https://<rast-os-alan-adi>/api/leads` (+ varsa başlık `x-rast-lead-secret`, yoksa `…/api/leads?secret=<SECRET>`).
E-posta bildirimi de çalışmaya devam eder (yedek kanal). Aynı kişi iki kez gelirse tekilleştirilir.

**B) Ücretsiz planda kalıp site formunu doğrudan `/api/leads`'e göndermek.** Tarayıcıdan çağrı için
(1) CORS (`OPTIONS` + `Access-Control-Allow-Origin: https://rastcreative.com`) eklenmeli — **bu dalda yok**;
(2) sır tarayıcıda görünür olur (gizli alan / JS). Bu yüzden *paylaşılan sırrı sayfaya koyma*; bunun yerine
**siteye özel, yalnızca bu uç noktaya yetkili ayrı bir token** kullan (ör. `LEAD_SITE_TOKEN`; sızarsa tek başına
yalnızca lead spam'i yazar ve döndürülür) ve Cloudflare Turnstile/hCaptcha ekle. Bu, ek geliştirme gerektirir;
şimdilik yapılmadı. Alternatif: formu Astro tarafında bir sunucu işlevi (Netlify/Vercel function) üzerinden
gönderip sırrı orada tutmak.

**C) Yoklama (poll).** PRO Submissions API ile bir Vercel Cron (`vercel.json` `crons`) dakikada/5 dakikada
`GET /v1/submissions?limit=100` çekip `/api/leads`'e yazabilir. Bu da PRO ister; webhook'tan avantajı yok
(gecikmeli, daha çok kod) — yalnızca webhook kullanılamıyorsa. Bu dalda **yazılmadı**.

**D) Ara katman (Pipedream / Make / Zapier).** Web3Forms'un ücretsiz planı webhook vermediği için bu da işe
yaramaz; PRO'da ise özel başlık gerekiyorsa araç başlığı ekleyip `/api/leads`'e iletebilir.

## Güvenlik notları

- `lead_intake` anon'a açık ama sırsız çalışmaz; yanlış sırla `42501`. Sır yalnızca sunucu env'inde; DB'de SHA-256.
- Sırrı döndürmek: yeni `SECRET`/`HASH` üret → 3. adımın `upsert`'ini çalıştır → Vercel env'i güncelle → yeniden deploy.
- Kişisel veri (ad/telefon/e-posta) yalnızca `leads` ve görev notunda tutulur; sunucu logları kişisel veri içermez.
- `lead_intake_settings`'e istemci erişemez (RLS açık, politika yok, yetkiler geri alındı).

## Rollback

```sql
drop function if exists public.lead_intake(uuid, jsonb, text);
drop table if exists public.lead_intake_settings;
drop index if exists public.idx_leads_org_email_key, public.idx_leads_org_phone_key, public.idx_tasks_lead;
drop function if exists public.lead_phone_key(text);
-- Veri kaybı olur (lead'lere bağlı arama görevleri ve kaynak ayrıntıları):
-- alter table public.tasks drop column if exists lead_id;
-- alter table public.leads drop column if exists source_package, drop column if exists source_utm;
```
Önce Vercel'den `LEAD_WEBHOOK_SECRET`'i kaldır (endpoint 503 verir) ve Web3Forms webhook'unu kapat.
