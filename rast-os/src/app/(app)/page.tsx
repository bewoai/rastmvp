"use client";

import Link from "next/link";
import { useMemo } from "react";
import {
  Wallet, TrendingUp, AlertTriangle, CheckCircle2, Users,
  Boxes, ArrowRight, Plus, CalendarPlus, Receipt,
} from "lucide-react";
import { PageHeader, StatCard, Panel, Badge, EmptyState } from "@/components/ui";
import { useStore, useHydrated } from "@/lib/store";
import { useFx, toTRY } from "@/lib/fx";
import { TRY, dateTR, priority as prioMap, shootStatus } from "@/lib/labels";

export default function DashboardPage() {
  const hydrated = useHydrated(["jobs", "invoices", "expenses", "clients", "equipment", "shoots", "tasks", "contents"]);
  
  const jobs = useStore((s) => s.jobs) ?? [];
  const invoices = useStore((s) => s.invoices);
  const expenses = useStore((s) => s.expenses);
  const clients = useStore((s) => s.clients);
  const equipment = useStore((s) => s.equipment);
  const shoots = useStore((s) => s.shoots);
  const tasks = useStore((s) => s.tasks);
  const contents = useStore((s) => s.contents);

  const { usd, eur } = useFx();

  const stats = useMemo(() => {
    if (!hydrated) return null;

    const activeJobs = jobs.filter((job) => job.status !== "cancelled");
    const now = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const inCurrentMonth = (date: string | undefined) => Boolean(date?.startsWith(month));
    
    const jobIncome = activeJobs.filter((job) => inCurrentMonth(job.date)).reduce((total, job) => total + job.paid_amount, 0);
    const jobOutstanding = activeJobs.reduce((total, job) => total + (job.price - job.paid_amount), 0);
  
    const income = invoices.filter((invoice) => inCurrentMonth(invoice.issue_date)).reduce((total, invoice) => total + invoice.paid_amount, 0) + jobIncome;
    const expense = expenses
      .filter((item) => item.payment_status !== "pending" && (item.is_recurring || inCurrentMonth(item.paid_at)))
      .reduce((total, item) => total + toTRY(item.amount + item.vat, item.currency, usd, eur), 0);
    const net = income - expense;
    
    const expected = invoices
      .filter((invoice) => invoice.status !== "paid" && invoice.status !== "cancelled")
      .reduce((total, invoice) => total + (invoice.amount + invoice.vat - invoice.paid_amount), 0) + jobOutstanding;
      
    const overdue = invoices
      .filter((invoice) => invoice.status === "overdue")
      .reduce((total, invoice) => total + (invoice.amount + invoice.vat - invoice.paid_amount), 0);
      
    const activeClients = clients.filter((client) => client.is_active).length;
    const idleEquipment = equipment.filter((item) => item.status === "idle").length;
    
    const upcomingShoots = [...shoots]
      .filter((shoot) => shoot.scheduled_at)
      .sort((a, b) => (a.scheduled_at! < b.scheduled_at! ? -1 : 1))
      .slice(0, 4);
      
    const openTasks = tasks.filter((task) => task.status !== "done").slice(0, 5);
    
    const awaiting = contents.filter(
      (content) => content.status === "sent_to_client" || content.status === "internal_review",
    );
    
    const maxCashFlow = Math.max(income, expense, 1);
    const incomeWidth = `${Math.max((income / maxCashFlow) * 100, 4)}%`;
    const expenseWidth = `${Math.max((expense / maxCashFlow) * 100, 4)}%`;

    return {
      income, expense, net, expected, overdue, activeClients, idleEquipment,
      upcomingShoots, openTasks, awaiting, incomeWidth, expenseWidth, month
    };
  }, [hydrated, jobs, invoices, expenses, clients, equipment, shoots, tasks, contents, usd, eur]);

  if (!hydrated || !stats) {
    const now = new Date();
    const monthLabel = new Intl.DateTimeFormat("tr-TR", { month: "long", year: "numeric" }).format(now);
    return <PageHeader title="Dashboard" subtitle={monthLabel} />;
  }

  const panelLink = (href: string) => (
    <Link href={href} className="flex items-center gap-1 text-xs text-muted transition-colors hover:text-amber">
      Tümü <ArrowRight className="h-3.5 w-3.5" />
    </Link>
  );
  
  const now = new Date();
  const monthLabel = new Intl.DateTimeFormat("tr-TR", { month: "long", year: "numeric" }).format(now);

  return (
    <div>
      <PageHeader title="Dashboard" subtitle={monthLabel} />

      <div className="mb-5 grid gap-4 lg:grid-cols-[1.45fr_.55fr]">
        <Link href="/finance/invoices" className="balance-panel card card-hover group relative overflow-hidden p-5 outline-none focus-visible:ring-2 focus-visible:ring-amber/70 md:p-6">
          <div className="relative z-10 flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted">Aylık net</p>
              <p className={`mt-2 text-3xl font-semibold tracking-[-0.035em] md:text-4xl ${stats.net >= 0 ? "text-amber" : "text-danger"}`}>{TRY(stats.net)}</p>
            </div>
            <span className="rounded-full border border-border/80 bg-background/30 p-2.5 text-muted transition-colors group-hover:text-amber"><ArrowRight className="h-4 w-4" /></span>
          </div>
          <div className="relative z-10 mt-7 grid gap-3 sm:grid-cols-2">
            <div>
              <div className="mb-2 flex items-center justify-between text-xs"><span className="text-muted">Tahsilat</span><span className="text-foreground">{TRY(stats.income)}</span></div>
              <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]"><div className="h-full rounded-full bg-success" style={{ width: stats.incomeWidth }} /></div>
            </div>
            <div>
              <div className="mb-2 flex items-center justify-between text-xs"><span className="text-muted">Gider</span><span className="text-foreground">{TRY(stats.expense)}</span></div>
              <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]"><div className="h-full rounded-full bg-warning" style={{ width: stats.expenseWidth }} /></div>
            </div>
          </div>
        </Link>

        <div className="card grid grid-cols-2 gap-px overflow-hidden bg-border/70">
          {[
            { href: "/crm/clients", label: "Müşteri ekle", icon: Users },
            { href: "/projects", label: "Proje aç", icon: Plus },
            { href: "/content", label: "İçerik ekle", icon: CalendarPlus },
            { href: "/finance/invoices", label: "Tahsilatlar", icon: Receipt },
          ].map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href} className="group flex min-h-24 flex-col justify-between bg-surface/95 p-4 outline-none transition-colors hover:bg-surface-2 focus-visible:bg-surface-2">
              <Icon className="h-4 w-4 text-muted transition-colors group-hover:text-amber" />
              <span className="flex items-end justify-between gap-2 text-sm font-medium text-foreground">{label}<ArrowRight className="h-3.5 w-3.5 text-muted transition-transform group-hover:translate-x-0.5" /></span>
            </Link>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard href="/finance/invoices" label="Tahsil edilen" value={TRY(stats.income)} icon={TrendingUp} tone="success" />
        <StatCard href="/finance/expenses" label="Bu ay gider" value={TRY(stats.expense)} icon={Wallet} tone="warning" />
        <StatCard href="/finance/invoices" label="Net" value={TRY(stats.net)} icon={TrendingUp} tone="amber" />
        <StatCard href="/finance/invoices" label="Beklenen tahsilat" value={TRY(stats.expected)} icon={Wallet} />
        <StatCard href="/finance/invoices" label="Geciken ödeme" value={TRY(stats.overdue)} icon={AlertTriangle} tone="danger" />
        <StatCard href="/crm/clients" label="Aktif müşteri" value={String(stats.activeClients)} icon={Users} />
        <StatCard href="/equipment" label="Boştaki ekipman" value={String(stats.idleEquipment)} icon={Boxes} />
        <StatCard href="/content" label="Onay bekleyen" value={String(stats.awaiting.length)} icon={CheckCircle2} tone="amber" />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <Panel title="Yaklaşan çekimler" action={panelLink("/shoots")}>
          {stats.upcomingShoots.length ? (
            <ul className="space-y-1">
              {stats.upcomingShoots.map((shoot) => (
                <li key={shoot.id}>
                  <Link href="/shoots" className="interactive-row flex items-center justify-between gap-3">
                    <div className="min-w-0"><p className="truncate text-sm text-foreground">{shoot.title}</p><p className="text-xs text-muted">{shoot.location || "—"}</p></div>
                    <div className="text-right"><Badge tone={shootStatus[shoot.status as keyof typeof shootStatus].tone}>{shootStatus[shoot.status as keyof typeof shootStatus].label}</Badge><p className="mt-1 text-xs text-muted">{dateTR(shoot.scheduled_at)}</p></div>
                  </Link>
                </li>
              ))}
            </ul>
          ) : <EmptyState title="Yaklaşan çekim yok" />}
        </Panel>

        <Panel title="Açık görevler" action={panelLink("/tasks")}>
          {stats.openTasks.length ? (
            <ul className="space-y-1">
              {stats.openTasks.map((task) => (
                <li key={task.id}>
                  <Link href="/tasks" className="interactive-row flex items-center justify-between gap-3">
                    <div className="min-w-0"><p className="truncate text-sm text-foreground">{task.title}</p><p className="text-xs text-muted">{task.assignee || "—"} · {dateTR(task.due_date)}</p></div>
                    <Badge tone={prioMap[task.priority as keyof typeof prioMap].tone}>{prioMap[task.priority as keyof typeof prioMap].label}</Badge>
                  </Link>
                </li>
              ))}
            </ul>
          ) : <EmptyState title="Açık görev yok" />}
        </Panel>

        <Panel title="Onay bekleyen içerikler" action={panelLink("/content")}>
          {stats.awaiting.length ? (
            <ul className="space-y-1">
              {stats.awaiting.slice(0, 5).map((content) => (
                <li key={content.id}>
                  <Link href="/content" className="interactive-row flex items-center justify-between gap-3">
                    <div className="min-w-0"><p className="truncate text-sm text-foreground">{content.title}</p><p className="text-xs text-muted">{content.platform} · {content.content_type}</p></div>
                    <Badge tone="warning">Bekliyor</Badge>
                  </Link>
                </li>
              ))}
            </ul>
          ) : <EmptyState title="Onay bekleyen içerik yok" />}
        </Panel>
      </div>
    </div>
  );
}
