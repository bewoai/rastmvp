"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { create } from "zustand";
import { Modal, Button } from "./form";
import { GENERAL_SHORTCUTS, GOTO_SHORTCUTS, GOTO_TIMEOUT_MS, gotoHref, isTypingTarget } from "@/lib/shortcuts";

/** Kısayol yardım penceresinin durumu (hesap menüsünden de açılır). */
export const useShortcutHelp = create<{ open: boolean; setOpen: (open: boolean) => void }>()((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));

function Keys({ keys }: { keys: string[] }) {
  return (
    <span className="flex shrink-0 items-center gap-1">
      {keys.map((k, i) => (
        <kbd key={i} className="min-w-6 rounded border border-border bg-surface-2 px-1.5 py-px text-center font-sans text-xs text-foreground">{k}</kbd>
      ))}
    </span>
  );
}

function HelpDialog({ onClose }: { onClose: () => void }) {
  return (
    <Modal open onClose={onClose} title="Klavye kısayolları" size="md" footer={<Button onClick={onClose} data-autofocus>Kapat</Button>}>
      <div className="grid gap-5 sm:grid-cols-2">
        <section aria-labelledby="ks-genel">
          <h3 id="ks-genel" className="mb-2 text-xs font-medium text-faint">Genel</h3>
          <ul className="space-y-1.5">
            {GENERAL_SHORTCUTS.map((s) => (
              <li key={s.label} className="flex items-center justify-between gap-3 text-sm text-muted">
                <span>{s.label}</span>
                <Keys keys={s.keys} />
              </li>
            ))}
          </ul>
        </section>
        <section aria-labelledby="ks-git">
          <h3 id="ks-git" className="mb-2 text-xs font-medium text-faint">Git: önce G, sonra harf</h3>
          <ul className="space-y-1.5">
            {GOTO_SHORTCUTS.map((s) => (
              <li key={s.key} className="flex items-center justify-between gap-3 text-sm text-muted">
                <span>{s.label}</span>
                <Keys keys={["G", s.key.toLocaleUpperCase("tr-TR")]} />
              </li>
            ))}
          </ul>
        </section>
      </div>
      <p className="mt-5 text-xs text-faint">Bir yazı alanı odaktayken ya da başka bir pencere açıkken kısayollar çalışmaz.</p>
    </Modal>
  );
}

/**
 * Global klavye kısayolları (AppShell'e bir kez takılır): "g" + harf ile gezinme, "?" ile yardım.
 * Yazı alanı (input/textarea/select/contenteditable) odaktayken, değiştirici tuşlarla ya da bir diyalog
 * açıkken devre dışı. "Q" (hızlı görev) ve Ctrl/⌘K kendi bileşenlerinde.
 */
export default function KeyboardShortcuts() {
  const router = useRouter();
  const open = useShortcutHelp((s) => s.open);
  const setOpen = useShortcutHelp((s) => s.setOpen);
  const pendingG = useRef<number>(0);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.defaultPrevented || e.repeat || e.isComposing || e.ctrlKey || e.metaKey || e.altKey) return;
      if (isTypingTarget(e.target)) return;
      if (document.querySelector('[aria-modal="true"]')) return; // başka bir diyalog açık
      const key = e.key;

      if (key === "?") {
        e.preventDefault();
        pendingG.current = 0;
        useShortcutHelp.getState().setOpen(true);
        return;
      }
      if (e.shiftKey) return;

      const now = Date.now();
      if (pendingG.current && now - pendingG.current <= GOTO_TIMEOUT_MS) {
        pendingG.current = 0;
        const href = gotoHref(key);
        if (href) {
          e.preventDefault();
          router.push(href);
        }
        return;
      }
      if (key === "g" || key === "G") {
        pendingG.current = now;
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [router]);

  return open ? <HelpDialog onClose={() => setOpen(false)} /> : null;
}
