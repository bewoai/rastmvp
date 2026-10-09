"use client";

import { useState } from "react";
import Link, { useLinkStatus } from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { ChevronRight, X } from "lucide-react";
import { NAV, activeNavItem, type NavGroup, type NavItem } from "@/lib/nav";
import { useStore } from "@/lib/store";
import { countNewLeads } from "@/lib/lead-logic";

/**
 * Prefetch kapalı olduğundan tıklama ile yeni sayfa arasında ağ beklemesi olur; tıklanan öğede
 * anında dönen bir gösterge çıkar. Satırın sağ ucuna mutlak konumlanır (etikete yer kaplamaz,
 * layout kayması yok); varsa rozetin yerini geçici olarak alır. Çok hızlı geçişlerde yanıp
 * sönmesin diye 100 ms gecikmeyle görünür.
 */
function TrailingSlot({ badgeCount }: { badgeCount: number }) {
  const { pending } = useLinkStatus();
  return (
    <>
      {badgeCount > 0 && (
        <span
          className={`ml-auto inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-md bg-accent/15 px-1.5 text-[11px] font-semibold leading-none text-accent transition-opacity ${pending ? "opacity-0" : ""}`}
          aria-label={`${badgeCount} yeni potansiyel müşteri`}
        >
          {badgeCount > 99 ? "99+" : badgeCount}
        </span>
      )}
      <span
        aria-hidden
        className={`absolute right-2.5 top-1/2 -mt-[7px] h-3.5 w-3.5 rounded-full border-2 border-faint/40 border-t-muted transition-opacity ${
          pending ? "animate-spin opacity-100 delay-100" : "opacity-0"
        }`}
      />
    </>
  );
}

/**
 * "Yeni" durumundaki lead sayısı — yalnızca store'dan okunur, ek istek atmaz. Supabase modunda leads
 * koleksiyonu henüz yüklenmediyse (bir sayfa yükleyene dek) null döner: yanlış "0" yerine rozet çıkmaz.
 */
function useNewLeadCount(): number | null {
  return useStore((s) => (s.loaded && (!s.supabase || s.loadedCollections.leads) ? countNewLeads(s.leads) : null));
}

function NavLink({
  item,
  active,
  badgeCount,
  onNavigate,
}: {
  item: NavItem;
  active: boolean;
  badgeCount: number;
  onNavigate?: () => void;
}) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      prefetch={false}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={`group relative flex min-h-10 items-center gap-2.5 rounded-md pl-3 pr-2 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent/60 md:min-h-9 ${
        active ? "bg-surface-2 font-medium text-foreground" : "text-muted hover:bg-surface-2/60 hover:text-foreground"
      }`}
    >
      {active && <span aria-hidden className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-accent" />}
      <Icon
        className={`h-4 w-4 shrink-0 transition-colors ${active ? "text-accent" : "text-faint group-hover:text-muted"}`}
        strokeWidth={2}
        aria-hidden
      />
      <span className="min-w-0 truncate">{item.label}</span>
      <TrailingSlot badgeCount={badgeCount} />
    </Link>
  );
}

function Group({
  group,
  activeHref,
  newLeads,
  onNavigate,
}: {
  group: NavGroup;
  activeHref?: string;
  newLeads: number | null;
  onNavigate?: () => void;
}) {
  const containsActive = group.items.some((item) => item.href === activeHref);
  // Katlanabilir grup: kullanıcı açıp kapatmadıysa, içindeki sayfa açıkken açık durur.
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  const open = !group.collapsible || (userOpen ?? containsActive);
  const listId = `nav-${group.title || "genel"}`;

  const list = (
    <ul id={listId} className="space-y-px">
      {group.items.map((item) => (
        <li key={item.href}>
          <NavLink
            item={item}
            active={item.href === activeHref}
            badgeCount={item.badge === "new-leads" && newLeads ? newLeads : 0}
            onNavigate={onNavigate}
          />
        </li>
      ))}
    </ul>
  );

  if (!group.title) return list;

  return (
    <div>
      {group.collapsible ? (
        <button
          type="button"
          onClick={() => setUserOpen(!open)}
          aria-expanded={open}
          aria-controls={listId}
          className="flex w-full items-center gap-1 rounded-md px-3 pb-1 pt-1 text-left text-xs font-medium text-faint outline-none transition-colors hover:text-muted focus-visible:ring-2 focus-visible:ring-accent/60"
        >
          {group.title}
          <ChevronRight className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-90" : ""}`} aria-hidden />
        </button>
      ) : (
        <p className="px-3 pb-1 text-xs font-medium text-faint">{group.title}</p>
      )}
      {open && list}
    </div>
  );
}

export default function Sidebar({ onNavigate, onClose }: { onNavigate?: () => void; onClose?: () => void }) {
  const pathname = usePathname();
  const activeHref = activeNavItem(pathname)?.href;
  const newLeads = useNewLeadCount();
  const main = NAV.filter((group) => !group.pinBottom);
  const bottom = NAV.filter((group) => group.pinBottom);

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-r border-border bg-sidebar">
      <div className="flex h-14 shrink-0 items-center justify-between px-5">
        <Link href="/" prefetch={false} onClick={onNavigate} aria-label="Ana sayfa" className="flex items-center rounded-md outline-none transition-opacity hover:opacity-85 focus-visible:ring-2 focus-visible:ring-accent/60">
          <Image
            src="/brand/rast-white-tight.svg"
            alt="Rast Creative"
            width={200}
            height={122}
            className="h-8 w-auto"
            priority
          />
          <span className="sr-only">Rast Creative</span>
        </Link>
        {onClose && (
          <button type="button" onClick={onClose} aria-label="Menüyü kapat" className="-mr-2 flex h-10 w-10 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-foreground">
            <X className="h-5 w-5" aria-hidden />
          </button>
        )}
      </div>

      <nav aria-label="Ana menü" className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-3 pb-3 pt-2">
        <div className="space-y-5">
          {main.map((group) => (
            <Group key={group.title || "genel"} group={group} activeHref={activeHref} newLeads={newLeads} onNavigate={onNavigate} />
          ))}
        </div>
        <div className="mt-auto pt-5">
          <div className="border-t border-border pt-3">
            {bottom.map((group) => (
              <Group key={group.title || "alt"} group={group} activeHref={activeHref} newLeads={newLeads} onNavigate={onNavigate} />
            ))}
          </div>
        </div>
      </nav>
    </aside>
  );
}
