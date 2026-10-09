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
