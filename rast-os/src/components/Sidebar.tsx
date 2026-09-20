"use client";

import Link, { useLinkStatus } from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { NAV } from "@/lib/nav";

/**
 * Prefetch kapalı olduğundan tıklama ile yeni sayfa arasında ağ beklemesi olur; tıklanan öğede
 * anında dönen bir gösterge çıkar. Sabit boyutlu (layout kayması yok); çok hızlı geçişlerde
 * yanıp sönmesin diye 100 ms gecikmeyle görünür.
 */
function PendingHint() {
  const { pending } = useLinkStatus();
  return (
    <span
      aria-hidden
      className={`ml-auto h-3.5 w-3.5 shrink-0 rounded-full border-2 border-amber/30 border-t-amber transition-opacity ${
        pending ? "animate-spin opacity-100 delay-100" : "opacity-0"
      }`}
    />
  );
}

export default function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const activeHref = NAV.flatMap((group) => group.items)
    .filter((item) => item.href === "/" ? pathname === "/" : pathname === item.href || pathname.startsWith(`${item.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-r border-border/80 bg-surface/90 backdrop-blur-xl">
      <div className="border-b border-border/80 px-5 py-4">
        <Link href="/" prefetch={false} onClick={onNavigate} aria-label="Ana sayfa" className="flex items-center rounded-lg outline-none transition-opacity hover:opacity-85 focus-visible:ring-2 focus-visible:ring-amber/60">
        <Image
          src="/brand/rast-white-tight.svg"
          alt="Rast Creative"
          width={200}
          height={122}
          className="h-10 w-auto"
          priority
        />
        <span className="sr-only">Rast Creative</span>
        </Link>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4 pb-6">
        {NAV.map((group) => (
          <div key={group.title} className="mb-6">
            <p className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted/80">
              {group.title}
            </p>
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const active = item.href === activeHref;
                const Icon = item.icon;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      prefetch={false}
                      onClick={onNavigate}
                      aria-current={active ? "page" : undefined}
                      className={`group flex items-center gap-3 rounded-xl border px-3 py-2.5 text-sm transition-all ${
                        active
                          ? "border-amber/20 bg-amber/12 text-foreground shadow-[inset_3px_0_0_var(--amber)]"
                          : "border-transparent text-muted hover:border-border/70 hover:bg-surface-2/70 hover:text-foreground"
                      }`}
                    >
                      <Icon
                        className={`h-4 w-4 transition-transform group-hover:scale-105 ${active ? "text-amber" : ""}`}
                        strokeWidth={active ? 2.4 : 2}
                      />
                      {item.label}
                      <PendingHint />
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

    </aside>
  );
}
