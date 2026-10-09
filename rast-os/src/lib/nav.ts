// Rast OS — menü yapısı. Sade gruplar; az kullanılanlar katlanır "Diğer" grubunda, Ayarlar en altta.
// Tüm rotalar burada bir kez yer alır (Topbar "Ekrana git" araması da bu listeyi kullanır).
import type { LucideIcon } from "lucide-react";
import {
  House, Users, Building2, Palette, FolderKanban,
  ListTodo, CalendarDays, Camera, Wallet, Receipt, Boxes,
  Settings, Contact, TrendingUp, Briefcase, Upload, ShoppingCart, Megaphone,
  FileSignature, FileChartColumn, Radar,
} from "lucide-react";
import { normalizeSearch } from "./search-logic";

export type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Etiketin yanında küçük sayı rozeti gösterilecek veri kaynağı (Sidebar'da store'dan okunur). */
  badge?: "new-leads";
  /** "Ekrana git" aramasında etiket dışında eşleşecek sözcükler. */
  keywords?: string;
};

export type NavGroup = {
  /** Boşsa başlıksız (en üstteki "Bugün"). */
  title: string;
  items: NavItem[];
  /** Katlanabilir grup: varsayılan kapalı; içindeki bir sayfa açıkken kendiliğinden açılır. */
  collapsible?: boolean;
  /** Menünün en altına sabitlenir. */
  pinBottom?: boolean;
};

export const NAV: NavGroup[] = [
  {
    title: "",
    items: [
      { label: "Bugün", href: "/", icon: House, keywords: "dashboard ana sayfa özet" },
    ],
  },
  {
    title: "Satış",
    items: [
      { label: "Satış Pipeline", href: "/crm/pipeline", icon: TrendingUp },
      { label: "Potansiyel Müşteriler", href: "/crm/leads", icon: Users, badge: "new-leads", keywords: "lead" },
      { label: "Müşteri Bulma", href: "/musteri-bulma", icon: Radar },
      { label: "Teklifler", href: "/teklifler", icon: FileSignature },
    ],
  },
  {
    title: "Müşteriler",
    items: [
      { label: "Müşteriler", href: "/crm/clients", icon: Building2, keywords: "crm portal" },
      { label: "Markalar", href: "/crm/brands", icon: Palette },
      { label: "İletişim Kişileri", href: "/crm/contacts", icon: Contact },
    ],
  },
  {
    title: "Operasyon",
    items: [
      { label: "Görevler", href: "/tasks", icon: ListTodo },
      { label: "Projeler", href: "/projects", icon: FolderKanban },
      { label: "Tekil İşler", href: "/jobs", icon: Briefcase },
      { label: "İçerik Takvimi", href: "/content", icon: CalendarDays },
      { label: "Çekimler", href: "/shoots", icon: Camera },
    ],
  },
  {
    title: "Finans",
    items: [
      { label: "Gelirler / Faturalar", href: "/finance/invoices", icon: Receipt, keywords: "tahsilat" },
      { label: "Giderler", href: "/finance/expenses", icon: Wallet },
      { label: "Aylık Rapor", href: "/raporlar/aylik", icon: FileChartColumn, keywords: "raporlar" },
    ],
  },
  {
    title: "Diğer",
    collapsible: true,
    items: [
      { label: "Reklam Merkezi", href: "/ads", icon: Megaphone, keywords: "reklamlar meta google ads" },
      { label: "Aktif Ekipmanlar", href: "/equipment", icon: Boxes },
      { label: "Alınacak Ekipmanlar", href: "/equipment/planned", icon: ShoppingCart },
      // "Dosyalar" (/files) hâlâ "yakında" yer tutucusu: menüden kaldırıldı, rota duruyor (UX-AUDIT §5 #6).
      { label: "İçe Aktar", href: "/import", icon: Upload, keywords: "import csv excel" },
    ],
  },
  {
    title: "",
    pinBottom: true,
    items: [
      { label: "Ayarlar", href: "/settings", icon: Settings, keywords: "yedek işlem geçmişi" },
    ],
  },
];

const FLAT = NAV.flatMap((group) => group.items);

/** Yola en uzun eşleşen menü öğesi (ör. /equipment/planned → "Alınacak Ekipmanlar"). */
export function activeNavItem(pathname: string): NavItem | undefined {
  return FLAT
    .filter((item) => (item.href === "/" ? pathname === "/" : pathname === item.href || pathname.startsWith(`${item.href}/`)))
    .sort((a, b) => b.href.length - a.href.length)[0];
}

/** "Ekrana git" araması: etiket + anahtar sözcükler; Türkçe büyük/küçük harf ve aksan duyarsız ("gorev" → Görevler). */
export function searchNav(term: string, limit = 7): NavItem[] {
  const q = normalizeSearch(term);
  if (!q) return [];
  return FLAT
    .filter((item) => normalizeSearch(`${item.label} ${item.keywords ?? ""}`).includes(q))
    .slice(0, limit);
}
