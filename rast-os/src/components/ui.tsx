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
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground md:text-[1.75rem]">
          {title}
        </h1>
        {subtitle && <p className="mt-1.5 max-w-2xl text-sm leading-6 text-muted">{subtitle}</p>}
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
  return href ? <Link href={href} className={className}>{content}</Link> : <div className={className}>{content}</div>;
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
      <div className="flex items-center justify-between border-b border-border/80 bg-white/[0.015] px-5 py-4">
        <h2 className="text-sm font-semibold tracking-tight text-foreground">{title}</h2>
        {action}
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

export function EmptyState({
  title,
  hint,
  cta,
}: {
  title: string;
  hint?: string;
  cta?: { label: string; href: string };
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border/80 bg-background/20 px-4 py-12 text-center">
      <p className="text-sm font-medium text-foreground">{title}</p>
      {hint && <p className="mt-1 max-w-sm text-xs text-muted">{hint}</p>}
      {cta && (
        <Link
          href={cta.href}
          className="btn-amber mt-4 rounded-lg px-4 py-2 text-sm font-medium"
        >
          {cta.label}
        </Link>
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
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${map[tone]}`}
    >
      {children}
    </span>
  );
}
