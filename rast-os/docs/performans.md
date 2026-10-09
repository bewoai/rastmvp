# Performans — veri yükleme tur sayıları

> Ölçüm: tarayıcı → Supabase REST ≈ **400 ms / tur** (DB yaklaştırılıyor; hedef yine de ≥ 60 ms),
> boşta kaldıktan sonraki ilk istek **1–20 sn** (soğuk başlangıç). Hızı belirleyen şey istek sayısından
> çok **ardışık tur (RTT) sayısı**: paralel istekler aynı turu paylaşır, ardışık olanlar toplanır.

## Ölçüm nasıl açılır

`.env.local` → `NEXT_PUBLIC_DEBUG_PERF=1` → `npm run dev` → tarayıcı konsolu, düzey **Verbose**
(console.debug). Satırlar `[perf] …: <ms> ms` biçimindedir; satır içeriği / kişisel veri yazılmaz.
Değişken yokken (üretim) kod ölçmez ve yazmaz.

| Etiket | Ne ölçer |
|---|---|
| `init: getSession` | Oturumun çerezden okunması (yerel; token süresi dolmuşsa 1 yenileme isteği) |
| `init: profiles` | Profil → organization_id sorgusu (1 tur) |
| `init: toplam` | Girişten "loaded" durumuna kadar |
| `load: <tablo>` | Tek tablonun `select *` süresi + satır sayısı |
| `load: toplam (paralel)` | Bir `load()` çağrısının tamamı + istek sayısı |

## Başlangıç durumu (kod okunarak sayıldı, `perf/hiz` öncesi)

Akış (Supabase modu, sayfa tam yüklenirken):

1. **Sunucu:** proxy `getClaims()` yerel (0 tur). `(app)/layout.tsx` görünen ad için `profiles` sorgusu →
   sunucu → Supabase **1 tur**, HTML'i (TTFB) bekletir.
2. **İstemci:** `init()` → `getSession()` (yerel) → `profiles` (**1 tur**) → ardından sayfanın
   `useHydrated([...])` listesindeki her koleksiyon için ayrı `select("*")` (paralel, **1 tur**, N istek).
3. Dashboard ve Ayarlar ek olarak `useOrgTargets` → `organizations` + `profiles(role)` (paralel, **+1 tur**).
4. Sayfalar arası geçiş: yalnızca henüz yüklenmemiş koleksiyonlar için **1 tur** (eksik yoksa 0).
   Pencereye geri dönüldüğünde hiçbir şey yenilenmez (veri sayfa yenilenene kadar bayat kalır).

| Sayfa | useHydrated koleksiyonları | İstek (tarayıcı → Supabase) | Ardışık tur | ≈ @400 ms | ≈ @60 ms |
|---|---|---|---|---|---|
| `/` Dashboard | 12 (jobs, invoices, payments, expenses, clients, equipment, shoots, tasks, contents, activity_logs, proposals, proposal_items) | 1 + 12 + 2 = **15** | **3** | 1,2 sn | 180 ms |
| `/teklifler` | proposals, proposal_items, clients | 1 + 3 = **4** | **2** | 0,8 sn | 120 ms |
| `/teklifler/[id]` | + projects | 1 + 4 = **5** | **2** | 0,8 sn | 120 ms |
| `/content` | contents, clients, brands, content_approvals | 1 + 4 = **5** | **2** | 0,8 sn | 120 ms |
| `/crm/clients` | clients, brands | 1 + 2 = **3** | **2** | 0,8 sn | 120 ms |
| `/crm/clients/[id]` | clients, brands, contacts, client_portal_tokens | 1 + 4 = **5** | **2** | 0,8 sn | 120 ms |
| `/crm/leads` | leads, tasks | 1 + 2 = **3** | **2** | 0,8 sn | 120 ms |
| `/crm/pipeline` | leads | 1 + 1 = **2** | **2** | 0,8 sn | 120 ms |
| `/crm/contacts` | contacts, clients, brands | 1 + 3 = **4** | **2** | 0,8 sn | 120 ms |
| `/crm/brands` | brands, clients | 1 + 2 = **3** | **2** | 0,8 sn | 120 ms |
| `/finance/invoices` | invoices, payments, clients, jobs | 1 + 4 = **5** | **2** | 0,8 sn | 120 ms |
| `/finance/expenses` | expenses | 1 + 1 = **2** | **2** | 0,8 sn | 120 ms |
| `/musteri-bulma` | prospects, outreach_sequences, outreach_messages, suppression_list, leads, tasks | 1 + 6 = **7** (+ `/api/growth/status`) | **2** | 0,8 sn | 120 ms |
| `/musteri-bulma/bugun` | prospects, outreach_messages, suppression_list, leads, tasks | 1 + 5 = **6** (+ status) | **2** | 0,8 sn | 120 ms |
| `/raporlar/aylik` | clients, contents, shoots, content_approvals, client_reports | 1 + 5 = **6** | **2** | 0,8 sn | 120 ms |
| `/raporlar/aylik/…/yazdir` | + brands | 1 + 6 = **7** | **2** | 0,8 sn | 120 ms |
| `/tasks` | tasks, projects | 1 + 2 = **3** | **2** | 0,8 sn | 120 ms |
| `/projects` | projects, clients, tasks, brands | 1 + 4 = **5** | **2** | 0,8 sn | 120 ms |
| `/jobs`, `/equipment`, `/settings/islem-gecmisi` | 1 tablo | 1 + 1 = **2** | **2** | 0,8 sn | 120 ms |
| `/shoots` | shoots, clients, brands | 1 + 3 = **4** | **2** | 0,8 sn | 120 ms |
| `/settings` | — (+ org hedefleri) | 1 + 2 = **3** | **2** | 0,8 sn | 120 ms |
| `/import` | 8 tablo | 1 + 8 = **9** | **2** | 0,8 sn | 120 ms |

Notlar:

- Tablo yalnızca tarayıcı → Supabase'i sayar. Her tam yüklemede buna sunucudaki layout `profiles`
  turu (TTFB) ve JS indirme / hydration eklenir.
- Soğuk başlangıçta (1–20 sn) her ayrı istek gecikmeye yakalanabilir; 15 istekli dashboard en kötü durumda.
- Hiçbir sorguda sayfalama / kolon seçimi yok: faturalar, ödemeler, giderler, görevler, içerikler, işler,
  e-posta mesajları zamanla büyüdükçe yük de büyür (yalnızca `activity_logs` 500 satırla sınırlı).
- Sayfa geçişi örnekleri: Dashboard → İçerik: brands + content_approvals (2 istek, 1 tur);
  Dashboard → Müşteri Bulma: 5 istek, 1 tur; Dashboard → Teklifler: 0 tur.

## Değişiklikler (`perf/hiz`)

### 1) Açılış RPC'si — `app_bootstrap` (0020)

- `init()` + ilk `load()` birleşti: `getSession()` (yerel) → **tek** `rpc('app_bootstrap', { p_collections })`.
  Yanıt profili (org, rol, ad) ve org hedeflerini de içerir → ayrı `profiles` sorgusu yok; Dashboard ve
  Ayarlar'daki `useOrgTargets` da ek istek atmaz.
- Aynı commit'te (sayfa + kabuk bileşenleri) istenen tüm koleksiyonlar bir mikro-görevde toplanır,
  tek RPC'de çekilir. Sonradan istenenler (sayfa geçişi) yine tek RPC. Uçuştaki koleksiyon ikinci kez istenmez.
- Büyük tablolarda son 18 ay + açık kayıtlar (README-0020); `activity_logs` 500.
- **0020 uygulanmamışsa** (`PGRST202`): eski yola düşülür, ama profil artık tablolarla **paralel**
  (RLS org'u zaten bilir) → 2 tur yerine 1 tur (+ ilk RPC denemesi; sekme başına bir kez).
- Yenileme sırasında yapılan yerel değişiklikler (ekle/güncelle/sil) ezilmez: `mergeRows` + değişiklik sırası.
- Demo modu (Supabase env yok) aynı: bellek içi örnek veri, ağ yok.

### 2) Erken ve toplu ön yükleme

- **AppShell modülü yüklenir yüklenmez** (sayfa bileşenleri mount olmadan, hydration sürerken) açılış
  isteği başlar: `prefetchBootstrap(location.pathname)`.
- İstenen küme = **çekirdek** (dashboard'un 12 koleksiyonu + brands, projects, leads, contacts) ∪ açılan
  sayfanınkiler (`bootstrap-logic.ts → routeCollections`; birim testi her sayfanın `useHydrated`
  listesinin kapsandığını doğrular). Böylece Dashboard, Teklifler, CRM, Finans, Görevler, Projeler,
  Çekimler, İşler, Ekipman arasında gezinti **0 tur**.
- Çekirdek dışı sayfalar (İçerik onayları, Müşteri portalı, Raporlar, Müşteri Bulma, İşlem geçmişi):
  bağlantının üzerinde ~120 ms durunca / klavye odağında eksik koleksiyonlar tek RPC ile önceden istenir
  → çoğu zaman tıklama anında hazır.
- **Giriş:** şifre doğrulanınca açılış RPC'si hemen başlar ve `router.replace("/")` ile istemci tarafı
  yönlendirme yapılır → sayfa (RSC) ve veri paralel gelir (önceden: tam sayfa yükleme + JS + sonra veri).
  Giriş sayfası açılınca bellekteki önceki oturum verisi sıfırlanır (`resetSession`).

### 3) Stale-while-revalidate (sessionStorage)

- Store her değiştiğinde (~1 sn sonra, sayfa kapanırken hemen) yüklenmiş koleksiyonlar + profil + org
  hedefleri **sekme oturumuna** (`sessionStorage`, anahtar kullanıcıya göre, içinde org) yazılır.
  `localStorage` kullanılmaz: veri sekme kapanınca gider.
- Sayfa yenilenince / yeni sekmede değil aynı sekmede tekrar açılınca: `getSession()` (yerel) → anlık görüntü
  **0 istekle** hemen ekranda; arka planda tek `app_bootstrap` ile tazelenir (yerel değişiklikler korunur,
  başka yerde silinen kayıtlar düşer, org değiştiyse her şey atılır).
- Koruma: 2 MB üstü yazılmaz (varsa eskisi silinir); 12 saatten eski, başka kullanıcıya ait, sürümü farklı
  ya da bozuk kayıt gösterilmez; bilinmeyen koleksiyon anahtarı store'a alınmaz.
- Silinir: **Çıkış yap** (form gönderilirken), giriş sayfası açılınca, oturum düşünce (`SIGNED_OUT` /
  getSession boş).

### 4) Pencereye dönüşte tek istekle tazeleme

- Sekmeye / pencereye dönülünce (`focus`, `visibilitychange`) son başarılı çekimden **> 60 sn** geçtiyse
  yüklü TÜM koleksiyonlar + profil + org hedefleri **tek** `app_bootstrap` ile tazelenir (önceden: hiç
  yenilenmiyordu; sayfa yenilenene kadar başkalarının değişiklikleri görünmüyordu).
- Çekim sürerken / açılış bitmeden no-op; iki olay aynı anda gelse de tek istek.
- Yerel değişiklikler korunur; başka yerde silinen kayıtlar düşer.

## Sonrası — sayfa başına tur sayısı (0020 uygulandıktan sonra)

Tarayıcı → Supabase, sayfa **tam yüklenirken** (yeni sekme / ilk giriş). Her sayfada istek kümesi =
çekirdek (16 koleksiyon) ∪ sayfanınkiler, **tek** `app_bootstrap`.

| Sayfa | Önce: istek / tur | Sonra: istek / tur | ≈ @400 ms (önce → sonra) | Aynı sekmede yenileme |
|---|---|---|---|---|
| `/` Dashboard | 15 / 3 | **1 / 1** | 1,2 sn → 0,4 sn | 0 tur (anlık görüntü) + 1 arka plan |
| `/teklifler`, `/teklifler/[id]` | 4–5 / 2 | **1 / 1** | 0,8 → 0,4 sn | 0 + 1 |
| `/content` | 5 / 2 | **1 / 1** | 0,8 → 0,4 sn | 0 + 1 |
| `/crm/*` (müşteriler, lead, pipeline, kişiler, markalar) | 2–5 / 2 | **1 / 1** | 0,8 → 0,4 sn | 0 + 1 |
| `/finance/invoices`, `/finance/expenses` | 5 / 2, 2 / 2 | **1 / 1** | 0,8 → 0,4 sn | 0 + 1 |
| `/musteri-bulma`, `/bugun` | 7 / 2, 6 / 2 (+status) | **1 / 1** (+status) | 0,8 → 0,4 sn | 0 + 1 |
| `/raporlar/aylik` (+ yazdır) | 6–7 / 2 | **1 / 1** | 0,8 → 0,4 sn | 0 + 1 |
| `/settings` | 3 / 2 | **1 / 1** | 0,8 → 0,4 sn | 0 + 1 |
| Diğerleri (tasks, projects, jobs, shoots, equipment, işlem geçmişi, import) | 2–9 / 2 | **1 / 1** | 0,8 → 0,4 sn | 0 + 1 |

Sayfa geçişi (istemci tarafı):

| Geçiş | Önce | Sonra |
|---|---|---|
| Çekirdek sayfalar arası (Dashboard, Teklifler, CRM, Finans, Görevler, Projeler, Çekimler, İşler, Ekipman) | 0–1 tur (eksik tablo başına istek) | **0 tur** |
| Çekirdek dışına (İçerik, Raporlar, Müşteri Bulma, İşlem geçmişi, müşteri detayı) | 1 tur, 1–5 istek | bağlantı üzerinde ~120 ms durulduysa **0**, değilse **1 tur / 1 istek** |
| Pencereye dönüş (> 60 sn) | hiçbir şey (veri bayat) | **1 istek** ile tüm yüklü veri tazelenir |
| Giriş → Dashboard | tam sayfa yükleme, sonra 3 tur | RPC şifre doğrulanınca başlar, sayfa ile **paralel** |

**0020 uygulanmadan önce** (geçiş dönemi): ilk yüklemede 1 RPC denemesi (404) + profil ve tablolar paralel
→ **2 tur** (önce 2–3); sekmenin sonraki yüklemelerinde RPC denenmez → **1 tur**; yenilemede anlık görüntü → 0.

Gecikme ≥ 60 ms'e düştüğünde: Dashboard 180 ms → 60 ms; anlık görüntülü yenileme her durumda ağ beklemesiz.

### Yerel doğrulama (sahte Supabase, yalnız 127.0.0.1)

Üretim derlemesi `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54399` (istekleri sayan sahte sunucu) ile
çalıştırıldı; uzak hiçbir yere bağlanılmadı. Tarayıcı → Supabase istekleri:

| Senaryo | Gözlenen |
|---|---|
| Dashboard ilk yükleme | `POST rpc/app_bootstrap` × **1** (16 koleksiyon); `organizations` / `profiles` isteği yok |
| Dashboard → Markalar | **0** |
| Markalar → İçerik | **1** RPC (`["content_approvals"]`) |
| İçerik sayfası yenileme | anlık görüntü getSession'dan 2 ms sonra ekranda; **1** arka plan RPC |
| Pencereye dönüş (< 60 sn / > 60 sn; focus + visibilitychange birlikte) | 0 / **1** RPC |
| RPC yok (PGRST202) | 404 → profil + 16 tablo paralel; sonraki sayfa geçişinde RPC tekrar denenmedi |
| Giriş | `token` → hemen `rpc/app_bootstrap`, sayfa paralel geldi |
| Çıkış | sessionStorage anlık görüntüsü silindi |

(Sunucu tarafındaki `auth/v1/user` istekleri sahte sunucunun HS256 jetonundan; üretimde ES256 ile `getClaims`
yereldir. `(app)/layout.tsx`'teki görünen ad için `profiles` sorgusu sunucu tarafında kaldı — bkz. Kalan işler.)

## `feat/gunluk-kullanim` sonrası

- **Sunucu `profiles` turu kaldırıldı:** `(app)/layout.tsx` artık görünen ad için Supabase'e gitmiyor (her tam
  yüklemede TTFB'den 1 tur düştü). İlk ad yerel doğrulanan JWT claims'ten (`user_metadata.full_name`, yoksa
  e-posta); kesin ad açılış yanıtındaki profilden (Topbar → `store.profile.full_name`). Giriş koruması
  değişmedi: proxy (`updateSession` → `getClaims`, oturumsuz → `/login`).
- **Çekirdek küme 16 → 18 koleksiyon:** + `profiles` (ekip listesi, görev atama; 0021) ve `content_approvals`
  (bildirim zili: müşterinin kararı). İkisi de **aynı** açılış isteğinde; yeni tur yok. Zil artık ilk açılışta
  dolu (önceden yalnız ilgili sayfalar ziyaret edilince doluyordu). İçerik sayfasına geçiş de 0 tur oldu.
- **0021 uygulanmadan önce:** RPC `profiles`'ı reddeder (22023) → o sekmede ilk açılışta +1 tur, sonra ekip
  ayrı sorguyla RPC ile **paralel** (+1 istek, +0 tur). Ayrıntı README-0021.
- **Kayıt araması (Ctrl/⌘K) ve bildirimler** store'daki yüklü veriden istemcide türetilir: ağ isteği yok.

## Kalan işler / riskler

- **Supabase "Max rows" (varsayılan 1000):** eski `select *` yolu tablo başına 1000 satırda sessizce kesiliyordu;
  RPC tek jsonb döndürdüğü için bu sınıra takılmaz (18 ay penceresi yükü sınırlar).
- **18 ay penceresi:** 18 aydan eski kapanmış kayıtlar listelerde / eski dönem raporlarında görünmez (README-0020).
- **Çekirdek küme ilk yüklemeyi büyütür:** küçük bir sayfa ilk açılışta da 18 koleksiyonu çeker (tek tur, daha
  büyük yanıt). Veri büyüdükçe yanıt boyutu `[perf]` günlüğüyle izlenmeli.
- **Anlık görüntü:** aynı sekmede ≤ 12 saat bayat veri kısa süre (1 tur) görünebilir; ardından tazelenir.
