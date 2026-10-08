# Müşteri Bulma (Growth Engine)

İnsan onaylı B2B müşteri bulma modülü. Menü: **CRM → Müşteri Bulma** (`/musteri-bulma`) ve günlük ekran
**Bugün** (`/musteri-bulma/bugun`, telefondan kullanım için tasarlandı). Veri modeli ve kurulum:
`supabase/migrations/README-0019.md`. Mevzuat notu (vault): `07-Research/soguk-erisim-mevzuati.md`.

## Günlük akış (birincil — manuel kanallar)

1. **Keşfet** → "diş kliniği / Sakarya" gibi arama (Google Places) ya da **Hedef klinik listesini aktar (18)**.
   CSV adayları doğrudan **kalifiye** gelir; Places adaylarını seçip **Kalifiye et** ve **Siteleri tara**
   (işletmenin kendi sitesinden e-posta / Instagram / telefon).
2. **Bugün** → puanı en yüksek 10 kalifiye aday (son 14 günde temas edilmemiş, ertelenmemiş, ret listesinde değil).
   Her kartta: **Ara** (`tel:`), **WhatsApp** (wa.me + kişiselleştirilmiş Türkçe metin), **DM** (Instagram
   profili açılır, mesaj panoya kopyalanır), sektöre özel **20 saniyelik telefon metni**.
3. Ulaştıktan sonra kaydet: **Aradım / WhatsApp attım / DM attım** (temas geçmişine `manual = true` satırı),
   **Yanıt geldi** (CRM'de lead + "Lead'i 24 saat içinde ara" görevi), **İlgilenmiyor** (ret listesi; bir daha
   aranmaz / yazılmaz), **Sonra** (7 gün ertele). Üstte günlük sayaç ve seri (art arda temas yapılan gün).
4. Bugün temas edilen kart gün boyunca listede "yapıldı" olarak kalır; ertesi gün yerine yenisi gelir.

## E-posta (kodda hazır, varsayılan KAPALI)

`OUTREACH_EMAIL_ENABLED` tanımlı değilken (İYS kaydı bekleniyor): Diziler ve Onay kuyruğu çalışır, taslak
hazırlanır ve onaylanır, ama onay **planlamaz** ve cron **hiçbir e-posta göndermez**. Kuyrukta "E-posta
gönderimi kapalı (İYS kaydı bekleniyor)" bandı görünür. Açıldığında: onay → ilk uygun gönderim anı (hafta içi
09–18; pencere dışı onaylar sonraki iş günü 09:00'a planlanır), günlük cron (09:00 İstanbul) günlük limit (`DAILY_SEND_CAP`, vars. 20) ve ret listesine uyarak gönderir, her
gönderimden sonra sonraki adımı **taslak** olarak açar (yine insan onaylar). Her e-postada gönderen kimliği,
iletişim nedeni (B2B) ve tek tıkla ret bağlantısı + `List-Unsubscribe` başlıkları vardır.

## Neler OTOMATİK DEĞİL ve neden

| Ne | Neden |
| --- | --- |
| WhatsApp / Instagram gönderimi | Meta / WhatsApp / Instagram kuralları istenmeyen otomatik / toplu mesajı yasaklar; hesap kapatma riski. Uygulama yalnızca hazır metinle bağlantı açar, mesajı kişi gönderir. |
| Telefon araması | Kişi arar; uygulama yalnızca metni ve kaydı tutar. |
| E-posta taslağının onayı | Her ilk ileti ve her takip adımı insan onayı ister (cron onaysız mesaj göndermez; sonraki adımı da taslak açar). |
| E-posta gönderimi (şimdilik) | İYS kaydı ve ticari ileti onay / ret yönetimi tamamlanana kadar bayrakla kapalı. |
| Yanıt algılama | IMAP / webhook yok: "Yanıt geldi" elle işaretlenir (aşağıda takip işi). |
| Instagram / Facebook taraması | Hiç istek atılmaz; yalnızca işletmenin kendi sitesindeki bağlantılardan kullanıcı adı okunur. |

## Ortam değişkenleri (Vercel, yalnızca sunucu)

| Değişken | Gerekli mi | Not |
| --- | --- | --- |
| `GOOGLE_PLACES_API_KEY` | Keşif için | Yoksa keşif örnek (sahte) veriyle çalışır. Anahtarı Places API (New) ve sunucu IP / API kısıtıyla sınırlayın; bütçe uyarısı kurun. |
| `CRON_SECRET` | Evet (≥16 karakter) | Vercel Cron `Authorization: Bearer` başlığıyla gönderir; SHA-256'sı `outreach_settings`'e yazılır (README-0019). Places lat/lng temizliği için de gerekir. |
| `OUTREACH_EMAIL_ENABLED` | Hayır (vars. kapalı) | Yalnızca İYS kaydından sonra `true`. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | E-posta açılınca | Yoksa NoopMailer: hiçbir şey gönderilmez. 465 → TLS, diğerleri STARTTLS. |
| `DAILY_SEND_CAP` | Hayır (vars. 20) | 0–200. |
| `APP_BASE_URL` | Hayır | Ret bağlantısının alan adı; yoksa Vercel üretim alan adı. |

**Vercel planı (Hobby):** `vercel.json`'daki cron **günde bir kez** çalışır: `0 6 * * *` = 06:00 UTC = 09:00
İstanbul (Hobby saat içinde herhangi bir dakikada tetikler; saatlik ifade Hobby'de dağıtımı engeller). Tek çalışma
günün tüm kotasını parti parti gönderir; aynı gün tekrar tetiklenirse (elle `curl` dahil) kota aşılmaz ve aynı mesaj
iki kez gitmez. Takip adımları ve pencere dışı onaylar 09:00'a planlanır; geçici hatalar ertesi gün yeniden denenir.
Ayrıntı: `supabase/migrations/README-0019.md` → "Cron: günde bir kez".

## Google Places maliyeti (yaklaşık — Google'ın güncel fiyat sayfasında doğrulayın)

Mart 2025 Google Maps Platform fiyatlandırmasına göre (SKU başına aylık ücretsiz kota + 1.000 istek başına ücret):

| Kullanım | SKU (alan maskesine göre) | Yaklaşık ücret | Aylık ücretsiz |
| --- | --- | --- | --- |
| Keşfet araması (telefon, site, puan istenir) | Text Search **Enterprise** | ~35 $ / 1.000 istek; 1 istek = en fazla 20 sonuç (60 sonuç = 3 istek ≈ 0,11 $) | ~1.000 |
| Bugün kartları (≤10 aday, telefon + site) | Place Details **Enterprise** | ~20 $ / 1.000; sayfa açılışı başına ≤10 istek (≈ 0,20 $) | ~1.000 |
| Adaylar / kuyruk listesi (yalnızca ad + adres, sayfa başına ≤20) | Place Details **Pro** | ~17 $ / 1.000 | ~5.000 |
| Gönderim anında ad (e-posta açıkken) | Place Details **Pro** | mesaj başına 1 istek | — |

Örnek: ayda 20 arama × 3 sayfa (60) + 22 iş günü × 3 Bugün açılışı × 10 (660) + 100 liste sayfası × 20 (2.000)
→ çoğunlukla ücretsiz kotalar içinde. Places verisi saklanamadığı için her sayfa açılışı yeniden ücretlendirilir;
gereksiz yenilemeden kaçının. Google Cloud'da bütçe ve kota sınırı koyun.

## Veri kaynağı (özet)

Places içeriği saklanmaz (yalnızca `place_id` ve ≤30 gün lat/lng); ad / adres / telefon / site / puan her
gösterimde canlı çekilir ve gösterildiği yerde **Google Maps** atfı vardır. Saklanan iletişim bilgileri
işletmenin kendi sitesinden (`field_sources = website`) ya da elle (`manual`) gelir. Ayrıntı: README-0019.

## Takip işleri (yapılmadı)

- **Yanıt algılama:** IMAP (gönderen kutusunu okuyup `In-Reply-To` / `References` ile mesajı eşleştirme) veya
  sağlayıcı webhook'u (ör. gelen e-posta yönlendirme). Şimdilik elle "Yanıt geldi".
- **Bounce webhook'u:** SMTP sağlayıcısının kalıcı hata bildirimini `outreach_cron_result('bounced')` ile işlemek.
- **KVKK aydınlatma bağlantısı** (`https://rastcreative.com/kvkk`) ve **vaka bağlantıları** (`{{rast_vaka_link}}`,
  şimdilik `https://rastcreative.com`) sahip tarafından doğrulanmalı: `src/components/growth/GrowthChrome.tsx`,
  `src/lib/growth/logic.ts` → `CASE_LINKS`.
- 7 "DOĞRULANACAK" klinik (`scripts/data/hedef-klinikler-2026-10-dogrulanacak.csv`) teyit sonrası CSV yükle ile aktarılabilir.
