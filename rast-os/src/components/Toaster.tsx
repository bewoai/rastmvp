"use client";

import Link from "next/link";
import { X } from "lucide-react";
import { useToasts } from "@/lib/toast";

export default function Toaster() {
  const toasts = useToasts((s) => s.toasts);
  const dismiss = useToasts((s) => s.dismiss);
  if (toasts.length === 0) return null;

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed bottom-24 left-1/2 z-[60] flex w-[min(24rem,calc(100vw-2rem))] -translate-x-1/2 flex-col gap-2 md:bottom-6"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          role={t.tone === "danger" ? "alert" : "status"}
          className={`card pointer-events-auto flex items-center gap-3 px-4 py-3 text-sm shadow-2xl ${
            t.tone === "danger" ? "!border-danger/60 text-danger" : "text-foreground"
          }`}
        >
          <span className="min-w-0 flex-1">{t.message}</span>
          {t.href && (
            <Link prefetch={false} href={t.href} onClick={() => dismiss(t.id)} className="shrink-0 text-xs font-medium text-amber hover:text-amber-hi">
              {t.hrefLabel ?? "Görüntüle"}
            </Link>
          )}
          <button onClick={() => dismiss(t.id)} className="shrink-0 text-muted hover:text-foreground" aria-label="Kapat">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
