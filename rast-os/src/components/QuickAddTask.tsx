"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { CalendarDays, Flag, FolderKanban } from "lucide-react";
import { Button } from "@/components/form";
import { useStore, useHydrated, uid, nowISO } from "@/lib/store";
import { useQuickAdd } from "@/lib/quickAdd";
import { useToasts } from "@/lib/toast";
import { createTask } from "@/lib/taskActions";
import { addDaysKey, todayKey } from "@/lib/taskLogic";
import { priority as prioMap } from "@/lib/labels";
import type { Priority, Task } from "@/lib/types";

const PRIORITIES: Priority[] = ["urgent", "high", "medium", "low"];

const chipCls =
  "inline-flex h-8 items-center gap-1.5 rounded-lg border border-border/80 bg-background/60 px-2.5 text-xs text-muted transition-colors focus-within:border-amber/60 hover:text-foreground";

function isTypingTarget(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  if (!el || !el.tagName) return false;
  return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable;
}

/**
 * Form durumu bu bileşenin içinde yaşar: yazarken yalnızca burası render olur (hatta başlık
 * alanı kontrolsüzdür; sadece "boş/dolu" değişince render). Sayfa listeleri etkilenmez.
 */
function Composer() {
  const close = useQuickAdd((s) => s.closeComposer);
  const projects = useStore((s) => s.projects);
  const pathname = usePathname();
  // Yalnızca "projects" istenir (oturum init + tek koleksiyon); global hydration yok.
  useHydrated(["projects"]);

  const inputRef = useRef<HTMLInputElement>(null);
  const [today] = useState(() => todayKey());
  const [hasText, setHasText] = useState(false);
  const [due, setDue] = useState(() => useQuickAdd.getState().defaultDue);
  const [prio, setPrio] = useState<Priority>("medium");
  const [projectId, setProjectId] = useState("");

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    inputRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      if (previous && document.contains(previous)) previous.focus();
    };
  }, [close]);

  function submit(keepOpen: boolean) {
    const input = inputRef.current;
    const title = input?.value.trim() ?? "";
    if (!input || !title) return;

    // Çift gönderim koruması: alan senkron olarak boşaltılır; aynı tick'teki ikinci
    // Enter / çift tık boş başlık görür ve hiçbir şey yapmaz.
    input.value = "";
    setHasText(false);

    const task: Task = {
      id: uid(),
      title,
      project_id: projectId || undefined,
      due_date: due || undefined,
      priority: prio,
      status: "todo",
      created_at: nowISO(),
    };
    // store.add görevi anında state'e yazar (liste hemen güncellenir); insert arkadan gider.
    createTask(task).then((r) => {
      if (r.ok && pathname !== "/tasks") {
        useToasts.getState().push({ message: "Görev eklendi", href: "/tasks", hrefLabel: "Görevlere git" });
      }
    });

    if (keepOpen) inputRef.current?.focus();
    else close();
  }

  function onTitleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    // IME onayı (keyCode 229) ve tuşa basılı tutma tekrarı görev eklemesin
    if (e.nativeEvent.isComposing || e.keyCode === 229 || e.repeat) return;
    e.preventDefault();
    submit(e.shiftKey);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[10vh] md:pt-[14vh]">
      <div className="fixed inset-0 bg-black/70 backdrop-blur-sm" onClick={close} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Hızlı görev ekle"
        className="card relative z-10 w-full max-w-xl overflow-hidden shadow-2xl"
      >
        <div className="px-4 pt-4">
          <input
            ref={inputRef}
            type="text"
            aria-label="Görev başlığı"
            placeholder="Yeni görev… (Enter ile ekle)"
            autoComplete="off"
            maxLength={300}
            onChange={(e) => setHasText(e.target.value.trim().length > 0)}
            onKeyDown={onTitleKeyDown}
            className="w-full bg-transparent py-1 text-base text-foreground outline-none placeholder:text-muted"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2 px-4 py-3">
          <label className={chipCls}>
            <CalendarDays className="h-3.5 w-3.5" aria-hidden />
            <input
              type="date"
              aria-label="Son tarih"
              value={due}
              onChange={(e) => setDue(e.target.value)}
              className="bg-transparent text-xs text-foreground outline-none [color-scheme:dark]"
            />
          </label>
          <button
            type="button"
            onClick={() => setDue(due === today ? "" : today)}
            aria-pressed={due === today}
            className={`${chipCls} ${due === today ? "!border-amber/60 !text-amber" : ""}`}
          >
            Bugün
          </button>
          <button
            type="button"
            onClick={() => setDue(due === addDaysKey(today, 1) ? "" : addDaysKey(today, 1))}
            aria-pressed={due === addDaysKey(today, 1)}
            className={`${chipCls} ${due === addDaysKey(today, 1) ? "!border-amber/60 !text-amber" : ""}`}
          >
            Yarın
          </button>

          <label className={chipCls}>
            <Flag className="h-3.5 w-3.5" aria-hidden />
            <select
              aria-label="Öncelik"
              value={prio}
              onChange={(e) => setPrio(e.target.value as Priority)}
              className="cursor-pointer bg-transparent text-xs text-foreground outline-none"
            >
              {PRIORITIES.map((p) => (
                <option key={p} value={p} className="bg-surface">{prioMap[p].label}</option>
              ))}
            </select>
          </label>

          {projects.length > 0 && (
            <label className={`${chipCls} max-w-full`}>
              <FolderKanban className="h-3.5 w-3.5 shrink-0" aria-hidden />
              <select
                aria-label="Proje"
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                className="min-w-0 max-w-[12rem] cursor-pointer truncate bg-transparent text-xs text-foreground outline-none"
              >
                <option value="" className="bg-surface">Proje yok</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id} className="bg-surface">{p.name}</option>
                ))}
              </select>
            </label>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-border/80 bg-white/[0.02] px-4 py-3">
          <p className="hidden text-[11px] text-muted sm:block">
            <kbd className="rounded border border-border px-1">Enter</kbd> ekle ·{" "}
            <kbd className="rounded border border-border px-1">Shift+Enter</kbd> ekle, devam et ·{" "}
            <kbd className="rounded border border-border px-1">Esc</kbd> kapat
          </p>
          <div className="ml-auto flex gap-2">
            <Button variant="ghost" onClick={close}>Vazgeç</Button>
            <Button disabled={!hasText} onClick={() => submit(false)}>Görev ekle</Button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * AppShell'e bir kez takılır: global "Q" kısayolu + composer. Kendi başına abone olduğu tek
 * şey `open` olduğundan kabuk/sayfa yazarken yeniden render olmaz.
 */
export default function QuickAddHost() {
  const open = useQuickAdd((s) => s.open);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "q" && e.key !== "Q") return;
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey || e.repeat || e.isComposing || e.defaultPrevented) return;
      if (isTypingTarget(e.target)) return;
      if (document.querySelector('[aria-modal="true"]')) return; // başka bir diyalog açık
      e.preventDefault();
      useQuickAdd.getState().openComposer();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return open ? <Composer /> : null;
}
