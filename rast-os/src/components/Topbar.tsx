"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpRight, Bell, Check, ChevronDown, CircleAlert, FileText, LogOut, Menu, Search, Settings, Wallet } from "lucide-react";
import { useStore } from "@/lib/store";
import { NAV, activeNavItem } from "@/lib/nav";

type Notice = {
  id: string;
  title: string;
  body: string;
  href: string;
  icon: typeof Bell;
  tone: "amber" | "danger" | "warning";
};

function dayStamp(value?: string) {
  return value ? new Date(`${value}T12:00:00`).getTime() : Number.POSITIVE_INFINITY;
}

export default function Topbar({
  onMenu,
  userName,
}: {
  onMenu?: () => void;
  userName?: string | null;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const current = activeNavItem(pathname);
  const invoices = useStore((s) => s.invoices);
  const expenses = useStore((s) => s.expenses);
  const tasks = useStore((s) => s.tasks);
  const contents = useStore((s) => s.contents);
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [readIds, setReadIds] = useState<string[]>([]);
  const searchRef = useRef<HTMLInputElement>(null);
  const searchContainerRef = useRef<HTMLDivElement>(null);
  const notificationRef = useRef<HTMLDivElement>(null);
  const accountRef = useRef<HTMLDivElement>(null);

  const initials = (userName || "Rast")
    .split(" ")
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  const notifications = useMemo<Notice[]>(() => {
    const today = new Date();
    const nextWeek = new Date(today);
    nextWeek.setDate(today.getDate() + 7);
    const notices: Notice[] = [];

    const unpaidInvoices = invoices.filter((invoice) => invoice.status !== "paid" && invoice.status !== "cancelled" && invoice.paid_amount < invoice.amount + invoice.vat);
    if (unpaidInvoices.length) {
      notices.push({ id: "unpaid-invoices", title: `${unpaidInvoices.length} bekleyen gelir`, body: "Tahsilat bekleyen faturaları kontrol et.", href: "/finance/invoices", icon: FileText, tone: "amber" });
    }

    const pendingExpenses = expenses.filter((expense) => expense.payment_status === "pending");
    if (pendingExpenses.length) {
      notices.push({ id: "pending-expenses", title: `${pendingExpenses.length} bekleyen gider`, body: "Taksit veya ödeme durumlarını kontrol et.", href: "/finance/expenses", icon: Wallet, tone: "danger" });
    }

    const upcomingTasks = tasks.filter((task) => task.status !== "done" && dayStamp(task.due_date) >= today.getTime() && dayStamp(task.due_date) <= nextWeek.getTime());
    if (upcomingTasks.length) {
      notices.push({ id: "upcoming-tasks", title: `${upcomingTasks.length} yaklaşan görev`, body: "Önümüzdeki 7 gün içindeki görevler.", href: "/tasks", icon: CircleAlert, tone: "warning" });
    }

    const upcomingContents = contents.filter((content) => content.status !== "published" && dayStamp(content.planned_date) >= today.getTime() && dayStamp(content.planned_date) <= nextWeek.getTime());
    if (upcomingContents.length) {
      notices.push({ id: "upcoming-content", title: `${upcomingContents.length} yaklaşan içerik`, body: "İçerik takvimindeki yayınları kontrol et.", href: "/content", icon: Bell, tone: "amber" });
    }

    return notices;
  }, [contents, expenses, invoices, tasks]);

  const unreadCount = notifications.filter((notice) => !readIds.includes(notice.id)).length;
  const searchResults = useMemo(
    () => NAV.flatMap((group) => group.items).filter((item) => item.label.toLocaleLowerCase("tr-TR").includes(searchTerm.trim().toLocaleLowerCase("tr-TR"))).slice(0, 7),
    [searchTerm],
  );

  useEffect(() => {
    function closeMenus(event: MouseEvent) {
      const target = event.target as Node;
      if (!notificationRef.current?.contains(target)) setNotificationOpen(false);
      if (!accountRef.current?.contains(target)) setAccountOpen(false);
      if (!searchContainerRef.current?.contains(target)) setSearchOpen(false);
    }
    document.addEventListener("mousedown", closeMenus);
    return () => document.removeEventListener("mousedown", closeMenus);
  }, []);

  useEffect(() => {
    function onEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setNotificationOpen(false);
      setAccountOpen(false);
      setSearchOpen(false);
    }
    document.addEventListener("keydown", onEscape);
    return () => document.removeEventListener("keydown", onEscape);
  }, []);

  useEffect(() => {
    function focusSearch(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchRef.current?.focus();
        setSearchOpen(true);
      }
    }
    document.addEventListener("keydown", focusSearch);
    return () => document.removeEventListener("keydown", focusSearch);
  }, []);

  function toggleNotifications() {
    setNotificationOpen((open) => !open);
    setAccountOpen(false);
  }

  function toggleAccount() {
    setAccountOpen((open) => !open);
    setNotificationOpen(false);
  }

  return (
    <header className="relative z-[30] flex h-14 shrink-0 items-center gap-2 overflow-visible border-b border-border/70 bg-background/65 px-3 backdrop-blur-xl md:gap-3 md:px-6">
      <button type="button" onClick={onMenu} className="flex h-10 w-10 items-center justify-center rounded-xl text-muted transition-colors hover:bg-surface-2 hover:text-foreground md:hidden" aria-label="Menüyü aç">
        <Menu className="h-5 w-5" />
      </button>
      {/* Mobilde arama yok: bulunduğun bölümü göster */}
      <p className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground md:hidden">{current?.label ?? "Rast OS"}</p>

      <div ref={searchContainerRef} className="relative hidden max-w-xl flex-1 md:block">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
        <input ref={searchRef} value={searchTerm} onChange={(event) => { setSearchTerm(event.target.value); setSearchOpen(true); }} onFocus={() => setSearchOpen(Boolean(searchTerm.trim()))} aria-label="Ekrana git" placeholder="Ekrana git… (Görevler, Projeler, Faturalar)" onKeyDown={(event) => { if (event.key === "Enter" && searchResults[0]) { event.preventDefault(); router.push(searchResults[0].href); setSearchOpen(false); setSearchTerm(""); searchRef.current?.blur(); } }} className="h-9 w-full rounded-xl border border-border/80 bg-surface/60 pl-10 pr-20 text-sm text-foreground outline-none transition-shadow placeholder:text-muted focus:border-amber/60 focus:ring-4 focus:ring-amber/10" />
        <kbd className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded-md border border-border bg-surface-2/70 px-1.5 py-0.5 text-[10px] text-muted">Ctrl K</kbd>
        {searchOpen && searchTerm.trim() && <div className="absolute left-0 right-0 top-11 z-50 overflow-hidden rounded-2xl border border-border bg-surface p-2 shadow-2xl">
          {searchResults.length ? searchResults.map((item) => { const Icon = item.icon; return <Link prefetch={false} key={item.href} href={item.href} onClick={() => { setSearchOpen(false); setSearchTerm(""); }} className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-muted outline-none hover:bg-surface-2 hover:text-foreground focus-visible:bg-surface-2 focus-visible:text-foreground"><Icon className="h-4 w-4 text-amber" /><span>{item.label}</span><ArrowUpRight className="ml-auto h-3.5 w-3.5" /></Link>; }) : <p className="px-3 py-3 text-sm text-muted">Eşleşen ekran bulunamadı.</p>}
        </div>}
      </div>

      <div className="ml-auto flex items-center gap-2.5">
        <div ref={notificationRef} className="relative">
          <button type="button" onClick={toggleNotifications} className={`relative flex h-10 w-10 items-center justify-center rounded-xl text-muted transition-colors hover:bg-surface-2 hover:text-foreground ${notificationOpen ? "bg-surface-2 text-foreground" : ""}`} aria-label={unreadCount ? `Bildirimler (${unreadCount} okunmamış)` : "Bildirimler"} aria-expanded={notificationOpen}>
            <Bell className="h-5 w-5" aria-hidden />
            {unreadCount > 0 && <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-amber" />}
          </button>
          {notificationOpen && <div className="absolute right-0 top-12 z-50 w-[min(23rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl">
            <div className="flex items-center justify-between border-b border-border/80 px-4 py-4">
              <div><p className="text-sm font-semibold text-foreground">Bildirimler</p><p className="text-xs text-muted">{unreadCount ? `${unreadCount} okunmamış bildirim` : "Güncel bildirim yok"}</p></div>
              {unreadCount > 0 && <button type="button" onClick={() => setReadIds(notifications.map((notice) => notice.id))} className="flex items-center gap-1 text-xs text-amber hover:text-foreground"><Check className="h-3.5 w-3.5" /> Tümünü okundu işaretle</button>}
            </div>
            {notifications.length ? <div className="max-h-[min(22rem,60vh)] overflow-y-auto p-2.5">
              {notifications.map((notice) => { const Icon = notice.icon; return <Link prefetch={false} key={notice.id} href={notice.href} onClick={() => { setReadIds((ids) => ids.includes(notice.id) ? ids : [...ids, notice.id]); setNotificationOpen(false); }} className={`flex gap-3 rounded-lg p-3 hover:bg-surface-2 ${readIds.includes(notice.id) ? "opacity-60" : ""}`}>
                <span className={`mt-0.5 rounded-lg p-2 ${notice.tone === "danger" ? "bg-danger/10 text-danger" : notice.tone === "warning" ? "bg-warning/10 text-warning" : "bg-amber/10 text-amber"}`}><Icon className="h-4 w-4" /></span>
                <span className="min-w-0"><span className="block text-sm font-medium text-foreground">{notice.title}</span><span className="mt-0.5 block text-xs text-muted">{notice.body}</span></span>
              </Link>; })}
            </div> : <div className="px-4 py-8 text-center text-sm text-muted">Şu an yeni bildirim yok.</div>}
          </div>}
        </div>

        <div ref={accountRef} className="relative">
          <button type="button" onClick={toggleAccount} className={`flex items-center gap-2 rounded-xl p-1.5 text-left transition-colors hover:bg-surface-2 ${accountOpen ? "bg-surface-2" : ""}`} aria-label="Hesap menüsü" aria-expanded={accountOpen}>
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-amber/20 text-sm font-semibold text-amber ring-1 ring-amber/30">{initials}</span>
            <ChevronDown className={`hidden h-4 w-4 text-muted transition-transform sm:block ${accountOpen ? "rotate-180" : ""}`} />
          </button>
          {accountOpen && <div className="absolute right-0 top-12 z-50 w-64 overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl">
            <div className="border-b border-border/80 px-4 py-4"><p className="text-sm font-semibold text-foreground">{userName || "Rast kullanıcısı"}</p><p className="mt-0.5 text-xs text-muted">Rast Creative hesabı</p></div>
            <div className="p-2">
              <Link prefetch={false} href="/settings" onClick={() => setAccountOpen(false)} className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-muted hover:bg-surface-2 hover:text-foreground"><Settings className="h-4 w-4" /> Hesap ve ayarlar</Link>
              <form action="/auth/signout" method="post"><button type="submit" className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-muted hover:bg-danger/10 hover:text-danger"><LogOut className="h-4 w-4" aria-hidden /> Çıkış yap</button></form>
            </div>
          </div>}
        </div>
      </div>
    </header>
  );
}
