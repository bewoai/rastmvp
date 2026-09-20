"use client";

import { useState } from "react";
import Sidebar from "./Sidebar";
import Topbar from "./Topbar";
import QuickAddHost from "./QuickAddTask";
import Toaster from "./Toaster";

export default function AppShell({
  children,
  userName,
}: {
  children: React.ReactNode;
  userName?: string | null;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative flex h-dvh overflow-hidden bg-background">
      {/* Masaüstü sidebar */}
      <div className="relative z-20 hidden md:block">
        <Sidebar />
      </div>

      {/* Mobil sidebar (drawer) */}
      {open && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div
            className="absolute inset-0 bg-black/60"
            onClick={() => setOpen(false)}
          />
          <div className="absolute left-0 top-0 h-full">
            <Sidebar onNavigate={() => setOpen(false)} />
          </div>
        </div>
      )}

      <div className="relative z-10 flex min-w-0 flex-1 flex-col">
        <Topbar onMenu={() => setOpen(true)} userName={userName} />
        <main className="app-main flex-1 overflow-y-auto p-4 md:p-7">{children}</main>
      </div>

      {/* Global Q Hızlı Görev Ekle + bildirimler (kendi state'leri; kabuğu render etmez) */}
      <QuickAddHost />
      <Toaster />
    </div>
  );
}
