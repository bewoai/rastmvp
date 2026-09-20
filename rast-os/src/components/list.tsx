"use client";

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ArrowDown, ArrowUp, ChevronDown, Pencil, Search, Trash2, X } from "lucide-react";
import { Badge, PageHeader } from "./ui";

/* ------------------------------------------------------------------ */
/* Kalıcı görünüm/filtre durumu                                        */
/* ------------------------------------------------------------------ */

/**
 * Seçili sekme/filtre tarayıcıda hatırlanır (geri dönünce aynı görünüm). Yalnızca `valid` içindeki
 * değerler kabul edilir; localStorage yoksa/engelliyse sessizce varsayılana düşer. Sayfa içeriği
 * `hydrated` olana kadar render edilmediğinden SSR/hydration uyuşmazlığı oluşmaz.
 */
export function usePersistentState<T extends string>(
  key: string,
  initial: T,
  valid: readonly T[],
): [T, (next: T) => void] {
  const storageKey = `rast:${key}`;
  const [value, setValue] = useState<T>(() => {
    try {
      const saved = window.localStorage.getItem(storageKey);
      if (saved && (valid as readonly string[]).includes(saved)) return saved as T;
    } catch {
      /* localStorage kullanılamıyor */
    }
    return initial;
  });
  const update = useCallback(
    (next: T) => {
      setValue(next);
      try {
        window.localStorage.setItem(storageKey, next);
      } catch {
        /* yok say */
      }
    },
    [storageKey],
  );
  return [value, update];
}

/**
 * `?new=1` ile gelinen sayfada oluşturma modalı doğrudan açılsın (Dashboard hızlı eylemleri).
 * İlk render'da okunur (useState başlatıcısında kullan), parametre adres çubuğundan temizlenir.
 */
export function useNewIntent(): boolean {
  const [wanted] = useState(() => {
    try {
      return new URLSearchParams(window.location.search).get("new") === "1";
    } catch {
      return false;
    }
  });
  useEffect(() => {
    if (!wanted) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("new");
    window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
  }, [wanted]);
  return wanted;
}

/* ------------------------------------------------------------------ */
/* Arama                                                               */
/* ------------------------------------------------------------------ */

/** Yazarken listeyi bloklamaz (useDeferredValue); tek geçiş O(N), Türkçe büyük/küçük harf duyarlı. */
export function useListSearch<T>(rows: T[], query: string, haystack: (row: T) => string): T[] {
  const deferred = useDeferredValue(query);
  return useMemo(() => {
    const q = deferred.trim().toLocaleLowerCase("tr-TR");
    if (!q) return rows;
    return rows.filter((row) => haystack(row).toLocaleLowerCase("tr-TR").includes(q));
    // haystack sayfa düzeyinde sabit bir fonksiyondur
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, deferred]);
}

export function SearchBox({
  value,
  onChange,
  placeholder = "Ara…",
  label = "Ara",
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  label?: string;
}) {
  return (
    <div className="relative w-full sm:w-64">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={label}
        autoComplete="off"
        className="h-10 w-full rounded-xl border border-border/80 bg-surface/60 pl-9 pr-9 text-base text-foreground outline-none transition-shadow placeholder:text-muted/60 focus:border-amber/60 focus:ring-4 focus:ring-amber/10 md:h-9 md:text-sm [&::-webkit-search-cancel-button]:hidden"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label="Aramayı temizle"
          className="absolute right-1.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Sekme / filtre                                                      */
/* ------------------------------------------------------------------ */

export interface TabItem<T extends string> {
  id: T;
  label: string;
  count?: number;
  icon?: React.ReactNode;
}

/**
 * Alt çizgili sekmeler (sayfanın "görünümleri"). role=tablist, ←/→/Home/End ile gezinme.
 * İçeriği çağıran taraf `role="tabpanel"` ile sarar.
 */
export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  label,
  className = "",
}: {
  tabs: TabItem<T>[];
  value: T;
  onChange: (id: T) => void;
  label: string;
  className?: string;
}) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});

  function onKeyDown(e: React.KeyboardEvent) {
    const i = tabs.findIndex((t) => t.id === value);
    let next = -1;
    if (e.key === "ArrowRight") next = (i + 1) % tabs.length;
    else if (e.key === "ArrowLeft") next = (i - 1 + tabs.length) % tabs.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = tabs.length - 1;
    if (next < 0) return;
    e.preventDefault();
    onChange(tabs[next].id);
    refs.current[tabs[next].id]?.focus();
  }

  return (
    <div
      role="tablist"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={`flex gap-0.5 overflow-x-auto overflow-y-hidden border-b border-border/70 [scrollbar-width:none] sm:gap-1 [&::-webkit-scrollbar]:hidden ${className}`}
    >
      {tabs.map((t) => {
        const active = t.id === value;
        return (
          <button
            key={t.id}
            ref={(el) => {
              refs.current[t.id] = el;
            }}
            type="button"
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(t.id)}
            className={`-mb-px flex min-h-10 shrink-0 items-center gap-1.5 border-b-2 px-2.5 py-2 text-sm transition-colors sm:px-3 ${
              active ? "border-amber text-foreground" : "border-transparent text-muted hover:text-foreground"
            }`}
          >
            {t.icon}
            {t.label}
            {t.count !== undefined && <span className="text-xs text-muted">{t.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** Kompakt filtre hapları (durum/kapsam filtreleri). aria-pressed: sekme değil, açma/kapama grubu. */
export function FilterChips<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: TabItem<T>[];
  value: T;
  onChange: (id: T) => void;
  label: string;
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const active = o.id === value;
        return (
          <button
            key={o.id}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(o.id)}
            className={`inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-xs font-medium transition-colors md:h-8 ${
              active ? "bg-amber/20 text-amber" : "bg-surface-2/70 text-muted hover:text-foreground"
            }`}
          >
            {o.label}
            {o.count !== undefined && <span className={active ? "text-amber/80" : "text-muted/80"}>{o.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** Filtre + arama satırı: dar ekranda alt alta, geniş ekranda tek satır. */
export function Toolbar({ children }: { children: React.ReactNode }) {
  return <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">{children}</div>;
}

/* ------------------------------------------------------------------ */
/* Satır işlemleri                                                     */
/* ------------------------------------------------------------------ */

const iconBtn =
  "flex h-10 w-10 items-center justify-center rounded-lg text-muted transition-colors md:h-8 md:w-8";

/** Tüm listelerde aynı yerde/aynı biçimde düzenle + sil. `label` ekran okuyucu için kaydın adı. */
export function RowActions({
  label,
  onEdit,
  onDelete,
  children,
}: {
  label: string;
  onEdit?: () => void;
  onDelete?: () => void;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-end gap-0.5">
      {children}
      {onEdit && (
        <button type="button" onClick={onEdit} aria-label={`Düzenle: ${label}`} title="Düzenle" className={`${iconBtn} hover:bg-surface-2 hover:text-foreground`}>
          <Pencil className="h-4 w-4" aria-hidden />
        </button>
      )}
      {onDelete && (
        <button type="button" onClick={onDelete} aria-label={`Sil: ${label}`} title="Sil" className={`${iconBtn} hover:bg-danger/15 hover:text-danger`}>
          <Trash2 className="h-4 w-4" aria-hidden />
        </button>
      )}
    </div>
  );
}

/**
 * Satır içi durum seçici: Badge görünümü + şeffaf yerel <select> (mobilde yerel seçici açılır,
 * klavyeyle erişilebilir). Tüm listelerde durum değiştirmenin tek biçimi.
 */
export function StatusSelect<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string; tone: "default" | "amber" | "success" | "warning" | "danger" | "muted" }[];
  onChange: (next: T) => void;
  label: string;
}) {
  const current = options.find((o) => o.value === value);
  return (
    <label className="relative inline-flex cursor-pointer rounded-full focus-within:ring-2 focus-within:ring-amber/60">
      <Badge tone={current?.tone ?? "muted"}>
        {current?.label ?? value}
        <ChevronDown className="ml-1 h-3 w-3 opacity-70" aria-hidden />
      </Badge>
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </label>
  );
}

/* ------------------------------------------------------------------ */
/* DataTable                                                           */
/* ------------------------------------------------------------------ */

export interface Column<T> {
  key: string;
  header: string;
  cell: (row: T) => React.ReactNode;
  /** primary: ana bilgi (kalın, `onOpen` ile tıklanabilir) · strong: vurgulu değer · quiet (varsayılan): ikincil */
  tone?: "primary" | "strong" | "quiet";
  /** Mobil kart yerleşimi: title = kart başlığı, badge = sağ üst, meta = etiketli satır, hide = gösterme */
  mobile?: "title" | "badge" | "meta" | "hide";
  className?: string;
  /** Verilirse başlık tıklanarak sıralanır (tablo düzeninde). */
  sort?: (row: T) => string | number | undefined;
}

const desktopQuery = "(min-width: 768px)";
function subscribeDesktop(cb: () => void) {
  const mq = window.matchMedia(desktopQuery);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}
const useIsDesktop = () =>
  useSyncExternalStore(
    subscribeDesktop,
    () => window.matchMedia(desktopQuery).matches,
    () => true,
  );

const toneCls = { primary: "font-medium text-foreground", strong: "text-foreground", quiet: "text-muted" } as const;

/**
 * Operasyon listeleri için tek bileşen: md+ kompakt tablo, mobilde kart listesi (yatay kaydırma yok).
 * Yalnızca geçerli düzen render edilir (DOM iki kat olmaz). `onOpen` verilirse `mobile:"title"` sütunu
 * klavyeyle erişilebilir bir düğme olur (tıkla → düzenle).
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  actions,
  onOpen,
  openLabel,
  empty,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  actions?: (row: T) => React.ReactNode;
  onOpen?: (row: T) => void;
  openLabel?: (row: T) => string;
  empty?: React.ReactNode;
}) {
  const desktop = useIsDesktop();
  const [sortState, setSortState] = useState<{ key: string; dir: 1 | -1 } | null>(null);

  const sortedRows = useMemo(() => {
    const col = sortState && columns.find((c) => c.key === sortState.key);
    if (!sortState || !col?.sort) return rows;
    const get = col.sort;
    const dir = sortState.dir;
    return [...rows].sort((a, b) => {
      const va = get(a);
      const vb = get(b);
      if (va === undefined || va === "") return vb === undefined || vb === "" ? 0 : 1; // boşlar hep sonda
      if (vb === undefined || vb === "") return -1;
      if (typeof va === "number" && typeof vb === "number") return (va - vb) * dir;
      return String(va).localeCompare(String(vb), "tr-TR") * dir;
    });
  }, [rows, columns, sortState]);

  if (rows.length === 0 && empty) return <>{empty}</>;

  function toggleSort(key: string) {
    setSortState((s) => (!s || s.key !== key ? { key, dir: 1 } : s.dir === 1 ? { key, dir: -1 } : null));
  }

  const renderCell = (col: Column<T>, row: T) => {
    const content = col.cell(row);
    if (onOpen && col.mobile === "title") {
      return (
        <button
          type="button"
          onClick={() => onOpen(row)}
          aria-label={openLabel ? openLabel(row) : undefined}
          className="block max-w-full rounded-md text-left outline-none transition-colors hover:text-amber focus-visible:ring-2 focus-visible:ring-amber/60"
        >
          {content}
        </button>
      );
    }
    return content;
  };

  if (desktop) {
    return (
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted">
              {columns.map((col) => {
                const active = sortState?.key === col.key;
                return (
                  <th
                    key={col.key}
                    scope="col"
                    aria-sort={active ? (sortState.dir === 1 ? "ascending" : "descending") : undefined}
                    className={`px-3 py-2.5 font-medium ${col.className ?? ""}`}
                  >
                    {col.sort ? (
                      <button
                        type="button"
                        onClick={() => toggleSort(col.key)}
                        className={`inline-flex items-center gap-1 rounded outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-amber/60 ${active ? "text-foreground" : ""}`}
                      >
                        {col.header}
                        {active && (sortState.dir === 1 ? <ArrowUp className="h-3 w-3" aria-hidden /> : <ArrowDown className="h-3 w-3" aria-hidden />)}
                      </button>
                    ) : (
                      col.header
                    )}
                  </th>
                );
              })}
              {actions && <th scope="col" className="w-px px-3 py-2.5"><span className="sr-only">İşlemler</span></th>}
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((row) => (
              <tr key={rowKey(row)} className="border-b border-border/50 last:border-0 hover:bg-surface-2/40">
                {columns.map((col) => (
                  <td key={col.key} className={`px-3 py-2 align-middle ${toneCls[col.tone ?? "quiet"]} ${col.className ?? ""}`}>
                    {renderCell(col, row)}
                  </td>
                ))}
                {actions && <td className="px-2 py-1 align-middle">{actions(row)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  const title = columns.find((c) => c.mobile === "title") ?? columns[0];
  const badges = columns.filter((c) => c.mobile === "badge");
  const metas = columns.filter((c) => (c.mobile ?? "meta") === "meta" && c !== title);

  return (
    <ul className="space-y-2">
      {rows.map((row) => (
        <li key={rowKey(row)} className="card p-3.5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1 text-sm font-medium text-foreground">{renderCell(title, row)}</div>
            {badges.length > 0 && <div className="flex shrink-0 flex-col items-end gap-1">{badges.map((b) => <div key={b.key}>{b.cell(row)}</div>)}</div>}
          </div>
          {metas.length > 0 && (
            <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
              {metas.map((m) => (
                <div key={m.key} className="min-w-0">
                  <dt className="text-muted/80">{m.header}</dt>
                  <dd className={`truncate ${m.tone === "strong" ? "text-foreground" : "text-muted"}`}>{m.cell(row)}</dd>
                </div>
              ))}
            </dl>
          )}
          {actions && <div className="mt-2 border-t border-border/60 pt-1.5">{actions(row)}</div>}
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------------ */
/* Yükleniyor iskeleti                                                 */
/* ------------------------------------------------------------------ */

/** Veri gelene kadar başlık + sabit yükseklikli iskelet satırlar (layout kayması yok, hafif pulse). */
export function PageLoading({ title, subtitle, rows = 6 }: { title: string; subtitle?: string; rows?: number }) {
  return (
    <div role="status" aria-live="polite" aria-busy="true">
      <PageHeader title={title} subtitle={subtitle} />
      <span className="sr-only">Yükleniyor…</span>
      <div className="card divide-y divide-border/50 overflow-hidden" aria-hidden>
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex animate-pulse items-center gap-4 px-4 py-3.5">
            <div className="h-3 w-1/4 rounded bg-surface-2" />
            <div className="hidden h-3 w-1/6 rounded bg-surface-2/70 sm:block" />
            <div className="ml-auto h-3 w-16 rounded bg-surface-2/70" />
          </div>
        ))}
      </div>
    </div>
  );
}
