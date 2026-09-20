import Link from "next/link";
import type { LucideIcon } from "lucide-react";

export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-x-4 gap-y-3 md:mb-5">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight text-foreground md:text-2xl">
          {title}
        </h1>
        {subtitle && <p className="mt-1 max-w-2xl text-sm leading-5 text-muted">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = "default",
  href,
}: {
  label: string;
  value: string;
  hint?: string;
  icon?: LucideIcon;
  tone?: "default" | "amber" | "success" | "warning" | "danger";
  href?: string;
}) {
  const toneMap: Record<string, string> = {
    default: "text-foreground",
    amber: "text-amber",
    success: "text-success",
    warning: "text-warning",
    danger: "text-danger",
  };
  const content = (
    <>
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-amber/50 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
      <div className="flex items-start justify-between">
        <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
        {Icon && <span className="rounded-lg bg-surface-2/80 p-2 text-muted"><Icon className="h-4 w-4" /></span>}
      </div>
      <p className={`mt-4 text-[1.65rem] font-semibold tracking-tight ${toneMap[tone]}`}>{value}</p>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </>
  );

  const className = "card card-hover group relative block overflow-hidden p-4 outline-none focus-visible:ring-2 focus-visible:ring-amber/70";
  return href ? <Link href={href} prefetch={false} className={className}>{content}</Link> : <div className={className}>{content}</div>;
}

export function Panel({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="card overflow-hidden">
      <div className="flex items-center justify-between border-b border-border/80 bg-white/[0.015] px-4 py-3">
        <h2 className="text-sm font-semibold tracking-tight text-foreground">{title}</h2>
        {action}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

export function EmptyState({
  title,
  hint,
  cta,
  action,
}: {
  title: string;
  hint?: string;
  /** Sayfaya götüren birincil eylem */
  cta?: { label: string; href: string };
  /** Aynı sayfada işlem başlatan birincil eylem (ör. "Yeni proje" modalı) */
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border/80 bg-background/20 px-4 py-10 text-center">
      <p className="text-sm font-medium text-foreground">{title}</p>
      {hint && <p className="mt-1 max-w-sm text-xs text-muted">{hint}</p>}
      {cta && (
        <Link
          href={cta.href}
          prefetch={false}
          className="btn-amber mt-4 inline-flex min-h-10 items-center rounded-xl px-4 py-2 text-sm font-medium"
        >
          {cta.label}
        </Link>
      )}
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="btn-amber mt-4 inline-flex min-h-10 items-center rounded-xl px-4 py-2 text-sm font-medium"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}

export function Badge({
  children,
  tone = "default",
}: {
  children: React.ReactNode;
  tone?: "default" | "amber" | "success" | "warning" | "danger" | "muted";
}) {
  const map: Record<string, string> = {
    default: "bg-surface-2 text-foreground",
    amber: "bg-amber/15 text-amber",
    success: "bg-success/15 text-success",
    warning: "bg-warning/15 text-warning",
    danger: "bg-danger/15 text-danger",
    muted: "bg-surface-2 text-muted",
  };
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${map[tone]}`}
    >
      {children}
    </span>
  );
}

/**
 * Liste sayfalarının üstündeki özet: bağımsız kartlar yerine tek satırlık kompakt şerit
 * (StatCard'ın ~130 px'lik yüksekliği yerine ~64 px). Dashboard büyük kartları kullanmaya devam eder.
 */
export function StatStrip({
  items,
}: {
  items: { label: string; value: string; tone?: "default" | "amber" | "success" | "warning" | "danger"; hint?: string }[];
}) {
  const toneMap = {
    default: "text-foreground",
    amber: "text-amber",
    success: "text-success",
    warning: "text-warning",
    danger: "text-danger",
  };
  return (
    <dl className="card mb-4 grid grid-cols-2 gap-px overflow-hidden bg-border/70 lg:grid-cols-4">
      {items.map((item) => (
        <div key={item.label} className="min-w-0 bg-surface/95 px-4 py-3">
          <dt className="truncate text-[11px] font-medium uppercase tracking-wide text-muted">{item.label}</dt>
          <dd className={`mt-0.5 truncate text-lg font-semibold tracking-tight ${toneMap[item.tone ?? "default"]}`}>{item.value}</dd>
          {item.hint && <p className="truncate text-[11px] text-muted">{item.hint}</p>}
        </div>
      ))}
    </dl>
  );
}
