"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import Sidebar from "./Sidebar";
import Topbar from "./Topbar";
import QuickAddHost from "./QuickAddTask";
import Toaster from "./Toaster";

/**
 * Prefetch kapalı olduğundan bir bağlantıya tıklayınca yeni sayfa gelene kadar ağ beklemesi olur.
 * Herhangi bir iç bağlantıya tıklanınca (sidebar, dashboard kutuları, toast bağlantısı…) ince bir üst
 * çubuk 150 ms gecikmeyle belirir; yol değişince kendiliğinden kaybolur. Ek istek/prefetch YOKTUR:
 * yalnızca tıklamayı dinler. `pendingFor`: tıklandığı andaki yol — yol değişince artık eşleşmez.
 */
function NavProgress() {
  const pathname = usePathname();
  const [pendingFor, setPendingFor] = useState<string | null>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    function onClick(e: MouseEvent) {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as HTMLElement | null)?.closest?.("a");
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin || url.pathname === window.location.pathname) return;
      setPendingFor(window.location.pathname);
      clearTimeout(timer);
      timer = setTimeout(() => setPendingFor(null), 10_000); // takılı kalmasın
    }
    document.addEventListener("click", onClick, true);
    return () => {
      document.removeEventListener("click", onClick, true);
      clearTimeout(timer);
    };
  }, []);

  if (pendingFor === null || pendingFor !== pathname) return null;
  return (
    <div aria-hidden className="pointer-events-none fixed inset-x-0 top-0 z-[70] h-0.5">
      <div className="nav-progress h-full origin-left bg-amber" />
    </div>
  );
}

function MobileDrawer({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>("a,button")?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      if (previous && document.contains(previous)) previous.focus();
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-40 md:hidden">
      <div aria-hidden className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div ref={ref} role="dialog" aria-modal="true" aria-label="Menü" className="absolute left-0 top-0 h-full max-w-[85vw]">
        <Sidebar onNavigate={onClose} onClose={onClose} />
      </div>
    </div>
  );
}

export default function AppShell({
  children,
  userName,
}: {
  children: React.ReactNode;
  userName?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);

  return (
    <div className="relative flex h-dvh overflow-hidden bg-background">
      <a
        href="#main"
        className="sr-only z-[80] rounded-lg bg-amber px-4 py-2 text-sm font-medium text-background focus:not-sr-only focus:fixed focus:left-3 focus:top-3"
      >
        İçeriğe geç
      </a>
      <NavProgress />

      {/* Masaüstü sidebar */}
      <div className="relative z-20 hidden md:block">
        <Sidebar />
      </div>

      {/* Mobil sidebar (drawer) */}
      {open && <MobileDrawer onClose={close} />}

      <div className="relative z-10 flex min-w-0 flex-1 flex-col">
        <Topbar onMenu={() => setOpen(true)} userName={userName} />
        <main id="main" tabIndex={-1} className="app-main flex-1 overflow-y-auto p-4 outline-none md:p-6">{children}</main>
      </div>

      {/* Global Q Hızlı Görev Ekle + bildirimler (kendi state'leri; kabuğu render etmez) */}
      <QuickAddHost />
      <Toaster />
    </div>
  );
}
