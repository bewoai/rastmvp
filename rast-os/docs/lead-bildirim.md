# Lead bildirimi (ekibe iç e-posta)

`POST /api/leads` bir lead'i başarıyla kaydettiğinde (yeni kayıt **veya** mevcut lead'e eklenen tekrar başvuru —
`lead_intake` RPC'sinin `duplicate` alanından anlaşılır) ekibe kısa bir Türkçe e-posta gider. Bu, ekibin kendi
kutusuna giden **iç bildirimdir** (ticari ileti değil); Müşteri Bulma'nın `OUTREACH_EMAIL_ENABLED` bayrağından
**bağımsızdır** ve o bayrak kapalıyken de çalışır.

## Nasıl çalışır

| Konu | Davranış |
| --- | --- |
| Tetik | Lead RPC ile kaydedildikten sonra, yanıt döndükten sonra (`after()` — Next 16'da kararlı; Vercel'de `waitUntil` ile). |
| Etkinleşme | `LEAD_NOTIFY_TO` (en az bir geçerli adres) **ve** `SMTP_*` tanımlıysa. Biri yoksa sessizce atlanır (log yok). |
| Hata | Lead kaydı ve yanıtı asla etkilenmez. En fazla 5 sn beklenir; hata/zaman aşımında yalnızca `console.error("[leads] bildirim gönderilemedi: <kısa kod>")` — ad, telefon, e-posta, mesaj loglanmaz. |
| Konu | Yeni: `Yeni lead: <ad> (<kaynak>)` · Tekrar başvuru: `Yeni lead (tekrar başvuru): <ad> (<kaynak>)`. CR/LF ve kontrol karakterleri temizlenir. |
| Gövde | Ad, telefon, e-posta, şirket/kurum, ilgi alanı, paket, kaynak, UTM, mesaj (en fazla 1000 karakter) ve Rast OS bağlantısı. Düz metin + basit HTML; HTML'de tüm girdi escape edilir. |
| Bağlantı | `https://mvp.rastcreative.com/crm/leads` (lead başına ayrı rota yok). `APP_BASE_URL` tanımlıysa onun altındaki `/crm/leads`. |
| Alıcılar | `LEAD_NOTIFY_TO`: virgül / noktalı virgül / boşlukla ayrılmış **çıplak** adresler (`Ad <adres>` biçimi desteklenmez); tekrarlar ve geçersizler atılır, en fazla 10. |

Kod: `src/lib/lead-notify.ts` (içerik + gönderim), `src/lib/mailer.ts` (Müşteri Bulma ile ortak SMTP yapılandırması
ve taşıyıcı), çağrı: `src/app/api/leads/route.ts`. Testler: `scripts/lead-notify.test.mjs` (ağsız).

## Zoho Mail SMTP ayarları

| Ayar | Değer |
| --- | --- |
| Sunucu (`SMTP_HOST`) | `smtp.zoho.eu` **veya** `smtp.zoho.com` — hesabın bulunduğu **veri merkezine** göre. Zoho'ya giriş adresi `mail.zoho.eu` ise `smtp.zoho.eu`, `mail.zoho.com` ise `smtp.zoho.com`. Yanlış sunucu "authentication failed" verir. |
| Port (`SMTP_PORT`) | `465` = SSL (uygulama örtük TLS açar) · `587` = TLS/STARTTLS (varsayılan). İkisi de çalışır; 465 önerilir. |
| Kullanıcı (`SMTP_USER`) | Gönderen hesabın tam adresi (ör. `bildirim@rastcreative.com`). |
| Parola (`SMTP_PASS`) | **Uygulama parolası** (Zoho hesabında iki adımlı doğrulama açıksa zorunlu; açık değilse de ayrı bir uygulama parolası kullanmak önerilir). Zoho → Hesabım (accounts.zoho.eu / .com) → Güvenlik → Uygulama Parolaları → yeni parola üret. Normal giriş parolası yazmayın. |
| Gönderen (`SMTP_FROM`) | `SMTP_USER` ile aynı adres ya da hesaba tanımlı bir takma ad (ör. `Rast OS <bildirim@rastcreative.com>`). Zoho başka bir adresten göndermeye izin vermez. |

> **Doğrulanmadı:** hesabın hangi veri merkezinde olduğu (`.eu` mı `.com` mu) ve gerçek SMTP bağlantısı bu
> değişiklik sırasında denenmedi (ağa çıkılmadı). Canlıya almadan önce aşağıdaki "Deneme" adımını yapın.
> Zoho'nun ücretsiz planında SMTP/IMAP erişimi kısıtlı olabilir; ücretli planda SMTP açıktır — hesabın planını kontrol edin.

## Vercel'e girilecek ortam değişkenleri (Production; yalnızca sunucu)

| Değişken | Not |
| --- | --- |
| `LEAD_NOTIFY_TO` | **Yeni.** Alıcılar, virgülle ayrılmış. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | Müşteri Bulma ile **aynı** değişkenler; zaten girildiyse tekrar gerekmez. |
| `LEAD_WEBHOOK_SECRET`, `LEAD_INTAKE_ORG_ID` | Lead girişi için zaten gerekli (README-0017). |
| `APP_BASE_URL` | İsteğe bağlı; e-postadaki Rast OS bağlantısının alan adı. |

`SMTP_*` tanımlı olması **Müşteri Bulma e-postasını açmaz**: o yalnızca `OUTREACH_EMAIL_ENABLED=true` ile çalışır
(varsayılan kapalı). Parola ve anahtar değerlerini repoya, vault'a veya bu belgeye yazmayın; yalnızca Vercel'e girin.

## Deneme

1. Vercel'e değişkenleri girin ve yeniden dağıtın (env değişikliği yeni dağıtım ister).
2. Sitedeki iletişim formundan (veya `curl` ile `x-rast-lead-secret` başlıklı `POST /api/leads`) deneme lead'i gönderin.
3. Gelen kutusunda `Yeni lead: …` e-postasını doğrulayın; aynı e-posta/telefonla ikinci kez gönderince `tekrar başvuru` konulu e-posta gelmelidir.
4. Gelmezse Vercel loglarında `[leads] bildirim gönderilemedi: <kod>` arayın: `EAUTH` (kullanıcı/parola veya yanlış veri merkezi),
   `ESOCKET`/`ETIMEDOUT`/`TIMEOUT` (sunucu/port/ağ), `REJECTED` (alıcı reddedildi), `SMTP 5xx` (gönderen adres izinli değil).
