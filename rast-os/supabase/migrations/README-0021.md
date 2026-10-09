# Migration 0021 — `app_bootstrap` + ekip listesi (`profiles`)

> **Durum: hiçbir veritabanında uygulanmadı.** Yalnızca yazıldı. **0020'den sonra**, önce staging /
> branch veritabanında uygulanır.

## Neden

Görevlere ekip üyesi atanabilsin (Görevler: "Bana atanan / Herkes", Bugün: bana atanan + atanmamış).
İstemcinin org'daki üyeleri bilmesi gerekiyor; bunu **yeni bir istek turu açmadan** açılış isteğinin
(`app_bootstrap`) içinde almak için fonksiyonun izin listesine `profiles` eklenir.

## Ne değişir

- `public.app_bootstrap(text[], date)` **create or replace** ile yeniden tanımlanır (0020 dosyası
  değişmez). Tek fark: `profiles` koleksiyonu.
- `profiles` koleksiyonu yalnızca `id, full_name, role, is_active` döndürür (telefon, avatar vb. **dönmez**;
  `to_jsonb(satır)` kullanılmaz) ve yalnızca çağıranın org'unu (`organization_id = <çağıranın org'u>`).
  Ayrıca RLS (0001 `profiles_self`: `id = auth.uid() or organization_id = current_org_id()`) aynen
  uygulanır — fonksiyon hâlâ `security invoker`.
- Org'a bağlı olmayan kullanıcı → `profiles: []`.
- Yetkiler değişmez: yalnız `authenticated` çalıştırır, `anon` çalıştıramaz.
- Tablo / RLS / veri değişikliği **yok**.

## Geri uyumluluk (0021 uygulanmadan önce)

Uygulama 0021'i beklemez:

| Veritabanı | İstemci davranışı |
|---|---|
| 0020 + 0021 | `profiles` açılış RPC'sinde; ek istek yok |
| Yalnız 0020 | RPC `profiles`'ı `22023` ile reddeder → istemci o sekmede `profiles`'ı RPC'den çıkarır ve ekibi `profiles` tablosundan (yalnız `id, full_name, role, is_active`) **aynı turda, paralel** okur. İlk açılışta bir kez +1 tur, sonra +1 paralel istek |
| 0020 yok | Eski tablo-tablo yol; `profiles` da aynı turda (kolon kısıtlı) |

## Kontroller

Çevrimdışı: `npm run db:check` (PGlite) — 0021 grubu:

- org1 kullanıcısı org1 üyelerini görür, org2 üyesini görmez; org2 kullanıcısı yalnız kendi org'unu görür.
- Yalnız `id, full_name, role, is_active` anahtarları döner.
- Org'suz kullanıcı → `[]`; `anon` çağıramaz (42501); bilinmeyen koleksiyon → 22023.

Staging'de (uygulama + kullanıcı JWT'si ile; SQL Editor RLS'i atlar):

```sql
select has_function_privilege('anon', 'public.app_bootstrap(text[],date)', 'execute'); -- false
```

Uygulamada: Görevler → bir görevin sorumlu çipinden ekip üyesi seç → sayfayı yenile, atama kalır;
DevTools Network'te açılışta yine tek `rpc/app_bootstrap` isteği.

## Geri alma

0020 dosyasını yeniden çalıştırmak fonksiyonu eski haline döndürür (istemci yukarıdaki geri düşme yoluyla
çalışmaya devam eder).
