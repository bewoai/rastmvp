"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronRight, LoaderCircle, X } from "lucide-react";
import type { MutationResult } from "@/lib/store";
import { useToasts } from "@/lib/toast";

/* ------------------------------------------------------------------ */
/* Modal                                                               */
/* ------------------------------------------------------------------ */

// Üst üste açılan diyaloglarda (ör. form + dosya önizleme) Escape yalnızca en üsttekini kapatır.
const modalStack: number[] = [];
let modalSeq = 0;

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
const FIELD = 'input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled])';

const sizeCls = { sm: "md:max-w-sm", md: "md:max-w-lg", lg: "md:max-w-3xl", xl: "md:max-w-5xl" } as const;

/**
 * Erişilebilir diyalog: role/aria-modal/aria-labelledby, odak diyaloğa taşınır ve kapanınca geri döner,
 * Tab diyalog içinde döner, Escape (yalnızca en üstteki) kapatır. Mobilde alttan açılan sayfa (bottom
 * sheet), masaüstünde ortalanmış kart. `onSubmit` verilirse gövde + alt bar bir <form> olur
 * (alan içinde Enter = kaydet; textarea'da Enter satır atlar).
 * `data-autofocus` işaretli öğe varsa ilk odak oradadır (ör. onay diyaloğunda "Vazgeç").
 */
export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  size = "md",
  onSubmit,
  locked = false,
  role = "dialog",
  autoFocusField = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: keyof typeof sizeCls;
  onSubmit?: (e: React.FormEvent<HTMLFormElement>) => void;
  /** Kayıt sürerken Escape/arka plan/kapat ile kapanmayı engeller. */
  locked?: boolean;
  role?: "dialog" | "alertdialog";
  autoFocusField?: boolean;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const closeRef = useRef(onClose);
  const lockedRef = useRef(locked);
  useEffect(() => {
    closeRef.current = onClose;
    lockedRef.current = locked;
  });

  useEffect(() => {
    if (!open) return;
    const id = ++modalSeq;
    modalStack.push(id);
    const previous = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    // Dokunmatik cihazda ilk alana otomatik odak klavyeyi açıp formu kapatır; yalnızca ince imleçte.
    const fine = !window.matchMedia("(pointer: coarse)").matches;
    const target =
      panel?.querySelector<HTMLElement>("[data-autofocus]") ??
      (autoFocusField && fine ? panel?.querySelector<HTMLElement>(FIELD) : null) ??
      panel;
    target?.focus();

    function onKey(e: KeyboardEvent) {
      if (modalStack[modalStack.length - 1] !== id) return;
      if (e.key === "Escape" && !e.defaultPrevented && !lockedRef.current) {
        e.preventDefault();
        closeRef.current();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      modalStack.splice(modalStack.indexOf(id), 1);
      if (previous && document.contains(previous)) previous.focus();
    };
  }, [open, autoFocusField]);

  // Sayfa içeriği z-10 katmanında; modal orada kalırsa sidebar (z-20) modalın üstüne biner ve arka plan
  // sidebar'ı örtmez. Portal ile body'ye taşınır (modal yalnızca hidrasyondan sonra açılır → SSR sorunu yok).
  if (!open || typeof document === "undefined") return null;

  function trapTab(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "Tab") return;
    const items = Array.from(panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []).filter(
      (el) => el.offsetParent !== null,
    );
    if (items.length === 0) {
      e.preventDefault();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === panelRef.current)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  }

  const body = (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5">{children}</div>
      {footer && (
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-border/80 bg-white/[0.02] px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {footer}
        </div>
      )}
    </>
  );

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center md:items-center md:p-4">
      <div
        aria-hidden
        className="absolute inset-0 bg-black/70"
        onClick={() => {
          if (!locked) onClose();
        }}
      />
      <div
        ref={panelRef}
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={trapTab}
        className={`relative z-10 flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-2xl border border-border bg-surface shadow-2xl outline-none md:max-h-[88dvh] md:rounded-2xl ${sizeCls[size]}`}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-border/80 bg-white/[0.02] px-5 py-3.5">
          <h3 id={titleId} className="text-base font-semibold tracking-tight text-foreground">{title}</h3>
          <button
            type="button"
            onClick={() => {
              if (!locked) onClose();
            }}
            className="-mr-2 flex h-10 w-10 items-center justify-center rounded-xl text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
            aria-label="Kapat"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {onSubmit ? (
          <form onSubmit={onSubmit} noValidate className="flex min-h-0 flex-1 flex-col">
            {body}
          </form>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">{body}</div>
        )}
      </div>
    </div>,
    document.body,
  );
}

/* ------------------------------------------------------------------ */
/* FormModal — kaydet akışı: bekleme, hata, çift gönderim, toast       */
/* ------------------------------------------------------------------ */

type SubmitResult = MutationResult | void;

/**
 * Oluştur/düzenle modalı. Üst bileşen bunu YALNIZCA gerektiğinde bağlar (`{modal && <XModal/>}`);
 * form state'i böylece her açılışta temiz başlar ve yazarken sayfa listesi render olmaz.
 *
 * `onSubmit` sonucu: `{ ok: false, error }` → modal AÇIK kalır, girilen değerler korunur, hata alt barda
 * görünür (doğrulama hataları da böyle döner). Aksi halde modal kapanır ve `successMessage` toast'ı çıkar.
 * Kaydet düğmesi bekleme durumunda kilitlenir; aynı tick'te ikinci gönderim (Enter + tık) yok sayılır.
 */
export function FormModal({
  title,
  onClose,
  onSubmit,
  children,
  size = "md",
  submitLabel = "Kaydet",
  submitDisabled = false,
  submitDisabledLabel,
  successMessage,
}: {
  title: string;
  onClose: () => void;
  onSubmit: () => SubmitResult | Promise<SubmitResult>;
  children: React.ReactNode;
  size?: keyof typeof sizeCls;
  submitLabel?: string;
  submitDisabled?: boolean;
  submitDisabledLabel?: string;
  successMessage?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inflight = useRef(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formEl = e.currentTarget;
    if (inflight.current || submitDisabled) return;
    inflight.current = true;
    setBusy(true);
    setError(null);

    let result: SubmitResult;
    try {
      result = await onSubmit();
    } catch (cause) {
      result = { ok: false, error: cause instanceof Error ? cause.message : "Kaydedilemedi. Lütfen tekrar deneyin." };
    }
    inflight.current = false;

    if (result && result.ok === false) {
      setBusy(false);
      setError(result.error || "Kaydedilemedi. Lütfen tekrar deneyin.");
      // Doğrulama hatasında imleci ilk alana götür (girilenler korunur)
      formEl.querySelector<HTMLElement>(FIELD)?.focus();
      return;
    }
    if (successMessage) useToasts.getState().push({ message: successMessage });
    onClose();
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      size={size}
      locked={busy}
      autoFocusField
      onSubmit={handleSubmit}
      footer={
        <>
          {error && (
            <p role="alert" className="mr-auto min-w-0 basis-full text-sm text-danger sm:basis-auto sm:max-w-[60%]">
              {error}
            </p>
          )}
          <Button variant="ghost" onClick={onClose} disabled={busy}>Vazgeç</Button>
          <Button type="submit" loading={busy} disabled={submitDisabled}>
            {busy ? "Kaydediliyor…" : submitDisabled && submitDisabledLabel ? submitDisabledLabel : submitLabel}
          </Button>
        </>
      }
    >
      {children}
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Form alanları                                                       */
/* ------------------------------------------------------------------ */

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-muted">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-muted">{hint}</span>}
    </label>
  );
}

// text-base (16px) mobilde: iOS Safari <16px alanlara odaklanınca sayfayı yakınlaştırır.
const inputCls =
  "w-full rounded-xl border border-border/80 bg-background/70 px-3.5 py-2.5 text-base text-foreground outline-none transition-shadow placeholder:text-muted/60 focus:border-amber/70 focus:ring-4 focus:ring-amber/10 disabled:opacity-60 md:text-sm";

const join = (a: string, b?: string) => (b ? `${a} ${b}` : a);

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={join(inputCls, className)} />;
}

export function Textarea({ className, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={join(inputCls, className)} rows={props.rows ?? 3} />;
}

export function Select({ className, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={join(inputCls, className)} />;
}

/**
 * Varsayılan type="button": <form> içindeki düz düğmeler yanlışlıkla göndermesin.
 * `loading`: düğme kilitlenir, spinner çıkar (genişlik değişmez).
 */
export function Button({
  variant = "amber",
  className = "",
  loading = false,
  type = "button",
  disabled,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "amber" | "ghost" | "danger";
  loading?: boolean;
}) {
  const map = {
    amber: "btn-amber",
    ghost: "border border-border text-foreground hover:bg-surface-2",
    danger: "bg-danger/15 text-danger hover:bg-danger/25",
  };
  return (
    <button
      {...props}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition-all disabled:cursor-not-allowed disabled:opacity-50 ${map[variant]} ${className}`}
    >
      {loading && <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

/** Zorunlu olmayan alanları kapalı bir bölümde toplar (native <details>: klavye + ekran okuyucu hazır). */
export function MoreFields({
  label = "Ek alanlar",
  defaultOpen = false,
  children,
}: {
  label?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  return (
    <details open={defaultOpen} className="group rounded-xl border border-border/70 sm:col-span-2">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-xl px-3.5 py-2.5 text-xs font-medium text-muted transition-colors hover:text-foreground [&::-webkit-details-marker]:hidden">
        <ChevronRight className="h-3.5 w-3.5 transition-transform group-open:rotate-90" aria-hidden />
        {label}
      </summary>
      <div className="grid grid-cols-1 gap-3 p-3.5 pt-1 sm:grid-cols-2">{children}</div>
    </details>
  );
}

/* ------------------------------------------------------------------ */
/* useFormState — modal içi yerel form durumu                          */
/* ------------------------------------------------------------------ */

type KeysOf<T, V> = { [K in keyof T]-?: NonNullable<T[K]> extends V ? K : never }[keyof T];
type ChangeEv = React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>;

/**
 * Form durumu modal bileşeninin içinde yaşar (sayfa listesi yazarken render olmaz).
 * `text/num/bool` ilgili alana `value` + `onChange` bağlar: `<Input {...f.text("name")} />`.
 */
export function useFormState<T extends object>(initial: T) {
  const [form, setForm] = useState<T>(initial);

  const set = useCallback(<K extends keyof T>(key: K, value: T[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  }, []);

  const text = <K extends KeysOf<T, string>>(key: K) => ({
    value: ((form[key] as unknown as string | undefined) ?? "") as string,
    onChange: (e: ChangeEv) => set(key, e.target.value as T[K]),
  });

  /** Boş giriş → `fallback` (varsayılan undefined; zorunlu sayı alanlarında 0 ver). */
  const num = <K extends KeysOf<T, number>>(key: K, fallback?: number) => ({
    value: ((form[key] as unknown as number | undefined) || "") as string | number,
    onChange: (e: ChangeEv) =>
      set(key, (e.target.value === "" ? fallback : Number(e.target.value)) as T[K]),
  });

  /** Evet/Hayır <select> için ("1" | "0"). */
  const bool = <K extends KeysOf<T, boolean>>(key: K) => ({
    value: form[key] ? "1" : "0",
    onChange: (e: ChangeEv) => set(key, (e.target.value === "1") as T[K]),
  });

  return { form, setForm, set, text, num, bool };
}
