"use client";

import { useEffect } from "react";
import { X } from "lucide-react";

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  size = "md",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: "md" | "lg" | "xl";
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    if (open) document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 backdrop-blur-sm md:items-center">
      <div className="fixed inset-0 bg-black/70" onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-label={title} className={`card relative z-10 w-full overflow-hidden shadow-2xl ${size === "xl" ? "max-w-5xl" : size === "lg" ? "max-w-3xl" : "max-w-lg"}`}>
        <div className="flex items-center justify-between border-b border-border/80 bg-white/[0.02] px-5 py-4">
          <h3 className="text-base font-semibold tracking-tight text-foreground">{title}</h3>
          <button
            onClick={onClose}
            className="rounded-xl p-2 text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
            aria-label="Kapat"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-5 py-5">{children}</div>
        {footer && (
          <div className="flex justify-end gap-2 border-t border-border/80 bg-white/[0.02] px-5 py-4">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

export function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-muted">{label}</span>
      {children}
    </label>
  );
}

const inputCls =
  "w-full rounded-xl border border-border/80 bg-background/70 px-3.5 py-2.5 text-sm text-foreground outline-none transition-shadow placeholder:text-muted focus:border-amber/70 focus:ring-4 focus:ring-amber/10";

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={inputCls} />;
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={inputCls} rows={props.rows ?? 3} />;
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={inputCls} />;
}

export function Button({
  variant = "amber",
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "amber" | "ghost" | "danger";
}) {
  const map = {
    amber: "btn-amber",
    ghost: "border border-border text-foreground hover:bg-surface-2",
    danger: "bg-danger/15 text-danger hover:bg-danger/25",
  };
  return (
    <button
      {...props}
      className={`rounded-xl px-4 py-2.5 text-sm font-medium transition-all disabled:cursor-not-allowed disabled:opacity-50 ${map[variant]} ${className}`}
    />
  );
}
