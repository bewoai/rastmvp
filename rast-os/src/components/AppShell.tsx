"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import Sidebar from "./Sidebar";
import Topbar from "./Topbar";
import QuickAddHost from "./QuickAddTask";
import Toaster from "./Toaster";
import { prefetchBootstrap, prefetchRoute, refreshIfStale } from "@/lib/store";

// Açılış verisi: bu modül tarayıcıda yüklenir yüklenmez (sayfa bileşenleri mount olmadan, hydration
// sürerken) tek `app_bootstrap` isteği başlar — çekirdek koleksiyonlar + açılan sayfanınkiler.
// Store'a yanıt gelince yazılır (zustand/useSyncExternalStore hydration sırasında güvenli). Demo modunda no-op.
if (typeof window !== "undefined") prefetchBootstrap(window.location.pathname);

/**
 * İç bağlantının üzerinde ~120 ms durulunca / klavyeyle odaklanınca hedef sayfanın eksik koleksiyonları
 * önceden istenir (tıklamadan önce tek RPC). Yüklü olan için istek yok; Next prefetch'i (kapalı) değil.
 */
function useRouteDataPrefetch() {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const target = (e: Event) => {
      const a = (e.target as HTMLElement | null)?.closest?.("a");
      if (!a || a.target === "_blank") return null;
      const url = new URL(a.href, window.location.href);
      return url.origin === window.location.origin && url.pathname !== window.location.pathname ? url.pathname : null;
    };
    function onOver(e: Event) {
      const path = target(e);
      clearTimeout(timer);
      if (path) timer = setTimeout(() => prefetchRoute(path), e.type === "focusin" ? 0 : 120);
    }
    function onOut() {
      clearTimeout(timer);
    }
    document.addEventListener("pointerover", onOver, true);
    document.addEventListener("focusin", onOver, true);
    document.addEventListener("pointerout", onOut, true);
    return () => {
      document.removeEventListener("pointerover", onOver, true);
      document.removeEventListener("focusin", onOver, true);
      document.removeEventListener("pointerout", onOut, true);
      clearTimeout(timer);
    };
  }, []);
}

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

/**
 * Sekmeye / pencereye dönülünce: son çekimden 60 sn'den fazla geçtiyse yüklü koleksiyonlar tek istekle
 * tazelenir (başka kullanıcıların değişiklikleri gelir). `focus` + `visibilitychange` aynı anda gelse de
 * tek istek atılır (uçuştayken no-op).
 */
function useRefreshOnReturn() {
  useEffect(() => {
    function onReturn() {
      if (document.visibilityState === "visible") refreshIfStale();
    }
    window.addEventListener("focus", onReturn);
    document.addEventListener("visibilitychange", onReturn);
    return () => {
      window.removeEventListener("focus", onReturn);
      document.removeEventListener("visibilitychange", onReturn);
    };
  }, []);
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
  useRouteDataPrefetch();
  useRefreshOnReturn();

  return (
    <div className="relative flex h-dvh overflow-hidden bg-background print:block print:h-auto print:overflow-visible print:bg-white">
      <a
        href="#main"
        className="sr-only z-[80] rounded-lg bg-amber px-4 py-2 text-sm font-medium text-background focus:not-sr-only focus:fixed focus:left-3 focus:top-3"
      >
        İçeriğe geç
      </a>
      <NavProgress />

      {/* Masaüstü sidebar */}
      <div className="relative z-20 hidden md:block print:hidden!">
        <Sidebar />
      </div>

      {/* Mobil sidebar (drawer) */}
      {open && <MobileDrawer onClose={close} />}

      <div className="relative z-10 flex min-w-0 flex-1 flex-col print:block">
        <Topbar onMenu={() => setOpen(true)} userName={userName} />
        <main id="main" tabIndex={-1} className="app-main flex-1 overflow-y-auto p-4 outline-none md:p-6 print:overflow-visible print:bg-none print:p-0">{children}</main>
      </div>

      {/* Global Q Hızlı Görev Ekle + bildirimler (kendi state'leri; kabuğu render etmez).
          Yazdırmada (Teklif PDF) kabuk gizlenir: print:* sınıfları sidebar/topbar'ı kaldırır, kaydırma kabını açar. */}
      <QuickAddHost />
      <Toaster />
    </div>
  );
}
