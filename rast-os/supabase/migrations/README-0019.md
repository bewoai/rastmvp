# Migration 0019 — Müşteri Bulma (Growth Engine)

> **Durum: hiçbir veritabanına uygulanmadı.** Önce staging / branch veritabanında dene.
> Bağımlılıklar: 0001, 0011 (`set_updated_at`), 0012 (`log_activity`, yoksa trigger atlanır),
> 0017 (`lead_phone_key`). 0018 başka dalda olabilir; 0019 ondan bağımsızdır. PG15+ ve `pgcrypto`
> (Supabase'de `extensions` şemasında hazır; 0013 de kullanıyor).
> Yerelde PGlite (Postgres 17, WASM) üzerinde 0001 → 0011 → 0012 → 0017 → 0019 (iki kez) çalıştırılıp
> RLS / guard / RPC senaryolarıyla denendi; gerçek bir Supabase projesine dokunulmadı.

## Amaç

İnsan onaylı B2B erişim. **Birincil akış manuel temastır:** aday bul (Google Places / CSV / manuel) →
puanla → "Bugün" listesinde günde ~10 aday → kişi kendisi arar / WhatsApp'tan yazar / Instagram DM atar →
uygulamada "Aradım / WhatsApp attım / DM attım" ile **kaydeder** (`outreach_messages`, `manual = true`,
`channel = phone | whatsapp | instagram`, `status = sent`). WhatsApp / Instagram için **otomatik gönderim
yok**; uygulama yalnızca önceden doldurulmuş bağlantı açar (wa.me / instagram.com + panoya kopyalanan metin).

E-posta dizisi altyapısı (onay kuyruğu → günlük cron → SMTP) kodda hazırdır ama **varsayılan KAPALIDIR**.

```
Keşfet (Places, canlı) ─┐
CSV / manuel ───────────┴─▶ prospects ─▶ Bugün (≤10 kart) ─▶ kişi arar / yazar ─▶ manuel temas kaydı
                                     └─▶ "Diziye ekle" ─▶ outreach_messages (draft) ─▶ insan onayı
                                                         │ (yalnızca OUTREACH_EMAIL_ENABLED=true iken planlanır)
            GET /api/growth/cron (günlük, CRON_SECRET) ─▶ outreach_cron_claim ─▶ SMTP ─▶ outreach_cron_result
                                                                                      └─▶ sonraki adım TASLAĞI (onaysız)
            Alıcı: e-postadaki ret bağlantısı ─▶ /api/growth/unsubscribe?t=… ─▶ outreach_unsubscribe()
```

## E-posta bayrağı: `OUTREACH_EMAIL_ENABLED` (varsayılan kapalı — İYS kaydı bekleniyor)

| | Bayrak kapalı (varsayılan) | `OUTREACH_EMAIL_ENABLED=true` |
| --- | --- | --- |
| Onay kuyruğu | Taslak hazırlanır, düzenlenir, onaylanır. Onay yalnızca `status = approved` yazar, **`scheduled_for` boş kalır**. Üstte "E-posta gönderimi kapalı (İYS kaydı bekleniyor)" bandı. | Onay `scheduled_for`'u doldurur (planlanan an ya da şimdi). Bayrak kapalıyken onaylananlar için "Onaylıları planla" düğmesi. |
| `GET /api/growth/cron` | Yalnızca Places lat/lng temizliği; **e-posta için hiçbir RPC çağrılmaz, hiçbir şey gönderilmez**. | Günlük limit + ret listesiyle gönderir. |
| DB güvencesi | `outreach_cron_claim` yalnızca `scheduled_for` dolu, `channel = 'email'`, `manual = false` mesajları alır. Bayrak sonradan açılsa bile, kapalıyken onaylanmış (planlanmamış) mesajlar kendiliğinden gitmez. | |

## Cron: günde bir kez (Vercel Hobby)

`vercel.json`: `{ "path": "/api/growth/cron", "schedule": "0 6 * * *" }` → her gün 06:00 UTC = **09:00 İstanbul**
(gönderim penceresinin başı). Vercel Hobby planı cron'u günde en fazla bir kez çalıştırır ve saat içinde herhangi bir
dakikada (06:00–06:59 UTC) tetikler; saatlik ifade Hobby'de dağıtımı engeller. Bu yüzden:

- **Tek çalışma günün tüm kotasını gönderir:** route `outreach_cron_claim`'i 25'lik partilerle, kota
  (`DAILY_SEND_CAP`) bitene / vadesi gelen kalmayana / ~75 sn süre bütçesi dolana dek tekrar çağırır.
- **İdempotent:** aynı gün ikinci tetikleme (Vercel'in yinelenen çağrısı, elle `curl`) kotayı aşamaz —
  `outreach_cron_claim` bugün (İstanbul) gönderilen + bugün talep edilen e-postaları kotadan düşer, yalnızca
  `approved` satırları alır ve org başına advisory lock tutar; `outreach_cron_result` yalnızca `scheduled` satıra
  yazar (aynı mesaj iki kez gönderilmez / sonraki adım taslağı iki kez açılmaz). `outreach_places_purge` zaten idempotent.
- **Planlama 09:00'a hizalı:** `nextSendSlot` pencere dışını sonraki iş gününün 09:00'ına, `nextStepDraft` takip
  adımını hedef günün 09:00'ına taşır → o günün tek çalışması mesajı vadesi gelmiş görür (gün kayması olmaz).
  Pencere içinde onaylanan mesaj (ör. 11:00) bir sonraki iş gününün çalışmasında gider.
- **Geçici hata** (`retry`, `scheduled_for = now() + 1 saat`) bir sonraki günün çalışmasında yeniden denenir.
- Pro planda daha sık çalıştırmak isterseniz ifadeyi değiştirmek yeterli; kota ve kilitler sıklıktan bağımsızdır.

Bayrağı açmadan önce: İYS kaydı, gönderen kimliği (`SMTP_FROM`), ret bağlantısının çalıştığı (aşağıdaki kontroller)
ve `07-Research/soguk-erisim-mevzuati.md` notu gözden geçirilmeli.

## Veri kaynağı (data-provenance) — Google Maps Platform Şartları 3.2.3(a)

Places API içeriği **saklanmaz / önbelleğe alınmaz**; yalnızca `place_id` süresiz, enlem/boylam en fazla 30 gün.

| Alan | Places adayında (`source = 'places'`) | Nereden |
| --- | --- | --- |
| `external_id` (place_id) | Saklanır (süresiz) | Places |
| `lat`, `lng`, `places_cached_at` | ≤ 30 gün; `outreach_places_purge()` (cron) siler | Places |
| Ad, adres, telefon, web sitesi, Google puanı, yorum sayısı, Maps bağlantısı | **Saklanmaz.** Liste / kartlarda Place Details ile canlı çekilir (sunucuda yalnızca istek içi bellek, istemcide yalnızca bileşen durumu; DB / localStorage yok). Gösterildiği yerde "Google Maps" atfı. | Places (canlı) |
| `email`, `instagram`, `phone` | Saklanabilir; `field_sources.<alan> = 'website'` | İşletmenin **kendi sitesi** (zenginleştirme) |
| `name`, `address`, `website`, … | Yalnızca elle girildiyse; `field_sources.<alan> = 'manual'` | Kullanıcı |
| `sector`, `city`, `district` | Saklanır | Kullanıcının **arama sorgusu** (Places yanıtı değil) |
| `score`, `score_breakdown` | Saklanır: yalnızca sayı + bant etiketleri ("Google puanı ≥ 4,5" gibi); Places metni / ham değer yok | Hesaplanan |
| Durum, notlar, sonraki eylem, temas geçmişi | Saklanır | Kullanıcı |

DB bunu `prospects_places_provenance` kısıtıyla zorlar: Places adayında ad / adres / site yalnızca `manual`,
telefon / e-posta / Instagram yalnızca `website` veya `manual` köken etiketiyle yazılabilir.
`outreach_messages.subject/body` **şablon** olarak (belirteçlerle) saklanır; `{{isim}}` gösterimde / gönderimde
canlı veriyle doldurulur. CSV'deki 18 klinik elle araştırılmış listedir (Places değil) → tüm alanlarıyla saklanır,
`qualified` olarak gelir. "Yanıt geldi" ile açılan CRM lead'inin alanları kullanıcının onayladığı formdan gelir.

`log_activity` trigger'ı `prospects`'e **bağlanmaz** (diff, lat/lng'yi `activity_logs`'a süresiz kopyalardı).

## Ne değişir

| Nesne | Açıklama |
| --- | --- |
| `prospects` | Aday işletme. `source` places / csv / manuel; `external_id` = Places `place_id` (org içinde tekil → tekrar keşifte güncellenir, çoğalmaz). `field_sources` alan kökeni; `lat` / `lng` / `places_cached_at` (≤30 gün). `score` 0-100 + `score_breakdown`. `status` new → qualified → queued → contacted → replied → converted / suppressed. `next_action_at` (erteleme / sonraki eylem), `last_contacted_at` (trigger yazar). `lead_id` → CRM lead (aynı org, bileşik FK). |
| `outreach_sequences` | E-posta dizisi: `steps` = `[{day, subject, body}]` (en fazla 10). Yalnızca `channel = 'email'`. |
| `outreach_messages` | Temas geçmişi (tüm kanallar). E-posta: aday + adım başına, `draft → approved → scheduled (gönderimde) → sent / bounced`, `sent → replied`, `cancelled`; aynı aday+dizi+adımda iptal edilmemiş tek kayıt. Manuel: `manual = true`, `channel` phone / whatsapp / instagram, yalnızca `sent` olarak eklenir (zaman sunucuda), yanlışsa silinerek geri alınır. Kısıt: `(channel = 'email') = (not manual)`. |
| `suppression_list` | Ret listesi: `kind` email / domain / phone (son 10 hane) + `reason` unsubscribe / bounce / manual / complaint. Silme yalnızca admin. |
| `outreach_settings` | Org başına `cron_token_hash` = SHA-256(CRON_SECRET) ve `unsub_key_hash` (ret bağlantısı HMAC anahtarı). RLS açık, politika yok → istemci göremez. |
| `outreach_messages_guard` | İstemci yazımları: yeni e-posta yalnızca draft / approved, manuel kayıt yalnızca sent; `sent_at` / `provider_message_id` istemciden yazılamaz; gönderilmiş mesaj düzenlenemez; onaylı mesaj düzenlenmeden önce taslağa alınmalı; izinli durum geçişleri; onayda alıcı zorunlu ve ret listesinde olmamalı; `approved_by = auth.uid()`. `scheduled_for`'u uygulama belirler (bayrak). |
| `outreach_messages_touch_prospect` | Temas (`sent`) → adayın `last_contacted_at`'i ve durumu (`contacted`). |
| `outreach_unsubscribe(p_token)` | anon. Token = `<message_id>.<hex(HMAC-SHA256(message_id, unsub_key_hash))>`. Ret listesine e-postayı ekler, o aday / adrese giden taslak + onaylı mesajları iptal eder, adayı `suppressed` yapar. İdempotent. |
| `outreach_cron_claim(p_token, p_cap, p_limit)` | anon (sunucu route'u). Sır = CRON_SECRET. Ret listesindekileri iptal eder; bugün (Europe/Istanbul) gönderilen + bugün talep edilmiş e-postaları sayıp `p_cap`'e kadar mesajı `scheduled` yapar; ret token'ı ile döndürür. |
| `outreach_cron_result(…)` | Sonucu yazar: `sent` (sonraki adım **taslağı** açılır), `bounced` (ret listesine `bounce`), `retry` (1 saat sonra tekrar). |
| `outreach_places_purge(p_token)` | Cron sırrıyla; 30 günü geçen lat/lng'yi siler. |
| Trigger'lar | `log_activity` sequences / messages / suppression_list'e (0012 varsa; prospects hariç); `set_updated_at` prospects / sequences. |

**Neden HMAC anahtarı "hash"?** 0017 deseninde sırrın kendisi DB'de durmaz. Burada ret bağlantısını DB'nin
kendisi doğrulamak zorunda olduğu için, rastgele bir sırrın SHA-256'sı **HMAC anahtarı olarak** saklanır
(sır hiçbir yerde tutulmaz). Bu değeri okuyan biri yalnızca *ret* bağlantısı üretebilir (zararsız yön:
birini listeden çıkarır). Tablo istemcilere tamamen kapalıdır.

## Kurulum (sahip yapar)

1. **SQL Editor'de** `0019_growth_engine.sql`'i çalıştır (idempotent).
2. **CRON_SECRET üret** ve hash'ini al (sırrı SQL'e yazma):
   ```bash
   node -e "const s=require('crypto').randomBytes(32).toString('hex');console.log('CRON_SECRET=',s);console.log('HASH=',require('crypto').createHash('sha256').update(s).digest('hex'))"
   ```
3. **Ayarı ekle** (`<ORG_ID>` = `select id, name from organizations;`):
   ```sql
   insert into public.outreach_settings (organization_id, cron_token_hash, unsub_key_hash)
   values (
     '<ORG_ID>', '<HASH>',
     encode(sha256(convert_to(gen_random_uuid()::text || gen_random_uuid()::text || clock_timestamp()::text, 'utf8')), 'hex')
   )
   on conflict (organization_id) do update
     set cron_token_hash = excluded.cron_token_hash, updated_at = now();   -- unsub anahtarı KORUNUR
   ```
4. **Vercel ortam değişkenleri** (Production; değerleri repoya yazma) — ayrıntı: `rast-os/docs/musteri-bulma.md`:
   `GOOGLE_PLACES_API_KEY` (yoksa keşif örnek veriyle çalışır), `CRON_SECRET` (Places temizliği için de gerekli).
   E-posta (yalnızca İYS kaydından sonra): `OUTREACH_EMAIL_ENABLED=true`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`,
   `SMTP_PASS`, `SMTP_FROM`, `DAILY_SEND_CAP` (vars. 20), isteğe bağlı `APP_BASE_URL`.
5. Deploy → Müşteri Bulma → Keşfet → "Hedef klinik listesini aktar (18)" ve Diziler → "Varsayılan şablonları ekle".

## Son kontroller

RLS'i SQL Editor'den değil uygulamadan (kullanıcı JWT'si) dene.

- Keşfet → arama → sonuçlar listelenir; aynı aramayı tekrarla → aday sayısı artmaz (place_id tekil).
  `select source, external_id, name, phone, website from prospects where source='places' limit 5;` → ad / telefon / site **boş**.
- Places adayına istemciden köken etiketi olmadan `website` yazmak → `prospects_places_provenance` ihlali.
- Bugün → bir kartta "WhatsApp attım" → `select channel, manual, status, sent_at from outreach_messages order by created_at desc limit 3;`
  ve adayın `last_contacted_at`'i dolu.
- Diziye ekle → Onay kuyruğunda taslak; onayla → `select status, approved_by, scheduled_for from outreach_messages order by created_at desc limit 5;`
  (bayrak kapalıyken `scheduled_for` boş).
- İstemciden `update outreach_messages set status='sent'` → 42501.
- Cron'u elle tetikle: `curl -H "Authorization: Bearer $CRON_SECRET" https://<alan-adi>/api/growth/cron` →
  bayrak kapalıyken `{"ok":true,"email":"disabled","purged":N}`; açıkken gönderilen mesajın sonraki adımı
  **taslak** olarak kuyrukta görünür.
- (Bayrak açıkken) gelen e-postadaki ret bağlantısını aç → "Listeden çıkarıldınız";
  `select * from suppression_list order by created_at desc limit 3;` Aynı adrese yeni taslak onaylanmaya çalışılınca reddedilir.

## Rollback

```sql
drop function if exists public.outreach_cron_result(text, uuid, text, text, text, jsonb);
drop function if exists public.outreach_cron_claim(text, integer, integer);
drop function if exists public.outreach_places_purge(text);
drop function if exists public.outreach_unsubscribe(text);
drop function if exists public.outreach_unsub_token(uuid, text);
drop table if exists public.outreach_messages;      -- guard / touch trigger'larıyla birlikte
drop function if exists public.outreach_messages_guard();
drop function if exists public.outreach_messages_touch_prospect();
drop table if exists public.outreach_sequences;
drop table if exists public.suppression_list;        -- DİKKAT: ret kayıtları kaybolur (yasal kanıt); önce dışa aktar
drop table if exists public.outreach_settings;
drop table if exists public.prospects;
drop function if exists public.outreach_is_suppressed(uuid, text, text);
alter table public.leads drop constraint if exists leads_id_org_unique;
```
Önce Vercel'den `CRON_SECRET`'i kaldır (cron 503 döner) ve `vercel.json`'daki cron'u sil.
