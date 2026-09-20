// Rast OS — MVP navigasyon yapısı (dokümandaki menü yapısından)
import type { LucideIcon } from "lucide-react";
import {
  LayoutDashboard, Users, Building2, Palette, FolderKanban,
  ListTodo, CalendarDays, Camera, Wallet, Receipt, Boxes,
  FolderOpen, Settings, Contact, TrendingUp, Briefcase, Upload, ShoppingCart, Megaphone,
} from "lucide-react";

export type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
};

export type NavGroup = {
  title: string;
  items: NavItem[];
};

export const NAV: NavGroup[] = [
  {
    title: "Genel",
    items: [
      { label: "Dashboard", href: "/", icon: LayoutDashboard },
    ],
  },
  {
    title: "CRM",
    items: [
      { label: "Satış Pipeline", href: "/crm/pipeline", icon: TrendingUp },
      { label: "Potansiyel Müşteriler", href: "/crm/leads", icon: Users },
      { label: "Müşteriler", href: "/crm/clients", icon: Building2 },
      { label: "Markalar", href: "/crm/brands", icon: Palette },
      { label: "İletişim Kişileri", href: "/crm/contacts", icon: Contact },
    ],
  },
  {
    title: "Operasyon",
    items: [
      { label: "Tekil İşler", href: "/jobs", icon: Briefcase },
      { label: "Projeler", href: "/projects", icon: FolderKanban },
      { label: "Görevler", href: "/tasks", icon: ListTodo },
      { label: "İçerik Takvimi", href: "/content", icon: CalendarDays },
      { label: "Çekimler", href: "/shoots", icon: Camera },
    ],
  },
  {
    title: "Finans",
    items: [
      { label: "Gelirler / Faturalar", href: "/finance/invoices", icon: Receipt },
      { label: "Giderler", href: "/finance/expenses", icon: Wallet },
    ],
  },
  {
    title: "Pazarlama",
    items: [
      { label: "Reklam Merkezi", href: "/ads", icon: Megaphone },
    ],
  },
  {
    title: "Kaynaklar",
    items: [
      { label: "Aktif Ekipmanlar", href: "/equipment", icon: Boxes },
      { label: "Alınacak Ekipmanlar", href: "/equipment/planned", icon: ShoppingCart },
      { label: "Dosyalar", href: "/files", icon: FolderOpen },
    ],
  },
  {
    title: "Sistem",
    items: [
      { label: "İçe Aktar", href: "/import", icon: Upload },
      { label: "Ayarlar", href: "/settings", icon: Settings },
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
