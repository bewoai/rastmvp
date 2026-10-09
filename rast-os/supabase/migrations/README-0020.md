# Migration 0020 — `app_bootstrap` (tek istekte açılış verisi)

> **Durum: hiçbir veritabanında uygulanmadı.** Yalnızca yazıldı. **0019'dan sonra**, önce staging /
> branch veritabanında uygulanır.

## Neden

Tarayıcı → Supabase her tur ≈ 400 ms (soğuk başlangıçta 1–20 sn). Uygulama açılışta önce `profiles`'ı,
sonra sayfanın her koleksiyonunu ayrı `select *` ile çekiyordu: dashboard **15 istek / 3 ardışık tur**.
`app_bootstrap` profil + org hedefleri + istenen koleksiyonları **tek istekte** döndürür. Sayfa başına
tur sayıları: `docs/performans.md`.

## Ne değişir

- Yeni fonksiyon: `public.app_bootstrap(p_collections text[], p_since date default null) returns jsonb`
  - `security invoker`, `stable`, `set search_path = public` → **RLS aynen uygulanır**; başka org'un
    satırı dönmez (db-check iki org'lu fikstürle doğrular).
  - `p_collections` izin listesine göre doğrulanır (= `src/lib/store.ts` → `COLLECTIONS`; birim testi
    ikisini karşılaştırır). Listede olmayan / null ad → `22023`. Tablo adı `format('%I')` ile yazılır.
  - Yalnız `authenticated` çalıştırır (`anon` ve `public`'ten geri alındı).
- Tablo / RLS / veri değişikliği **yok**.

### Dönüş

```json
{
  "profile": { "organization_id": "…", "role": "admin", "full_name": "…" },
  "organization": { "mrr_target": 90000, "mrr_target_label": "…" },
  "since": "2025-04-09",
  "clients": [ { "id": "…", "…": "…" } ],
  "tasks": [ … ]
}
```

Satırlar `to_jsonb(satır)` — PostgREST `select *` ile aynı alanlar ve biçimler; `created_at desc` sıralı.

### Sınırlar (büyüyen tablolar)

| Tablo | Kural |
|---|---|
| `activity_logs` | En yeni 500 satır (istemcideki `ACTIVITY_LOG_LIMIT`) |
| `invoices` | Son 18 ay (`created_at` / `issue_date` / `due_date`) **veya** ödenmemiş/iptal değil **veya** pencerede ödemesi var |
| `payments` | Son 18 ay (`paid_at` / `created_at`) **veya** dönen bir faturaya bağlı (bakiye hesabı bozulmasın) |
| `expenses` | Son 18 ay **veya** tekrarlayan şablon (`is_recurring` — `expandRecurring` başlangıç tarihinden itibaren her ayı üretir, şablon eski olsa da gerekir) **veya** `payment_status = 'pending'` **veya** tarihsiz |
| `tasks` | Son 18 ay (`due_date` / `created_at`) **veya** `status <> 'done'` |
| `contents` | Son 18 ay (`planned_date` / `published_date` / `created_at`) **veya** yayınlanmamış / arşivlenmemiş |
| `jobs` | Son 18 ay (`date` / `created_at`) **veya** tarihsiz **veya** iptal değil ve (teslim edilmemiş ya da ödenmemiş) |
| `outreach_messages` | Son 18 ay (`created_at` / `sent_at` / `replied_at`) **veya** `draft` / `approved` / `scheduled` |
| Diğerleri | Tamamı |

`p_since` verilirse 18 ay yerine o tarih kullanılır (ör. `'2000-01-01'` → tüm geçmiş). Uygulama şu an
`p_since` göndermez. Etkisi: 18 aydan eski, kapanmış kayıtlar (ödenmiş fatura, bitmiş görev, yayınlanmış
içerik…) listelerde ve 18 aydan eski dönem raporlarında görünmez; dashboard / MRR / bu ve geçen yılın
raporları etkilenmez. Eski bir dönem gerekirse `p_since` ile istenir (ileride "tüm geçmiş" düğmesi).

> Not: 0020 uygulanmadan önceki eski yol (tablo tablo `select *`) bu sınırları uygulamaz — yalnızca
> `activity_logs` 500 satırla sınırlıdır (önceki davranış).

## Uygulanana kadar

Uygulama 0020 olmadan da çalışır: `app_bootstrap` çağrısı `PGRST202` (fonksiyon yok) dönerse istemci
eski yola düşer (profil + tablolar paralel `select *`, tek tur) ve bu sekmede RPC'yi bir daha denemez
(`sessionStorage` → `rast-os:bootstrap-rpc-missing`). Demo modu (Supabase env yok) etkilenmez.

## Uygula

Supabase Dashboard → SQL Editor → `0020_bootstrap_rpc.sql` → Run (önce staging). Idempotent
(`create or replace`). PostgREST şema önbelleği DDL sonrası kendiliğinden yenilenir; yenilenmezse:
`notify pgrst, 'reload schema';`

Çevrimdışı kontrol: `npm run db:check` (0020'yi iki kez uygular; yetki, izin listesi, geçersiz ad,
iki org RLS ve 18 ay kurallarını sınar).

## Son kontroller (uygulamadan, bir org üyesiyle)

- Tarayıcı DevTools → Network → sayfayı yenile: Supabase'e **tek** `POST /rest/v1/rpc/app_bootstrap`
  (eski: `profiles` + tablo başına bir `GET`). `NEXT_PUBLIC_DEBUG_PERF=1` ile konsolda
  `[perf] bootstrap: app_bootstrap (1 istek)` satırı.
- SQL Editor (postgres olarak; RLS'i atlar — yalnızca varlık/yetki için):
  ```sql
  select has_function_privilege('anon', 'public.app_bootstrap(text[],date)', 'execute');          -- false
  select has_function_privilege('authenticated', 'public.app_bootstrap(text[],date)', 'execute'); -- true
  ```
- İki farklı org'dan iki kullanıcıyla giriş: her biri yalnız kendi verisini görür.

## Geri alma

```sql
drop function if exists public.app_bootstrap(text[], date);
```
İstemci kendiliğinden eski yola döner (PGRST202).
