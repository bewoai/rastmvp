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
    <div className="mb-5 flex flex-wrap items-end justify-between gap-x-4 gap-y-3 md:mb-6">
      <div className="min-w-0">
        <h1 className="text-[22px] font-semibold leading-tight tracking-tight text-foreground">
          {title}
        </h1>
        {subtitle && <p className="mt-1 max-w-2xl text-[13px] leading-5 text-muted">{subtitle}</p>}
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
  tone?: "default" | "accent" | "success" | "warning" | "danger";
  href?: string;
}) {
  const toneMap: Record<string, string> = {
    default: "text-foreground",
    // Sakin palet: özet sayılar nötr kalır; turuncu yalnızca eylem/aktif durum içindir
    accent: "text-foreground",
    success: "text-success",
    warning: "text-warning",
    danger: "text-danger",
  };
  const content = (
    <>
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-[13px] text-muted">{label}</p>
        {Icon && <Icon className="h-4 w-4 shrink-0 text-faint" aria-hidden />}
      </div>
      <p className={`mt-2 truncate text-2xl font-semibold tabular-nums tracking-tight ${toneMap[tone]}`}>{value}</p>
      {hint && <p className="mt-0.5 truncate text-xs text-muted">{hint}</p>}
    </>
  );

  const className = `card relative block min-w-0 p-4 outline-none focus-visible:ring-2 focus-visible:ring-accent/70 ${href ? "card-hover" : ""}`;
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
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <h2 className="min-w-0 text-[15px] font-semibold tracking-tight text-foreground">{title}</h2>
        {action && <div className="shrink-0 whitespace-nowrap">{action}</div>}
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
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border px-4 py-10 text-center">
      <p className="text-sm font-medium text-foreground">{title}</p>
      {hint && <p className="mt-1 max-w-sm break-words text-xs text-muted">{hint}</p>}
      {cta && (
        <Link
          href={cta.href}
          prefetch={false}
          className="btn-accent mt-4 inline-flex min-h-10 items-center rounded-lg px-4 py-2 text-sm font-medium"
        >
          {cta.label}
        </Link>
      )}
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="btn-accent mt-4 inline-flex min-h-10 items-center rounded-lg px-4 py-2 text-sm font-medium"
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
  tone?: "default" | "accent" | "success" | "warning" | "danger" | "muted";
}) {
  const map: Record<string, string> = {
    default: "bg-surface-2 text-foreground",
    accent: "bg-accent/12 text-accent",
    success: "bg-success/12 text-success",
    warning: "bg-warning/12 text-warning",
    danger: "bg-danger/12 text-danger",
    muted: "bg-surface-2 text-muted",
  };
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-medium ${map[tone]}`}
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
  items: { label: string; value: string; tone?: "default" | "accent" | "success" | "warning" | "danger"; hint?: string }[];
}) {
  const toneMap = {
    default: "text-foreground",
    // Sakin palet: özet sayılar nötr kalır; turuncu yalnızca eylem/aktif durum içindir
    accent: "text-foreground",
    success: "text-success",
    warning: "text-warning",
    danger: "text-danger",
  };
  return (
    <dl className="card mb-4 grid grid-cols-2 gap-px overflow-hidden bg-border lg:grid-cols-4">
      {items.map((item) => (
        <div key={item.label} className="min-w-0 bg-surface px-4 py-3">
          <dt className="truncate text-xs text-muted">{item.label}</dt>
          <dd className={`mt-0.5 truncate text-lg font-semibold tabular-nums tracking-tight ${toneMap[item.tone ?? "default"]}`}>{item.value}</dd>
          {item.hint && <p className="truncate text-xs text-faint">{item.hint}</p>}
        </div>
      ))}
    </dl>
  );
}
