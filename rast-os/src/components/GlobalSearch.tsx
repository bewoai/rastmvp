"use client";

import { useCallback, useDeferredValue, useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import {
  ArrowLeft, ArrowUpRight, Briefcase, Building2, CalendarDays, Camera, Contact, CornerDownLeft,
  FileSignature, FolderKanban, ListTodo, Palette, Radar, Receipt, Search, Users,
} from "lucide-react";
import { useStore } from "@/lib/store";
import { searchNav } from "@/lib/nav";
import { RECORD_KINDS, RECORD_KIND_LABEL, buildSearchIndex, searchRecords, type RecordKind } from "@/lib/search-logic";

const KIND_ICON: Record<RecordKind, LucideIcon> = {
  clients: Building2, brands: Palette, contacts: Contact, projects: FolderKanban, tasks: ListTodo, jobs: Briefcase,
  invoices: Receipt, proposals: FileSignature, leads: Users, prospects: Radar, contents: CalendarDays, shoots: Camera,
};

type Option = { key: string; href: string; label: string; sub?: string; icon: LucideIcon; group: string };
type Group = { id: string; label: string; options: Option[]; more?: number };

const SEARCH_KINDS = RECORD_KINDS.map((k) => k.kind);

/** Store'daki yüklü kayıtlar (yalnız arama kutusu açıkken indekslenir). */
function useSearchSource(active: boolean) {
  const clients = useStore((s) => s.clients);
  const brands = useStore((s) => s.brands);
  const contacts = useStore((s) => s.contacts);
  const projects = useStore((s) => s.projects);
  const tasks = useStore((s) => s.tasks);
  const jobs = useStore((s) => s.jobs);
  const invoices = useStore((s) => s.invoices);
  const proposals = useStore((s) => s.proposals);
  const leads = useStore((s) => s.leads);
  const prospects = useStore((s) => s.prospects);
  const contents = useStore((s) => s.contents);
  const shoots = useStore((s) => s.shoots);
  return useMemo(
    () => (active ? buildSearchIndex({ clients, brands, contacts, projects, tasks, jobs, invoices, proposals, leads, prospects, contents, shoots }) : []),
    [active, clients, brands, contacts, projects, tasks, jobs, invoices, proposals, leads, prospects, contents, shoots],
  );
}

/** Supabase modunda henüz yüklenmemiş (aranamayan) kayıt türleri — ör. Müşteri Bulma sayfası açılmadıysa adaylar. */
function useUnloadedKinds(): RecordKind[] {
  const supabase = useStore((s) => s.supabase);
  const loaded = useStore((s) => s.loadedCollections);
  return useMemo(() => (supabase ? SEARCH_KINDS.filter((k) => !loaded[k]) : []), [supabase, loaded]);
}

function useResults(term: string, active: boolean): Group[] {
  const index = useSearchSource(active);
  return useMemo(() => {
    if (!term.trim()) return [];
    const groups: Group[] = [];
    const screens = searchNav(term, 5);
    if (screens.length) {
      groups.push({
        id: "screens", label: "Ekranlar",
        options: screens.map((s) => ({ key: `screen:${s.href}`, href: s.href, label: s.label, icon: s.icon, group: "Ekran" })),
      });
    }
    for (const g of searchRecords(index, term, 4)) {
      groups.push({
        id: g.kind, label: g.label, more: g.more,
        options: g.items.map((d) => ({ key: `${d.kind}:${d.id}`, href: d.href, label: d.title, sub: d.subtitle, icon: KIND_ICON[d.kind], group: RECORD_KIND_LABEL[d.kind] })),
      });
    }
    return groups;
  }, [term, index]);
}

/**
 * Sonuç listesi (combobox'ın listbox'ı): gruplu (Ekranlar + kayıt türleri), aktif seçenek vurgulu.
 * Klavye yönetimi input'ta (aria-activedescendant); fareyle tıklama da gezinir.
 */
function ResultList({
  listId, groups, active, onPick, onHover, term, unloaded,
}: {
  listId: string;
  groups: Group[];
  active: number;
  onPick: (o: Option) => void;
  onHover: (i: number) => void;
  term: string;
  unloaded: RecordKind[];
}) {
  let i = -1;
  const empty = groups.length === 0;
  return (
    <div>
      <div id={listId} role="listbox" aria-label="Arama sonuçları" className="p-1.5">
        {empty ? (
          <p role="presentation" className="px-3 py-3 text-sm text-muted">“{term.trim()}” için ekran veya kayıt bulunamadı.</p>
        ) : (
          groups.map((g) => (
            <div key={g.id} role="group" aria-labelledby={`${listId}-${g.id}`} className="pb-1">
              <p id={`${listId}-${g.id}`} role="presentation" className="flex items-baseline gap-2 px-3 pb-1 pt-2 text-xs font-medium text-faint">
                {g.label}
                {g.more ? <span className="font-normal">+{g.more} daha</span> : null}
              </p>
              {g.options.map((o) => {
                i++;
                const idx = i;
                const selected = idx === active;
                const Icon = o.icon;
                return (
                  <div
                    key={o.key}
                    id={`${listId}-o${idx}`}
                    role="option"
                    aria-selected={selected}
                    onMouseDown={(e) => e.preventDefault()} // input odağı kaybolmasın
                    onClick={() => onPick(o)}
                    onMouseMove={() => { if (!selected) onHover(idx); }}
                    className={`flex min-h-10 cursor-pointer items-center gap-3 rounded-md px-3 py-1.5 text-sm ${selected ? "bg-surface-2 text-foreground" : "text-muted"}`}
                  >
                    <Icon className="h-4 w-4 shrink-0 text-faint" aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-foreground">{o.label}</span>
                      {o.sub && <span className="block truncate text-xs text-muted">{o.sub}</span>}
                    </span>
                    {selected ? <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-faint" aria-hidden /> : <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-faint opacity-0" aria-hidden />}
                  </div>
                );
              })}
            </div>
          ))
        )}
      </div>
      {unloaded.length > 0 && (
        <p className="border-t border-border px-4 py-2 text-xs text-faint">
          Henüz yüklenmedi, aranmıyor: {unloaded.map((k) => RECORD_KIND_LABEL[k]).join(", ")}. İlgili sayfa açılınca aranır.
        </p>
      )}
    </div>
  );
}

/** Ortak durum: terim, aktif seçenek, klavye ile gezinme ve seçim. */
function useCombobox(onDone: () => void, active: boolean) {
  const router = useRouter();
  const [term, setTerm] = useState("");
  const deferred = useDeferredValue(term);
  const groups = useResults(deferred, active);
  const options = useMemo(() => groups.flatMap((g) => g.options), [groups]);
  const [activeIdx, setActiveIdx] = useState(0);
  // Sonuçlar değişince ilk seçenek aktif (render sırasında ayarlanır; effect'te setState yok).
  const [seenOptions, setSeenOptions] = useState(options);
  if (seenOptions !== options) {
    setSeenOptions(options);
    setActiveIdx(0);
  }

  const pick = useCallback((o: Option) => {
    router.push(o.href);
    setTerm("");
    onDone();
  }, [router, onDone]);

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!options.length) return;
      e.preventDefault();
      const d = e.key === "ArrowDown" ? 1 : -1;
      setActiveIdx((i) => (i + d + options.length) % options.length);
    } else if (e.key === "Home" && options.length && e.ctrlKey) {
      e.preventDefault();
      setActiveIdx(0);
    } else if (e.key === "End" && options.length && e.ctrlKey) {
      e.preventDefault();
      setActiveIdx(options.length - 1);
    } else if (e.key === "Enter") {
      const o = options[activeIdx] ?? options[0];
      if (o) {
        e.preventDefault();
        pick(o);
      }
    }
  }

  return { term, setTerm, deferred, groups, options, activeIdx: options.length ? Math.min(activeIdx, options.length - 1) : -1, setActiveIdx, pick, onKeyDown };
}

/**
 * Üst çubuktaki arama (Ctrl/⌘K): ekranlar + kayıtlar (müşteri, marka, kişi, proje, görev, tekil iş, fatura,
 * teklif, lead, aday, içerik, çekim). Store'daki yüklü veriden istemcide aranır — ağ isteği yok.
 * Masaüstünde satır içi kutu + açılır liste; mobilde büyüteç düğmesi tam genişlik arama penceresi açar.
 */
export default function GlobalSearch() {
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [sheet, setSheet] = useState(false);
  const closeAll = useCallback(() => {
    setOpen(false);
    setSheet(false);
    inputRef.current?.blur();
  }, []);
  const closeSheet = useCallback(() => setSheet(false), []);
  const cb = useCombobox(closeAll, open || sheet);
  const unloaded = useUnloadedKinds();
  const showList = open && cb.term.trim().length > 0;

  // Ctrl/⌘K: masaüstünde kutuya odaklan, mobilde arama penceresini aç.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (window.matchMedia("(min-width: 768px)").matches) {
          inputRef.current?.focus();
          inputRef.current?.select();
          setOpen(true);
        } else {
          setSheet(true);
        }
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // Dışarı tıklayınca kapanır.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // Aktif seçenek görünür kalsın.
  useEffect(() => {
    if (cb.activeIdx < 0) return;
    document.getElementById(`${listId}-o${cb.activeIdx}`)?.scrollIntoView({ block: "nearest" });
  }, [cb.activeIdx, listId]);

  const activeId = cb.activeIdx >= 0 && (showList || sheet) ? `${listId}-o${cb.activeIdx}` : undefined;

  return (
    <>
      {/* Mobil: büyüteç → arama penceresi */}
      <button
        type="button"
        onClick={() => setSheet(true)}
        aria-label="Ara"
        className="flex h-10 w-10 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-2 hover:text-foreground md:hidden"
      >
        <Search className="h-5 w-5" aria-hidden />
      </button>

      {/* Masaüstü: satır içi kutu */}
      <div ref={boxRef} className="relative hidden max-w-xl flex-1 md:block">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
        <input
          ref={inputRef}
          value={cb.term}
          onChange={(e) => { cb.setTerm(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              if (cb.term) cb.setTerm("");
              else closeAll();
              return;
            }
            cb.onKeyDown(e);
          }}
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={activeId}
          aria-label="Ara: kayıtlar ve ekranlar"
          placeholder="Ara: müşteri, proje, görev, fatura, ekran…"
          autoComplete="off"
          spellCheck={false}
          className="h-9 w-full rounded-lg border border-border bg-surface pl-10 pr-20 text-sm text-foreground outline-none transition-colors placeholder:text-faint hover:border-[#333] focus:border-accent/60"
        />
        <kbd className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded border border-border px-1.5 py-px font-sans text-[11px] text-faint">Ctrl K</kbd>
        {showList && (
          <div className="popover absolute left-0 right-0 top-11 z-50 max-h-[min(30rem,70vh)] overflow-y-auto">
            <ResultList listId={listId} groups={cb.groups} active={cb.activeIdx} onPick={cb.pick} onHover={cb.setActiveIdx} term={cb.deferred} unloaded={unloaded} />
          </div>
        )}
      </div>

      {sheet && (
        <MobileSearchSheet onClose={closeSheet}>
          <div className="flex items-center gap-1 border-b border-border px-2 py-2">
            <button type="button" onClick={closeSheet} aria-label="Aramayı kapat" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-foreground">
              <ArrowLeft className="h-5 w-5" aria-hidden />
            </button>
            <input
              autoFocus
              value={cb.term}
              onChange={(e) => cb.setTerm(e.target.value)}
              onKeyDown={cb.onKeyDown}
              role="combobox"
              aria-expanded={cb.term.trim().length > 0}
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={activeId}
              aria-label="Ara: kayıtlar ve ekranlar"
              placeholder="Müşteri, proje, görev, fatura…"
              autoComplete="off"
              spellCheck={false}
              enterKeyHint="go"
              className="h-10 min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 text-base text-foreground outline-none placeholder:text-faint focus:border-accent/60"
            />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {cb.term.trim() ? (
              <ResultList listId={listId} groups={cb.groups} active={cb.activeIdx} onPick={cb.pick} onHover={cb.setActiveIdx} term={cb.deferred} unloaded={unloaded} />
            ) : (
              <p className="px-4 py-6 text-sm text-muted">Müşteri, marka, kişi, proje, görev, iş, fatura, teklif, lead, içerik veya çekim adı yaz; ekran adıyla da gidebilirsin.</p>
            )}
          </div>
        </MobileSearchSheet>
      )}
    </>
  );
}

/** Mobil tam ekran arama penceresi: Escape / geri düğmesi kapatır, kapanınca odak tetikleyiciye döner. */
function MobileSearchSheet({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
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
    <div className="fixed inset-0 z-50 flex flex-col bg-background md:hidden" role="dialog" aria-modal="true" aria-label="Ara">
      {children}
    </div>
  );
}
