// Teklif paket şablonları. Editördeki "Paket" seçimi kalemleri (ve boşsa süreç/koşul metinlerini)
// buradan doldurur; fiyatlar KDV hariçtir ve teklif üzerinde serbestçe değiştirilebilir.
//
// KURAL: Strateji, raporlama ve kreatif ASLA ayrı kalem olarak yazılmaz. Bunlar her hizmetin
// içindedir (bkz. koşul metinleri: "Strateji, raporlama ve kreatif üretim … dahildir").
// Yeni paket eklerken de bu kalemleri ayrı satır/fiyat olarak eklemeyin.
//
// MEVZUAT KURALI (sahibin kararı, bağlayıcı): Türkiye'de hekimler için ücretli reklam / tanıtım
// SÜREKLİ AYLIK HİZMET olarak sunulamaz; yalnızca açılış tarihini izleyen ilk bir ay AÇILIŞ DUYURUSU
// için veya Bakanlıkça kabul edilmiş yeni tıbbi yöntemler için yapılabilir (Sağlık Hizmetlerinde Tanıtım ve
// Bilgilendirme Faaliyetleri Hakkında Yönetmelik, RG 12.11.2025/33075, md. 5/1-k). Paylaşan taraf olarak
// ajans da sorumludur (md. 5/2). Bu yüzden hekim paketlerinde "Meta ve Google
// reklam yönetimi" tekrarlayan (aylık) kalem OLARAK YER ALMAZ. Reklam yalnızca "Ek hizmetler (hekim)"
// altında, tek seferlik ve isteğe bağlı kalem olarak teklif edilir.
//
// Not: Yalnızca `import type` — saf modül (testlerden doğrudan içe aktarılabilir).
import type { ProposalItem } from "./types";

export type PresetItem = Pick<ProposalItem, "name" | "description" | "qty" | "unit" | "unit_price" | "is_recurring">;

export interface ProposalPackage {
  id: string;
  label: string;
  /** Paket seçicide görünen kısa açıklama */
  summary?: string;
  items: PresetItem[];
}

export interface PresetGroup {
  id: string;
  label: string;
  /** Süreç / takvim varsayılanı (teklifin `notes` alanı boşsa doldurulur) */
  notes: string;
  /** Sorumluluklar + ödeme koşulları varsayılanı (`terms` boşsa doldurulur) */
  terms: string;
  packages: ProposalPackage[];
}

const monthly = (name: string, unit_price: number, description?: string): PresetItem => ({
  name, description, qty: 1, unit: "ay", unit_price, is_recurring: true,
});

const oneOff = (name: string, unit: string, unit_price: number, description?: string): PresetItem => ({
  name, description, qty: 1, unit, unit_price, is_recurring: false,
});

/* ------------------------------------------------------------------ */
/* Hekim İçerik Sistemi — 3 kademe (aylık, KDV hariç)                  */
/*   Başlangıç ≈ 15.000 · Standart = 25.000 · Klinik ≈ 40.000          */
/*   Aylık reklam yönetimi YOK (bkz. dosya başındaki mevzuat kuralı).  */
/* ------------------------------------------------------------------ */

const SOSYAL_MEDYA = monthly(
  "Sosyal medya yönetimi",
  4800,
  "Instagram içerik planı, paylaşım, açıklama metinleri ve topluluk yönetimi",
);

// Başlangıç ≈ 15.000: 4 video + sosyal medya. 4 videonun fiyatı yaklaşık toplamı tutturmak için
// 10.200 alındı (TODO(fiyat): kalem kırılımı fiyat listesi onayında netleşecek).
const HEKIM_BASLANGIC: PresetItem[] = [
  SOSYAL_MEDYA,
  monthly("4 konu-anlatım videosu / ay", 10200, "Hekimin uzmanlık konularında kısa bilgilendirici videolar (çekim + kurgu)"),
]; // 4.800 + 10.200 = 15.000

const HEKIM_STANDART: PresetItem[] = [
  SOSYAL_MEDYA,
  monthly("8 konu-anlatım videosu / ay", 14300, "Hekimin uzmanlık konularında kısa bilgilendirici videolar (çekim + kurgu)"),
  // GEÇİCİ — sahip kararı bekleniyor (provisional, owner decision pending): Eski "reklam yönetimi"
  // (5.900) mevzuat nedeniyle kalktı; toplam 25.000 korunsun diye aynı tutar Google İşletme Profili +
  // YouTube/arama optimizasyonuna kondu. Paket/fiyat kararı verilince güncellenecek.
  monthly(
    "Google İşletme Profili yönetimi + YouTube/arama optimizasyonu",
    5900,
    "Google İşletme Profili düzeni ve güncel tutulması, YouTube başlık/açıklama ve arama görünürlüğü optimizasyonu (reklam içermez)",
  ),
]; // 4.800 + 14.300 + 5.900 = 25.000

// Klinik ≈ 40.000: Standart kapsamı + 12 video, story yönetimi, aylık uzun YouTube videosu, web sitesi bakımı.
// TODO(fiyat): 12 video + ek kalemlerin tutarları toplamı ≈ 40.000'e oturtmak için geçici dağıtıldı; onayda güncelle.
const HEKIM_KLINIK: PresetItem[] = [
  SOSYAL_MEDYA,
  monthly("12 konu-anlatım videosu / ay", 17200, "Hekimin uzmanlık konularında kısa bilgilendirici videolar (çekim + kurgu)"),
  monthly(
    "Google İşletme Profili yönetimi + YouTube/arama optimizasyonu",
    5900,
    "Google İşletme Profili düzeni ve güncel tutulması, YouTube başlık/açıklama ve arama görünürlüğü optimizasyonu (reklam içermez)",
  ), // provisional — owner decision pending (bkz. HEKIM_STANDART)
  monthly("Story yönetimi", 3200, "Haftalık story akışı: soru-cevap, klinikten anlar, duyurular"),
  monthly("YouTube uzun video (1 / ay)", 6500, "8–15 dk bilgilendirici uzun video + YouTube başlık/açıklama optimizasyonu"),
  monthly("Web sitesi bakımı", 2400, "Klinik web sitesi içerik güncelleme, yedekleme ve teknik bakım"),
]; // 4.800 + 17.200 + 5.900 + 3.200 + 6.500 + 2.400 = 40.000

// Ek hizmetler (hekim): tek seferlik, isteğe bağlı. Aylık reklam yönetimi yerine geçmez.
// TODO(fiyat): fiyatlar henüz belirlenmedi — 0 bırakıldı, teklifte elle girin. Yalnızca açılış tarihini izleyen
// ilk bir ay veya özel izin bulunan durumlarda teklif edilebilir (dosya başındaki kural).
const HEKIM_EK: PresetItem[] = [
  oneOff(
    "Açılış dönemi tanıtımı (açılış tarihini izleyen ilk bir ay)",
    "proje",
    0,
    "Açılış tarihini izleyen ilk bir ayda açılış duyurusu; tek seferlik, reklam bütçesi hariç",
  ),
  oneOff(
    "İzinli dönem tanıtım desteği",
    "proje",
    0,
    "Yalnızca özel tanıtım izni bulunan durumlarda; izin belgesi müşteriden alınır, tek seferlik",
  ),
];

const HEKIM_NOTES = `1. Hafta — Tanışma ve keşif: hekim / klinik görüşmesi, hedef hasta kitlesi, konu listesi.
2. Hafta — İçerik planı ve video senaryoları onaya sunulur; çekim günü planlanır.
3. Hafta — Klinikte çekim (yarım gün) ve kurgu.
4. Hafta — Yayın takvimi başlar; ay sonunda kısa performans özeti paylaşılır.
Sonraki aylar — Her ayın ilk haftası içerik planı, ikinci haftası çekim; yayınlar takvime göre devam eder.`;

const HEKIM_TERMS = `## Rast Creative'in sorumlulukları
- Onaylı içerik planına göre üretim ve zamanında yayın.
- Strateji, raporlama ve kreatif üretim tüm hizmetlere dahildir; ayrıca ücretlendirilmez.
- İçerikler sağlık hizmetleri tanıtım mevzuatı gözetilerek hazırlanır.
- Hekimler için ücretli reklam aylık hizmet olarak verilmez; yalnızca açılış tarihini izleyen ilk bir ayda açılış duyurusu veya özel izin bulunan durumlarda, tek seferlik ek hizmet olarak yapılır.
- Her içerik için 2 revizyon hakkı.
## Müşterinin sorumlulukları
- Planlanan çekim günlerinde hekimin ve mekânın hazır olması.
- Tıbbi bilgilerin doğruluğunun onayı; içerik onaylarının 2 iş günü içinde verilmesi.
- Hesap erişimlerinin (Instagram, Google İşletme Profili, YouTube, web sitesi) sağlanması.
- Tanıtım izni gerektiren ek hizmetlerde (varsa) izin belgesinin sağlanması; reklam bütçesi teklife dahil değildir.
## Ödeme koşulları
- Aylık hizmet bedeli her ayın ilk 5 iş günü içinde, fatura karşılığı ödenir.
- Fiyatlara KDV dahil değildir; KDV ayrıca gösterilmiştir.
- Asgari çalışma süresi 3 aydır; fesih için 30 gün önceden yazılı bildirim gerekir.`;

/* ------------------------------------------------------------------ */
/* Kurumsal tanıtım filmi — tek seferlik                               */
/* ------------------------------------------------------------------ */

// TODO(fiyat): Kurumsal film fiyatları henüz belirlenmedi — 0 bırakıldı, teklifte elle girin.
const FILM_CEKIM: PresetItem[] = [
  oneOff("Çekim günü (yönetmen + kameraman + ekipman)", "gün", 0, "Senaryo / çekim planına göre tam gün çekim"),
  oneOff("Ham görüntü teslimi", "adet", 0, "Tüm ham kayıtların dijital teslimi"),
];

const FILM_CEKIM_KURGU: PresetItem[] = [
  oneOff("Çekim günü (yönetmen + kameraman + ekipman)", "gün", 0, "Senaryo / çekim planına göre tam gün çekim"),
  oneOff("Kurgu, renk ve ses", "adet", 0, "2–3 dk tanıtım filmi + sosyal medya için kısa versiyon; 2 revizyon dahil"),
];

const FILM_NOTES = `1. Ön görüşme ve brief (1–2 gün).
2. Senaryo ve çekim planı onayı (3–5 gün).
3. Çekim günü.
4. Kurgu, renk ve ses (çekim + kurgu paketinde, 7–10 iş günü).
5. Revizyon ve final teslim.`;

const FILM_TERMS = `## Rast Creative'in sorumlulukları
- Onaylı çekim planına göre ekip ve ekipmanla çekim.
- Strateji ve kreatif yön çekim bedeline dahildir.
- Çekim + kurgu paketinde 2 revizyon hakkı; ek revizyonlar ayrıca fiyatlandırılır.
## Müşterinin sorumlulukları
- Çekim mekânı izinleri ve görüntülenecek kişilerin izinleri (KVKK açık rıza dahil).
- Çekim günü yetkili bir kişinin sette bulunması.
- Onay ve geri bildirimlerin 3 iş günü içinde verilmesi.
## Ödeme koşulları
- %50 sipariş onayında, %50 teslimde ödenir.
- Fiyatlara KDV dahil değildir; KDV ayrıca gösterilmiştir.
- Müşteri kaynaklı, 48 saatten kısa sürede bildirilen ertelemelerde çekim günü ücretlendirilir.`;

/* ------------------------------------------------------------------ */
/* Aylık video paketi (inşaat / emlak) — 45.000 / ay                   */
/* ------------------------------------------------------------------ */

const INSAAT_AYLIK: PresetItem[] = [
  monthly("Saha çekimi", 22000, "Şantiye / proje sahasında planlı çekim günleri: ilerleme ve detay görüntüleri"),
  monthly("Röportaj / Reels", 9000, "Proje ekibi, satış ofisi veya müşteri röportajları; dikey Reels kurguları"),
  monthly("Drone çekimi", 6000, "İzinli bölgelerde hava çekimi; hava koşuluna göre planlanır"),
  monthly("Kurgu, renk ve ses", 8000, "Ay içi kısa videolar + ay sonu ilerleme özeti"),
]; // 22.000 + 9.000 + 6.000 + 8.000 = 45.000

const INSAAT_NOTES = `1. Ay başı — Şantiye ilerlemesine göre saha takvimi ve çekim planı.
2. Saha çekim günleri — ilerleme, detay ve drone çekimleri.
3. Röportaj / Reels çekimi — proje ekibi, satış ofisi veya müşteri.
4. Kurgu, renk ve ses — ay içinde parça parça teslim, ay sonunda aylık özet video.`;

const INSAAT_TERMS = `## Rast Creative'in sorumlulukları
- Aylık çekim planına göre saha, röportaj ve drone çekimleri.
- Strateji, raporlama ve kreatif üretim pakete dahildir; ayrıca ücretlendirilmez.
- Drone uçuşları izinli bölgelerde yapılır; hava koşulu nedeniyle ertelenebilir.
## Müşterinin sorumlulukları
- Şantiye erişimi, İSG ekipmanı ve refakatçi sağlanması.
- Röportaj yapılacak kişilerin planlanan günde hazır olması.
- Onay ve geri bildirimlerin 3 iş günü içinde verilmesi.
## Ödeme koşulları
- Aylık paket bedeli her ayın ilk 5 iş günü içinde, fatura karşılığı ödenir.
- Fiyatlara KDV dahil değildir; KDV ayrıca gösterilmiştir.
- Asgari çalışma süresi 3 aydır; fesih için 30 gün önceden yazılı bildirim gerekir.`;

const HEKIM_EK_NOTES = `Ek hizmetler yalnızca açılış tarihini izleyen ilk bir ay içinde (açılış duyurusu) veya özel izin bulunan durumlarda sunulur.
1. Uygunluk kontrolü — açılış tarihi / izin belgesi doğrulanır.
2. Tek seferlik tanıtım planı ve içerik onaya sunulur.
3. Yayın ve kapanış özeti.`;

const HEKIM_EK_TERMS = `## Rast Creative'in sorumlulukları
- Onaylı plana göre tek seferlik tanıtım çalışması; sağlık hizmetleri tanıtım mevzuatına uygun içerik.
- Strateji, raporlama ve kreatif üretim kapsama dahildir; ayrıca ücretlendirilmez.
## Müşterinin sorumlulukları
- Açılış tarihinin veya tanıtım izninin belgelenmesi; içerik onaylarının 2 iş günü içinde verilmesi.
- Reklam bütçesi (varsa) doğrudan müşteri tarafından ödenir.
## Ödeme koşulları
- Tek seferlik bedel sipariş onayında ödenir; sürekli aylık hizmet değildir.
- Fiyatlara KDV dahil değildir; KDV ayrıca gösterilmiştir.`;

export const PROPOSAL_PRESETS: PresetGroup[] = [
  {
    id: "hekim",
    label: "Hekim İçerik Sistemi",
    notes: HEKIM_NOTES,
    terms: HEKIM_TERMS,
    packages: [
      { id: "baslangic", label: "Başlangıç", summary: "≈ 15.000 / ay", items: HEKIM_BASLANGIC },
      { id: "standart", label: "Standart", summary: "25.000 / ay", items: HEKIM_STANDART },
      { id: "klinik", label: "Klinik", summary: "≈ 40.000 / ay", items: HEKIM_KLINIK },
    ],
  },
  {
    id: "hekim-ek",
    label: "Ek hizmetler (hekim)",
    notes: HEKIM_EK_NOTES,
    terms: HEKIM_EK_TERMS,
    packages: [
      { id: "tanitim", label: "Açılış / izinli dönem tanıtımı", summary: "tek seferlik · isteğe bağlı · fiyat girilecek", items: HEKIM_EK },
    ],
  },
  {
    id: "kurumsal-film",
    label: "Kurumsal tanıtım filmi",
    notes: FILM_NOTES,
    terms: FILM_TERMS,
    packages: [
      { id: "cekim", label: "Sadece çekim", summary: "tek seferlik · fiyat girilecek", items: FILM_CEKIM },
      { id: "cekim-kurgu", label: "Çekim + kurgu", summary: "tek seferlik · fiyat girilecek", items: FILM_CEKIM_KURGU },
    ],
  },
  {
    id: "insaat-emlak",
    label: "Aylık video paketi (inşaat/emlak)",
    notes: INSAAT_NOTES,
    terms: INSAAT_TERMS,
    packages: [
      { id: "aylik", label: "Aylık video paketi", summary: "45.000 / ay", items: INSAAT_AYLIK },
    ],
  },
];

/** Seçici değeri: "<grup>:<paket>" */
export const presetKey = (groupId: string, packageId: string) => `${groupId}:${packageId}`;

export function findPreset(key: string): { group: PresetGroup; pkg: ProposalPackage } | null {
  const [gid, pid] = key.split(":");
  const group = PROPOSAL_PRESETS.find((g) => g.id === gid);
  const pkg = group?.packages.find((p) => p.id === pid);
  return group && pkg ? { group, pkg } : null;
}

/** Teklif başlığı önerisi: "Hekim İçerik Sistemi — Standart" */
export const presetTitle = (group: PresetGroup, pkg: ProposalPackage) =>
  group.packages.length > 1 ? `${group.label} — ${pkg.label}` : group.label;

/** Paket kalemlerini teklif kalemlerine çevirir (sıra numaralı, yeni id'li). */
export function presetToItems(
  pkg: ProposalPackage,
  proposalId: string,
  makeId: () => string,
  createdAt: string,
): ProposalItem[] {
  return pkg.items.map((it, position) => ({
    ...it,
    id: makeId(),
    proposal_id: proposalId,
    position,
    created_at: createdAt,
  }));
}
