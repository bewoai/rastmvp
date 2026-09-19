import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const root = new URL("../src/app/(app)", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

const pages = [
  ["crm/pipeline/page.tsx", "Satış Pipeline", "Kanban görünümünde satış süreci: Yeni aday → İlk iletişim → İhtiyaç görüşmesi → Teklif → Geri dönüş → Revize → Anlaşma / Kaybedildi.", "Pipeline kartları"],
  ["crm/leads/page.tsx", "Potansiyel Müşteriler", "Henüz müşteriye dönüşmemiş firma ve kişiler; kaynak, tahmini bütçe, takip tarihleri ve kazanıldı/kaybedildi durumu.", "Lead listesi"],
  ["crm/clients/page.tsx", "Müşteriler", "Müşteri kartları: fatura bilgileri, aktif hizmet paketi, sözleşme tarihleri, projeler, faturalar ve görüşme geçmişi.", "Müşteri listesi"],
  ["crm/brands/page.tsx", "Markalar", "Her müşterinin birden fazla markası: logo, renk paleti, marka tonu, hedef kitle, sosyal hesaplar ve içerik kuralları.", "Marka listesi"],
  ["crm/contacts/page.tsx", "İletişim Kişileri", "Müşteri tarafındaki yetkili kişiler, onay verecek kişiler ve iletişim tercihleri.", "Kişi listesi"],
  ["projects/page.tsx", "Projeler", "Müşteri altında projeler: sorumlu, tarih, bütçe, durum, teslim edilecek işler, gelir/gider ve kârlılık.", "Proje listesi"],
  ["tasks/page.tsx", "Görevler", "Bekliyor → Yapılıyor → İç kontrol → Müşteri onayı → Revize → Tamamlandı akışı; sorumlu, son tarih ve kontrol listeleri.", "Görev panosu"],
  ["content/page.tsx", "İçerik Takvimi", "Reels, post, story ve videolar için içerik kartları; aylık/haftalık takvim, marka & platform filtreleri, yayın planı.", "İçerik takvimi"],
  ["shoots/page.tsx", "Çekimler", "Çekim planı: tarih, lokasyon, ekip, shot list, ekipman ataması ve çekim kontrol listeleri.", "Çekim listesi"],
  ["finance/invoices/page.tsx", "Gelirler / Faturalar", "Faturalar ve tahsilat takibi: tutar, KDV, tahsil edilen/kalan, vade ve durum (fatura kesildi, kısmi, ödendi, gecikti).", "Fatura listesi"],
  ["finance/expenses/page.tsx", "Giderler", "Gider kayıtları: kategori, tedarikçi, proje/müşteri, tekrarlayan giderler ve proje bazlı kârlılık.", "Gider listesi"],
  ["equipment/page.tsx", "Ekipmanlar", "Envanter ve zimmet: kamera, lens, ışık, ses; durum, rezervasyon, bakım tarihleri ve hasar kayıtları.", "Ekipman listesi"],
  ["files/page.tsx", "Dosyalar", "Google Drive / Dropbox / NAS bağlantıları ve standart klasör yapısı (Brief, Raw, Audio, Project, Exports, Approved, Archive).", "Dosya bağlantıları"],
  ["settings/page.tsx", "Ayarlar", "Kullanıcılar, roller (Yönetici, Proje Yön., Editör, Muhasebe, Müşteri), bildirimler, entegrasyonlar ve işlem geçmişi.", "Ayarlar"],
];

const tpl = (title, desc, empty) => `import { PageHeader, EmptyState } from "@/components/ui";

export default function Page() {
  return (
    <>
      <PageHeader
        title=${JSON.stringify(title)}
        subtitle=${JSON.stringify(desc)}
      />
      <EmptyState
        title=${JSON.stringify(empty + " — yakında")}
        hint="Bu modül MVP kapsamında geliştiriliyor. Supabase şeması hazır; kayıt oluşturma ve listeleme ekranları sırayla eklenecek."
      />
    </>
  );
}
`;

for (const [file, title, desc, empty] of pages) {
  const full = join(root, file);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, tpl(title, desc, empty), "utf8");
  console.log("wrote", file);
}
