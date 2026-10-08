# Reklam Hesabı Bağlantısı (Google Ads + Meta Ads)

Rast OS **Reklam Merkezi** (`/ads`) sayfası Google Ads ve Meta Ads performansını yalnızca **okuma** yetkisiyle çeker.
Bu rehber bağlantıyı yaklaşık **15 dakikalık aktif iş** olarak kurmanızı sağlar. (Google'ın geliştirici token'ı
onayı birkaç gün sürebilir; o süre beklemedir, sizin işiniz değildir. Önce Meta'yı bitirin.)

| Parça | Aktif süre | Bekleme |
| --- | --- | --- |
| Meta Ads (sistem kullanıcısı + token) | ~7 dk | yok |
| Google Ads (token + OAuth + refresh token) | ~8 dk | Basic Access onayı: birkaç iş günü |
| Vercel'e girme + doğrulama | ~3 dk | yeniden dağıtım ~1 dk |

Kod tarafında yapılacak bir şey yok: sunucu kodu (`src/lib/ads/server.ts`) ortam değişkenlerini okur. Değişkenler
eksikse `/ads` sayfası hata vermez, "bağlantı henüz kurulmadı" ekranını gösterir.

---

## 1. Meta Ads

Business Manager: **RAST Creative Studio** (business id `1560234758609535`).

### 1.1 Meta uygulaması (bir kerelik)

Sistem kullanıcısı token'ı üretebilmek için işletmeye bağlı bir Meta uygulaması gerekir.

1. https://developers.facebook.com/apps → **Create App**. Kullanım amacı **Other** → tür **Business**.
   Ad: `Rast OS`.
2. Uygulama panosunda **Add product → Marketing API → Set up**.
3. **App settings → Basic** içinde **Business account** olarak *RAST Creative Studio*'yu seçin (ya da
   Business settings → Accounts → **Apps** → *Add* ile uygulamayı işletmeye ekleyin).
4. Uygulama **Development** modunda kalabilir. Yalnızca kendi işletmenizin reklam hesaplarını okuduğunuz için
   App Review gerekmez.

> Zaten bir uygulamanız varsa yenisini açmayın; onu kullanın.

### 1.2 Sistem kullanıcısı

1. https://business.facebook.com/settings/?business_id=1560234758609535 → **Users → System users → Add**.
2. Ad: `Rast OS`. Rol: **Employee** (yeterli; Admin vermeyin). **Create system user**.
3. Kullanıcıyı seçip **Add assets → Ad accounts** ile şu hesapları ekleyin, izin olarak yalnızca
   **View performance** (ads_read karşılığı) işaretleyin; "Manage ad account" **vermeyin**:
   - **Rast** — `2599994690395691`
   - **Aytaş Home Outlet - Ana Reklam Hesabı** — `394712783155235`

   Aytaş hesabı size ortak (partner) varlık olarak paylaşıldığı için listede çıkmayabilir. Çıkmıyorsa
   Aytaş işletmesinin yöneticisinden şunu isteyin: *Business settings → Accounts → Ad accounts → Aytaş Home Outlet
   - Ana Reklam Hesabı → Assign partner → Business ID `1560234758609535` → en az "View performance"*.
   Paylaşım gelince adımı tekrarlayın.

### 1.3 Token üretme

1. System users → **Rast OS** → **Generate token**.
2. Uygulama: 1.1'de oluşturduğunuz `Rast OS` uygulaması.
3. **Token expiration: Never** (süresiz). 60 günlük seçenek bırakırsanız 60 günde bağlantı sessizce kopar.
4. İzinler:
   - `ads_read` (şart)
   - `read_insights` (şart; harcama/tıklama metrikleri için)
   - `business_management` (ilk kurulumda işaretleyin; hesap listesi çağrıları için gerekebilir. Çalıştığını
     doğruladıktan sonra gereksizse kaldırıp yeni token üretebilirsiniz.)
5. **Generate token** → token **yalnızca bir kez** gösterilir. Hemen kopyalayın, boşluk/satır sonu eklemeyin.
   Bu değer `META_ADS_ACCESS_TOKEN`'dır (Bölüm 3'te nereye gireceğiniz anlatılıyor).

### 1.4 Rast hesabı `UNSETTLED` (ödenmemiş bakiye)

Rast reklam hesabı şu an **UNSETTLED** durumunda. Ödenmemiş bakiye kapatılmadan Meta hesabın metriklerini
döndürmez; ayrıca Rast OS yalnızca durumu **ACTIVE** olan hesapları listeler (`src/lib/ads/server.ts` →
`getMetaAccounts`). Yani bakiye ödenene kadar `Rast` hesabı `/ads` sayfasında görünmez; Aytaş hesabı (ACTIVE ise)
etkilenmez.

Çözüm: **Ads Manager → Billing (Faturalama ve ödemeler)** → ödenmemiş tutarı ödeyin. Durum birkaç dakikada
ACTIVE'e döner. `npm run ads:check` hesap durumunu `UNSETTLED (3)` / `ACTIVE (1)` olarak gösterir.

---

## 2. Google Ads

### 2.1 Geliştirici token'ı (bekleme gerektirir; ilk bunu başlatın)

Geliştirici token'ı yalnızca bir **yönetici (MCC) hesabın** API Merkezi'nde bulunur.

1. Yönetici hesabınız yoksa https://ads.google.com/home/tools/manager-accounts/ ile oluşturup reklam hesaplarını
   bağlayın (Reklam hesabı → *Access and security → Managers* ya da MCC'den *Accounts → Link existing account*).
2. MCC'de **Tools (Araçlar) → Setup → API Center** (API Merkezi). Formu doldurun (kullanım: *kendi hesaplarımız
   için salt okunur raporlama*; araç iç kullanım).
3. Token hemen görünür ama durumu **Test account** (test hesabı erişimi) olur. Bu token **gerçek hesaplarda
   çalışmaz**: `DEVELOPER_TOKEN_NOT_APPROVED` hatası alırsınız. API Merkezi'nden **Basic Access başvurusu** yapın;
   onay birkaç iş günü sürer. Onay gelene kadar Google bölümü çalışmaz, Meta etkilenmez.
4. Token'ı `GOOGLE_ADS_DEVELOPER_TOKEN` olarak saklayın.

### 2.2 OAuth istemcisi (Google Cloud)

1. https://console.cloud.google.com → proje seçin/oluşturun (ör. `rast-os`).
2. **APIs & Services → Library → "Google Ads API" → Enable**.
3. **APIs & Services → OAuth consent screen**: Kullanıcı türü **External**, uygulama adı `Rast OS`, destek
   e-postası. Kapsam ekleme adımında `https://www.googleapis.com/auth/adwords` ekleyin. Test kullanıcısı olarak
   Google Ads erişimi olan hesabı ekleyin.
4. **Publishing status'ü "In production" yapın** (**Publish app**). Bunu yapmazsanız uygulama **Testing**
   modunda kalır ve **refresh token 7 günde geçersiz olur** (`invalid_grant`). "Google bu uygulamayı doğrulamadı"
   uyarısı iç kullanımda normaldir: *Advanced → Go to Rast OS (unsafe)* ile devam edebilirsiniz.
5. **APIs & Services → Credentials → Create credentials → OAuth client ID → Application type: Desktop app.**
   Oluşan **Client ID** ve **Client secret** değerlerini kopyalayın: `GOOGLE_ADS_CLIENT_ID`,
   `GOOGLE_ADS_CLIENT_SECRET`.

### 2.3 Refresh token (bir kerelik script)

`rast-os/.env.local` dosyasına yalnızca şu iki satırı yazın (dosya git'e girmez):

```
GOOGLE_ADS_CLIENT_ID=...
GOOGLE_ADS_CLIENT_SECRET=...
```

Sonra `rast-os` klasöründe:

```
node scripts/google-ads-oauth.mjs
```

Script yerel `http://127.0.0.1:53682` adresinde (yalnızca bu bilgisayardan erişilebilir) bekler ve bir adres
yazar. Adresi tarayıcıda açın, Google Ads erişimi olan hesapla giriş yapıp izin verin. Terminalde
`GOOGLE_ADS_REFRESH_TOKEN=...` satırı **bir kez** yazılır; hiçbir yere kaydedilmez. Kopyalayıp `.env.local`'a ve
Vercel'e ekleyin. Kaybederseniz scripti yeniden çalıştırmanız yeterlidir.

### 2.4 Login customer ID

`GOOGLE_ADS_LOGIN_CUSTOMER_ID`, API çağrılarının hangi hesap üzerinden yetkilendirileceğini belirler (10 hane,
**tire olmadan**; `123-456-7890` ise `1234567890`).

- Reklam hesapları bir **yönetici (MCC) hesabın altındaysa**: MCC'nin numarası.
- Tek başına bir reklam hesabıysa: o hesabın kendi numarası.

Yanlışsa `USER_PERMISSION_DENIED` / "login-customer-id" hatası alırsınız. `npm run ads:check` bunu Türkçe
anlatır.

---

## 3. Anahtarları nereye gireceğiniz

### 3.1 Vercel (canlı ortam)

Vercel → **rast-os** projesi → **Settings → Environment Variables**. Her anahtar için **Production** ve
**Preview** ortamlarını işaretleyin (Development'a gerek yok) ve mümkünse **Sensitive** seçeneğini açın.

| Anahtar | Zorunlu | Nereden |
| --- | --- | --- |
| `META_ADS_ACCESS_TOKEN` | Meta için evet | 1.3 |
| `META_ADS_API_VERSION` | hayır (varsayılan `v25.0`) | — |
| `GOOGLE_ADS_DEVELOPER_TOKEN` | Google için evet | 2.1 |
| `GOOGLE_ADS_CLIENT_ID` | Google için evet | 2.2 |
| `GOOGLE_ADS_CLIENT_SECRET` | Google için evet | 2.2 |
| `GOOGLE_ADS_REFRESH_TOKEN` | Google için evet | 2.3 |
| `GOOGLE_ADS_LOGIN_CUSTOMER_ID` | Google için evet | 2.4 |
| `GOOGLE_ADS_API_VERSION` | hayır (varsayılan `v25`) | — |

Ortam değişkenleri yalnızca **yeni** dağıtımda geçerli olur: kaydettikten sonra **Deployments → son
dağıtım → ⋯ → Redeploy** yapın.

`META_APP_ID` / `META_APP_SECRET` Vercel'e **gerekmez**; yalnızca isterseniz yerelde token ayrıntısını
(`debug_token`) görmek içindir.

### 3.2 Yerel (`rast-os/.env.local`)

Aynı anahtarları (`.env.example` şablonundaki "Google Ads" ve "Meta Ads" bloğu) `.env.local` dosyasına yazın.
Bu dosya `.gitignore` içindedir; asla commit etmeyin. Tırnak kullanmayın, değerin sonuna boşluk koymayın.

### 3.3 Doğrulama

```
npm run ads:check              # Meta + Google
node scripts/ads-check.mjs --meta
node scripts/ads-check.mjs --google
```

Çıktıda Meta için hesap tablosu (id, ad, durum, para birimi), Google için erişilebilir müşteri ID'leri ve
MCC altındaki hesaplar görünür. Hata varsa Türkçe açıklama ve çözüm yazar; çıkış kodu `1` olur. Bayraksız
çalıştırmada hiç ayarlanmamış sağlayıcı "atlandı" sayılır (ör. Google onayı beklerken Meta'yı doğrulayabilirsiniz).

Sonra uygulamada **Reklam Merkezi (`/ads`)** sayfasını açın. Sayfadaki sağlayıcı kartları bağlantı durumunu
gösterir:

- Sarı uyarı + "bağlantı henüz kurulmadı": değişkenler eksik (`getAdsConnectionStatus()` kaç tane
  eksik olduğunu bildirir). Not: bu durum yalnızca değişkenlerin **var olduğunu** denetler, geçerliliğini değil.
- Yeşil onay + "N hesap bağlı": çalışıyor.
- Kart yeşil değil ve hata metni var (ör. "bağlantısı yanıt vermedi (401)"): token geçersiz; ayrıntı için
  `npm run ads:check`.

---

## 4. Sık hatalar

| Belirti | Neden | Çözüm |
| --- | --- | --- |
| Meta: `Token geçersiz` / kod 190 | Token iptal edilmiş, eksik/fazla karakter | 1.3'ü tekrarlayın, değeri baştan yapıştırın |
| Meta: hesap listesi boş | Varlıklar sistem kullanıcısına atanmamış | 1.2 adım 3 (View performance) |
| Meta: `Rast` listede yok | Durum `UNSETTLED` | 1.4: bakiyeyi ödeyin |
| Meta: Aytaş görünmüyor | Partner erişimi verilmemiş | 1.2 notu: Aytaş yöneticisinden paylaşım isteyin |
| Google: `DEVELOPER_TOKEN_NOT_APPROVED` | Basic Access henüz onaylanmadı | 2.1: başvuru yapın, onayı bekleyin |
| Google: `invalid_grant` | OAuth onay ekranı "Testing" (7 gün) ya da erişim iptal | 2.2 adım 4 sonra 2.3'ü tekrarlayın |
| Google: `invalid_client` | Client ID/secret yanlış | 2.2 adım 5 |
| Google: `USER_PERMISSION_DENIED` | Login customer ID eksik/yanlış | 2.4 |
| Google: `Google Ads API has not been used...` | Cloud projesinde API kapalı | 2.2 adım 2 |
| `/ads` hâlâ "kurulmadı" diyor | Vercel'e girilmiş ama yeniden dağıtım yapılmamış | Redeploy (3.1) |

---

## 5. Güvenlik notları

- **Asgari yetki**: Meta'da Employee rolü ve yalnızca *View performance*; token'da yalnızca okuma izinleri.
  Google'da yalnızca `adwords` kapsamı; Rast OS hiçbir kampanyayı değiştirmez.
- **Sır asla commit edilmez**: `.env.local` git dışıdır. Token'ı sohbete, e-postaya, ekran görüntüsüne koymayın.
  `ads:check` ve `google-ads-oauth.mjs` token'ları kaydetmez; `ads:check` token değerini hiç yazdırmaz.
- **Meta token'ı** Authorization başlığıyla gönderilir; yine de uygulama günlüklerinde/hata raporlarında
  tam URL paylaşmayın.
- **Döndürme (rotate)**: Token'ı sızdırdığınızı düşünürseniz hemen iptal edin (Meta: sistem kullanıcısı →
  *Revoke tokens*; Google: myaccount.google.com/permissions'tan erişimi kaldırın, client secret'ı
  yenileyin) ve yenisini üretip Vercel'e girin. Düzenli aralıkla (ör. 6 ayda bir) yenileyin.
- **Kişi ayrılırsa**: Google refresh token'ı o kişinin hesabına bağlıdır. Ortak bir hizmet hesabı gibi
  tek bir kurumsal Google hesabıyla yetkilendirin (kişisel hesap değil).
- **Vercel**: değişkenleri *Sensitive* işaretleyin; yalnızca Production/Preview'a girin.
