# Migration 0018 — Müşteri portalı (`client_portal_tokens`)

> **Durum: hiçbir veritabanına uygulanmadı.** Yazıldı ve gözden geçirildi; canlıya / staging'e
> dokunulmadı (yerelde Postgres yoktu, SQL çalıştırılmadı). **0017'den sonra** uygulanır; önce
> staging / branch veritabanında dene. 0013 (`approval_new_token()`, `content_approvals`), 0015
> (`clients_id_org_unique`, `client_reports`) ve 0012 (`log_activity()`) gerekir — ilk ikisi yoksa
> dosya en başta hata verip durur.

## Amaç

Hekim / müşteri giriş yapmadan, gizli bir bağlantıyla (`/portal/<token>`) kendi hesabının salt okunur
özetini görür:

- **Bu ay / geçen ay** içerikleri (tarih, başlık, kanal, durum, son onay durumu). Onayı bekleyen
  içerikte `/onay/<token>` sayfasına giden düğme.
- **Çekim günleri** (bu ay + geçen ay, iptal edilenler hariç).
- **Son rapor** (kayıtlı en son aylık rapor: öne çıkanlar, notlar) ve yazdırma görünümü
  `/portal/<token>/rapor/<yyyy-mm>`.

## Ne değişir

| Nesne | Açıklama |
| --- | --- |
| `client_portal_tokens` | `id, organization_id, client_id, token, label, contact_line, created_by, created_at, revoked_at, last_seen_at, expires_at`. `token` 64 hex (`gen_random_bytes(32)`, 256 bit), tekil, **her zaman sunucuda üretilir**. `(client_id, organization_id)` → `clients` bileşik FK, `on delete cascade`. |
| `client_portal_tokens_guard` | anon/authenticated için: INSERT'te `token`, `created_by`, `created_at` sunucu değeri; `revoked_at`, `last_seen_at` boş. UPDATE'te yalnızca `label`, `contact_line`, `expires_at` ve iptal (`revoked_at` null → `now()`); iptal geri alınamaz. |
| RLS | `to authenticated`, `organization_id = current_org_id()` (select / insert / update / delete). `anon` için tablo yetkileri tamamen kaldırıldı. |
| `portal_active_token(text)` | İç yardımcı (security definer). anon / authenticated çağıramaz. |
| `portal_get(p_token) → jsonb \| null` | **anon**. Müşteri adı, ajans adı, iletişim satırı, bu ay + geçen ay (Europe/Istanbul) içerikleri, onay bekleyenler (`pending`, ay sınırı yok) ve sayısı, çekimler, son kayıtlı rapor. |
| `portal_touch(p_token) → void` | **anon**. `last_seen_at = now()` (en sık 5 dakikada bir). |
| `portal_report_get(p_token, p_period 'YYYY-MM') → jsonb \| null` | **anon**. Yalnızca o ay için **kayıtlı** `client_reports` satırı varsa: rapor notları + o ayın içerik / çekim / onay kayıtları (rapor sayfası aynı `buildMonthlyReport` ile hesaplar). |
| Activity log | `log_activity()` INSERT / DELETE ve yalnızca `label, contact_line, revoked_at, expires_at` UPDATE'lerinde (portal açılışları log üretmez). |

İç ayna: `src/lib/portal-logic.ts` (`buildPortalPayload`) — demo modu ve `npm test` aynı kuralları
kullanır (ay pencereleri, onay bağlantısının yalnızca bekleyen sürümde açılması, iptal / süresi dolmuş
token reddi).

## Gizlilik / güvenlik notları

- **Portal bağlantısı bir sırdır.** Bağlantıya sahip herkes müşterinin içerik listesini, çekim
  günlerini ve kayıtlı raporlarını görür; **onay bekleyen içeriklerin onay bağlantılarına da ulaşır**
  (yani onay verebilir). Bağlantıyı yalnızca hekime / yetkili kişiye 1:1 gönderin (grup sohbeti değil).
- 256 bit token tahmin edilemez. Sayfa `noindex` + `Referrer-Policy: no-referrer` gönderir;
  geçersiz / iptal edilmiş / süresi dolmuş token için aynı "bulunamadı" ekranı görünür (neden ayırt
  edilmez).
- RPC'ler iç id, IP, `label`, onaylayanın IP'si, senaryo metni ya da başka müşterinin verisini
  döndürmez. `decided_by_name` (onaylayanın adı) rapor görünümünde yer alır — iç raporla aynı.
- Rapor görünümü yalnızca ajansın **kaydettiği** aylar için açılır; kaydedilmemiş bir ay paylaşılmaz.
- `last_seen_at` kişisel veri sayılabilir (KVKK): yalnızca "son görüntülenme" bilgisi tutulur, IP /
  cihaz bilgisi tutulmaz.
- Activity log INSERT diff'i token'ı içerir (0013 ile aynı); yalnızca aynı org üyeleri okur, arayüz
  token'ı `••••` olarak gösterir.

## İptal (revoke) akışı

1. Müşteriler → müşteri satırındaki **Müşteri sayfası** → **Portal** kartı → **İptal et** → onayla.
2. `revoked_at = now()` yazılır; bağlantı anında "bulunamadı" ekranına düşer (önbellek yok, sayfa her
   istekte RPC çağırır).
3. İptal geri alınamaz. Gerekirse **Yeni bağlantı oluştur** ile yeni token üretilir ve yeniden
   gönderilir. Eski bağlantı üzerinden açılmış onay sayfaları (`/onay/<token>`) kendi 14 günlük
   süreleriyle geçerli kalır; gerekiyorsa içerikten ayrıca **Geri çek** yapılır.

Acil durumda (SQL Editor, `postgres`):

```sql
update public.client_portal_tokens set revoked_at = now()
where client_id = '<müşteri uuid>' and revoked_at is null;
```

## Uygula

Supabase Dashboard → SQL Editor → `0018_client_portal.sql` → Run (önce staging). Idempotent.

Kontrol (uygulamadan, org üyesi olarak): Müşteri sayfası → Portal → **Bağlantı oluştur** → linki gizli
pencerede aç → "Bu ay" görünür; **İptal et** → link "bulunamadı" der. Sonra:

```sql
select client_id, label, created_at, last_seen_at, revoked_at from public.client_portal_tokens
order by created_at desc limit 5;
select public.portal_get('<token>');
select public.portal_report_get('<token>', '2026-09');
-- anon yetkisi: yalnızca üç RPC
select p.proname, has_function_privilege('anon', p.oid, 'execute') as anon_exec
from pg_proc p where p.proname like 'portal_%' or p.proname = 'client_portal_tokens_guard';
select has_table_privilege('anon', 'public.client_portal_tokens', 'select'); -- false
```

## Rollback

```sql
drop function if exists public.portal_report_get(text, text);
drop function if exists public.portal_touch(text);
drop function if exists public.portal_get(text);
drop function if exists public.portal_active_token(text);
drop table if exists public.client_portal_tokens;   -- tüm portal bağlantıları geçersiz olur
drop function if exists public.client_portal_tokens_guard();
```
