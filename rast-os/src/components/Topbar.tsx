"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Bell, CalendarDays, Check, CheckCircle2, ChevronDown, CircleAlert, FileSignature, FileText, Keyboard, LogOut,
  MessageSquareWarning, Settings, UserPlus, Users, Wallet, Menu,
} from "lucide-react";
import { forgetSessionSnapshot, useStore } from "@/lib/store";
import { activeNavItem } from "@/lib/nav";
import { useNotifications } from "@/lib/useNotifications";
import { initialsOf } from "@/lib/assignee-logic";
import { dateKey, formatDue } from "@/lib/taskLogic";
import type { Notice } from "@/lib/notifications";
import GlobalSearch from "./GlobalSearch";
import { useShortcutHelp } from "./KeyboardShortcuts";

const NOTICE_ICON: Record<Notice["kind"], LucideIcon> = {
  lead: UserPlus, "leads-more": Users, approval: CheckCircle2, proposal: FileSignature,
  invoices: FileText, expenses: Wallet, tasks: CircleAlert, contents: CalendarDays,
};

const TONE_CLS: Record<Notice["tone"], string> = {
  accent: "bg-surface-2 text-muted",
  success: "bg-success/10 text-success",
  warning: "bg-warning/10 text-warning",
  danger: "bg-danger/10 text-danger",
};

function NotificationBell({ open, onToggle, onClose }: { open: boolean; onToggle: () => void; onClose: () => void }) {
  const { ready, notices, unread, isRead, markRead, nowMs } = useNotifications();
  const today = dateKey(new Date(nowMs));

  return (
    <>
      <button
        type="button"
        onClick={onToggle}
        className={`relative flex h-10 w-10 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-2 hover:text-foreground ${open ? "bg-surface-2 text-foreground" : ""}`}
        aria-label={unread ? `Bildirimler (${unread} okunmamış)` : "Bildirimler"}
        aria-expanded={open}
      >
        <Bell className="h-5 w-5" aria-hidden />
        {unread > 0 && <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-accent" />}
      </button>
      {open && (
        // Dar ekranda zil sağ kenarda değil (arama + hesap düğmeleri): panel ekrana sabitlenir, taşmaz.
        <div className="popover absolute right-0 top-12 z-50 w-[min(23rem,calc(100vw-2rem))] overflow-hidden max-sm:fixed max-sm:inset-x-4 max-sm:top-14 max-sm:w-auto" role="region" aria-label="Bildirimler">
          <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
            <div>
              <p className="text-sm font-semibold text-foreground">Bildirimler</p>
              <p className="text-xs text-muted">{!ready ? "Yükleniyor…" : unread ? `${unread} okunmamış bildirim` : "Güncel bildirim yok"}</p>
            </div>
            {unread > 0 && (
              <button type="button" onClick={() => markRead(notices.map((n) => n.id))} className="flex shrink-0 items-center gap-1 text-xs text-muted hover:text-foreground">
                <Check className="h-3.5 w-3.5" aria-hidden /> Tümünü okundu işaretle
              </button>
            )}
          </div>
          {notices.length ? (
            <ul className="max-h-[min(26rem,65vh)] overflow-y-auto p-1.5">
              {notices.map((notice) => {
                const Icon = notice.kind === "approval" && notice.tone === "warning" ? MessageSquareWarning : NOTICE_ICON[notice.kind];
                const read = isRead(notice.id);
                return (
                  <li key={notice.id}>
                    <Link
                      prefetch={false}
                      href={notice.href}
                      onClick={() => { markRead([notice.id]); onClose(); }}
                      className={`flex gap-3 rounded-md p-2.5 outline-none hover:bg-surface-2 focus-visible:bg-surface-2 ${read ? "opacity-60" : ""}`}
                    >
                      <span className={`mt-0.5 h-fit rounded-md p-1.5 ${TONE_CLS[notice.tone]}`}><Icon className="h-4 w-4" aria-hidden /></span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline gap-2">
                          <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{notice.title}</span>
                          {notice.at && <span className="shrink-0 text-[11px] text-faint">{formatDue(dateKey(new Date(notice.at)), today)}</span>}
                        </span>
                        {notice.body && <span className="mt-0.5 block truncate text-xs text-muted">{notice.body}</span>}
                      </span>
                      {!read && <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-label="Okunmadı" />}
                    </Link>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="px-4 py-8 text-center text-sm text-muted">{ready ? "Şu an yeni bildirim yok." : "Bildirimler yükleniyor…"}</div>
          )}
        </div>
      )}
    </>
  );
}

export default function Topbar({
  onMenu,
  userName,
}: {
  onMenu?: () => void;
  /** Sunucudan gelen ilk ad (JWT: user_metadata.full_name / e-posta); açılış isteğindeki profil adı gelince o kullanılır. */
  userName?: string | null;
}) {
  const pathname = usePathname();
  const current = activeNavItem(pathname);
  const profileName = useStore((s) => s.profile?.full_name);
  // Demo modunda profil yok: ekip listesindeki oturum kullanıcısının adı
  const memberName = useStore((s) => (s.userId ? s.profiles.find((p) => p.id === s.userId)?.full_name : null));
  const displayName = profileName || userName || memberName || null;
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const notificationRef = useRef<HTMLDivElement>(null);
  const accountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function closeMenus(event: MouseEvent) {
      const target = event.target as Node;
      if (!notificationRef.current?.contains(target)) setNotificationOpen(false);
      if (!accountRef.current?.contains(target)) setAccountOpen(false);
    }
    document.addEventListener("mousedown", closeMenus);
    return () => document.removeEventListener("mousedown", closeMenus);
  }, []);

  useEffect(() => {
    function onEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setNotificationOpen(false);
      setAccountOpen(false);
    }
    document.addEventListener("keydown", onEscape);
    return () => document.removeEventListener("keydown", onEscape);
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
    <header className="relative z-[30] flex h-14 print:hidden shrink-0 items-center gap-2 overflow-visible border-b border-border bg-background px-3 md:gap-3 md:px-6">
      <button type="button" onClick={onMenu} className="flex h-10 w-10 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-2 hover:text-foreground md:hidden" aria-label="Menüyü aç">
        <Menu className="h-5 w-5" />
      </button>
      {/* Mobilde bulunduğun bölüm; arama büyüteç düğmesinde */}
      <p className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground md:hidden">{current?.label ?? "Rast OS"}</p>

      <GlobalSearch />

      <div className="flex items-center gap-1.5 md:ml-auto md:gap-2.5">
        <div ref={notificationRef} className="relative">
          <NotificationBell open={notificationOpen} onToggle={toggleNotifications} onClose={() => setNotificationOpen(false)} />
        </div>

        <div ref={accountRef} className="relative">
          <button type="button" onClick={toggleAccount} className={`flex items-center gap-1.5 rounded-md p-1 text-left transition-colors hover:bg-surface-2 ${accountOpen ? "bg-surface-2" : ""}`} aria-label="Hesap menüsü" aria-expanded={accountOpen}>
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-surface-2 text-xs font-semibold text-foreground ring-1 ring-border">{initialsOf(displayName || "Rast")}</span>
            <ChevronDown className={`hidden h-4 w-4 text-muted transition-transform sm:block ${accountOpen ? "rotate-180" : ""}`} />
          </button>
          {accountOpen && <div className="popover absolute right-0 top-12 z-50 w-64 overflow-hidden">
            <div className="border-b border-border px-4 py-3"><p className="truncate text-sm font-semibold text-foreground">{displayName || "Rast kullanıcısı"}</p><p className="mt-0.5 text-xs text-muted">Rast Creative hesabı</p></div>
            <div className="p-1.5">
              <Link prefetch={false} href="/settings" onClick={() => setAccountOpen(false)} className="flex items-center gap-3 rounded-md px-3 py-2 text-sm text-muted hover:bg-surface-2 hover:text-foreground"><Settings className="h-4 w-4" /> Hesap ve ayarlar</Link>
              <button type="button" onClick={() => { setAccountOpen(false); useShortcutHelp.getState().setOpen(true); }} className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-muted hover:bg-surface-2 hover:text-foreground">
                <Keyboard className="h-4 w-4" aria-hidden /> Klavye kısayolları
                <kbd className="ml-auto rounded border border-border px-1.5 font-sans text-[11px] text-faint">?</kbd>
              </button>
              <form action="/auth/signout" method="post" onSubmit={() => forgetSessionSnapshot()}><button type="submit" className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-muted hover:bg-danger/10 hover:text-danger"><LogOut className="h-4 w-4" aria-hidden /> Çıkış yap</button></form>
            </div>
          </div>}
        </div>
      </div>
    </header>
  );
}
