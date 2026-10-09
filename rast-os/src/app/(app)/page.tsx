"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle, ArrowRight, Camera, CalendarPlus, ChevronDown, CircleCheck, Circle,
  FolderPlus, ListPlus, Plus, Repeat, Scale, UserPlus, Wallet,
} from "lucide-react";
import { PageHeader, StatCard, StatStrip, Panel, Badge } from "@/components/ui";
import ActivityFeed from "@/components/ActivityFeed";
import MrrCard from "@/components/MrrCard";
import { BackupReminder } from "@/components/BackupPanel";
import { useStore, useHydrated } from "@/lib/store";
import { useFx } from "@/lib/fx";
import { computeMrr, mrrProgress } from "@/lib/mrr";
import { useOrgTargets } from "@/lib/orgSettings";
import { expandRecurring, expenseTotalTRY, invoiceIncomeInRange, monthBounds } from "@/lib/finance";
import { useToday } from "@/lib/useToday";
import { useQuickAdd } from "@/lib/quickAdd";
import { addDaysKey, bucketTasks, dateKey, formatDue, sortTasks } from "@/lib/taskLogic";
import { TRY, priority as prioMap, shootStatus } from "@/lib/labels";
import { FilterChips, usePersistentState } from "@/components/list";
import { assigneeView, filterByOwner } from "@/lib/assignee-logic";
import { recordHref } from "@/lib/search-logic";

type TaskScope = "mine" | "all";
const TASK_SCOPES: readonly TaskScope[] = ["mine", "all"];

/** Başlık üstündeki tarih: "9 Ekim, Perşembe". */
function dayLabel(today: string) {
  const d = new Date(`${today}T12:00:00`);
  const day = new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "long" }).format(d);
  const weekday = new Intl.DateTimeFormat("tr-TR", { weekday: "long" }).format(d);
  return `${day}, ${weekday}`;
}

/** Veri gelene kadar sayfa iskeleti: başlık + bloklar sabit yükseklikte (layout kayması yok). */
function DashboardSkeleton({ subtitle }: { subtitle: string }) {
  return (
    <div role="status" aria-busy="true" aria-live="polite">
      <PageHeader title="Bugün" subtitle={subtitle} />
      <span className="sr-only">Yükleniyor…</span>
      <div aria-hidden className="animate-pulse space-y-5">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => <div key={i} className="card h-[5.75rem]" />)}
        </div>
        <div className="card h-80" />
        <div className="card h-48" />
      </div>
    </div>
  );
}

/** Hızlı ekle eylemleri tek "Yeni" menüsünde: görev (Q) sayfa değiştirmeden, diğerleri ilgili sayfada modalı açar (?new=1). */
function NewMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const openComposer = useQuickAdd((s) => s.openComposer);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    ref.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const itemCls = "flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm text-foreground outline-none hover:bg-surface-2 focus-visible:bg-surface-2";
  const links = [
    { href: "/projects?new=1", label: "Yeni proje", icon: FolderPlus },
    { href: "/content?new=1", label: "Yeni içerik", icon: CalendarPlus },
    { href: "/crm/clients?new=1", label: "Yeni müşteri", icon: UserPlus },
  ];

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="btn-accent inline-flex min-h-10 items-center gap-1.5 rounded-lg px-3.5 text-sm font-medium md:min-h-9"
      >
        <Plus className="h-4 w-4" aria-hidden /> Yeni <ChevronDown className="h-3.5 w-3.5 opacity-70" aria-hidden />
      </button>
      {open && (
        <div role="menu" aria-label="Yeni kayıt" className="popover absolute right-0 top-11 z-40 w-56 p-1.5">
          <button type="button" role="menuitem" onClick={() => { setOpen(false); openComposer(); }} className={itemCls}>
            <ListPlus className="h-4 w-4 text-faint" aria-hidden /> Yeni görev
            <kbd className="ml-auto rounded border border-border px-1.5 font-sans text-[11px] text-faint">Q</kbd>
          </button>
          {links.map(({ href, label, icon: Icon }) => (
            <Link key={href} prefetch={false} href={href} role="menuitem" onClick={() => setOpen(false)} className={itemCls}>
              <Icon className="h-4 w-4 text-faint" aria-hidden /> {label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

type AgendaRow = {
  key: string;
  href: string;
  kind: "task" | "shoot" | "content";
  title: string;
  meta?: string;
  /** Sağdaki tarih etiketi */
  when?: string;
  whenTone?: "danger" | "accent" | "muted";
  badge?: { label: string; tone: "default" | "accent" | "success" | "warning" | "danger" | "muted" };
  sort: string;
};

const KIND_ICON = { task: Circle, shoot: Camera, content: CircleCheck } as const;

function AgendaSection({ title, count, rows, more }: { title: string; count: number; rows: AgendaRow[]; more?: { label: string; href: string } }) {
  if (!rows.length) return null;
  return (
    <section aria-label={title} className="py-1 first:pt-0">
      <h3 className="flex items-center gap-2 px-4 pb-1 pt-3 text-xs font-medium text-faint">
        {title} <span className="tabular-nums">{count}</span>
      </h3>
      <ul>
        {rows.map((row) => {
          const Icon = KIND_ICON[row.kind];
          return (
            <li key={row.key}>
              <Link prefetch={false} href={row.href} className="interactive-row mx-1.5 flex min-h-11 items-center gap-3 px-2.5 py-2 outline-none focus-visible:bg-surface-2">
                <Icon className="h-4 w-4 shrink-0 text-faint" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-foreground">{row.title}</span>
                  {row.meta && <span className="block truncate text-xs text-muted">{row.meta}</span>}
                </span>
                {row.badge && <span className="hidden sm:inline-flex"><Badge tone={row.badge.tone}>{row.badge.label}</Badge></span>}
                {row.when && (
                  <span className={`w-16 shrink-0 text-right text-xs tabular-nums ${row.whenTone === "danger" ? "text-danger" : row.whenTone === "accent" ? "text-accent" : "text-muted"}`}>
                    {row.when}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
      {more && (
        <Link prefetch={false} href={more.href} className="ml-[3.25rem] mt-0.5 inline-flex items-center gap-1 rounded py-1 text-xs text-muted outline-none hover:text-foreground">
          {more.label} <ArrowRight className="h-3 w-3" aria-hidden />
        </Link>
      )}
    </section>
  );
}

const OVERDUE_LIMIT = 5;
const UPCOMING_LIMIT = 6;

export default function DashboardPage() {
  const hydrated = useHydrated(["jobs", "invoices", "payments", "expenses", "clients", "equipment", "shoots", "tasks", "contents", "activity_logs", "proposals", "proposal_items"]);

  const jobs = useStore((s) => s.jobs);
  const invoices = useStore((s) => s.invoices);
  const payments = useStore((s) => s.payments);
  const expenses = useStore((s) => s.expenses);
  const clients = useStore((s) => s.clients);
  const equipment = useStore((s) => s.equipment);
  const shoots = useStore((s) => s.shoots);
  const tasks = useStore((s) => s.tasks);
  const contents = useStore((s) => s.contents);
  const activityLogs = useStore((s) => s.activity_logs);
  const proposals = useStore((s) => s.proposals);
  const proposalItems = useStore((s) => s.proposal_items);
  // Ekip (görev atama): açılış isteğinin çekirdek kümesinde — dashboard onu beklemez; yoksa yalnız assignee_id'ye bakılır.
  const team = useStore((s) => s.profiles);
  const userId = useStore((s) => s.userId);

  const { usd, eur } = useFx();
  const today = useToday();
  const orgTargets = useOrgTargets(hydrated);
  // Yapılacaklar: varsayılan bana atanan + atanmamış görevler; anahtarla herkesinki (tarayıcıda hatırlanır).
  const [taskScope, setTaskScope] = usePersistentState<TaskScope>("today-task-scope", "mine", TASK_SCOPES);
  const scopeOn = Boolean(userId) && team.length > 1;
  const ownerMode = scopeOn && taskScope === "mine" ? "mine_or_unassigned" : "all";

  const stats = useMemo(() => {
    if (!hydrated) return null;

    const activeJobs = jobs.filter((job) => job.status !== "cancelled");
    const now = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const inCurrentMonth = (date: string | undefined) => Boolean(date?.startsWith(month));

    const [monthStart, monthEnd] = monthBounds(month);

    // Tekil işler: jobs tablosunda ayrı bir tahsilat/ödeme tarihi kolonu yok (yalnızca iş/teslim
    // tarihi `date`). Bu yüzden iş geliri hâlâ iş tarihine göre sayılır; tahsilat tarihi
    // gerekirse jobs için de payments benzeri bir kayıt eklenmeli.
    const jobIncome = activeJobs.filter((job) => inCurrentMonth(job.date)).reduce((total, job) => total + job.paid_amount, 0);
    const jobOutstanding = activeJobs.reduce((total, job) => total + (job.price - job.paid_amount), 0);

    // Fatura geliri: fatura tarihine göre değil, tahsilatın yapıldığı güne (payments.paid_at) göre.
    const income = invoiceIncomeInRange(invoices, payments, monthStart, monthEnd) + jobIncome;
    // Tekrarlayan giderler şablondur: yalnızca bu aya düşen oluşumları sayılır (başlangıç/taksit sonu dikkate alınır).
    const expense = expandRecurring(expenses, monthStart, monthEnd)
      .filter((item) => item.payment_status !== "pending")
      .reduce((total, item) => total + expenseTotalTRY(item, usd, eur), 0);
    const net = income - expense;

    const expected = invoices
      .filter((invoice) => invoice.status !== "paid" && invoice.status !== "cancelled")
      .reduce((total, invoice) => total + (invoice.amount + invoice.vat - invoice.paid_amount), 0) + jobOutstanding;

    const overdue = invoices
      .filter((invoice) => invoice.status === "overdue")
      .reduce((total, invoice) => total + (invoice.amount + invoice.vat - invoice.paid_amount), 0);

    const activeClients = clients.filter((client) => client.is_active).length;
    const idleEquipment = equipment.filter((item) => item.status === "idle").length;

    // Yaklaşan = bugün veya sonrası ve bitmemiş/iptal edilmemiş
    const upcomingShoots = shoots
      .filter((shoot) => {
        if (!shoot.scheduled_at || shoot.status === "completed" || shoot.status === "cancelled") return false;
        return dateKey(new Date(shoot.scheduled_at)) >= today;
      })
      .sort((a, b) => new Date(a.scheduled_at!).getTime() - new Date(b.scheduled_at!).getTime())
      .slice(0, 4);

    // Açık görevler: tarih → öncelik sıralı; gecikenler / bugün / önümüzdeki 7 gün
    const open = sortTasks("all", bucketTasks(filterByOwner(tasks, ownerMode, userId, team), today).all);
    const weekEnd = addDaysKey(today, 7);
    const due = (t: (typeof open)[number]) => t.due_date?.slice(0, 10);
    const overdueTasks = open.filter((t) => { const d = due(t); return d !== undefined && d < today; });
    const todayTasks = open.filter((t) => due(t) === today);
    const weekTasks = open.filter((t) => { const d = due(t); return d !== undefined && d > today && d <= weekEnd; });

    const awaiting = contents.filter(
      (content) => content.status === "sent_to_client" || content.status === "internal_review",
    );

    // MRR (KDV hariç): kabul edilmiş tekliflerin aylık kalemleri + teklifsiz düzenli faturalar (src/lib/mrr.ts)
    const mrr = computeMrr({
      proposals, proposalItems, invoices, clients, monthStart, today, rates: { usd, eur },
    });

    return {
      mrr, income, expense, net, expected, overdue, activeClients, idleEquipment,
      upcomingShoots, overdueTasks, todayTasks, weekTasks, awaiting, month,
    };
  }, [hydrated, jobs, invoices, payments, expenses, clients, equipment, shoots, tasks, contents, proposals, proposalItems, usd, eur, today, ownerMode, userId, team]);

  if (!hydrated || !stats) {
    return <DashboardSkeleton subtitle={dayLabel(today)} />;
  }

  const monthName = new Intl.DateTimeFormat("tr-TR", { month: "long" }).format(new Date(`${stats.month}-15T12:00:00`));

  const taskRow = (task: (typeof stats.overdueTasks)[number], tone: AgendaRow["whenTone"]): AgendaRow => {
    const d = task.due_date?.slice(0, 10);
    const p = prioMap[task.priority as keyof typeof prioMap];
    // Başkasına atanmış görevde sorumlunun adı (kendi görevlerinde gürültü olmasın)
    const who = assigneeView(task, team);
    return {
      key: `t-${task.id}`,
      href: recordHref("tasks", task.id),
      kind: "task",
      title: task.title,
      meta: who && who.id !== userId ? who.name : undefined,
      when: d ? formatDue(d, today) : undefined,
      whenTone: tone,
      // Yalnızca öne çıkması gereken öncelikler rozetle gösterilir (Orta/Düşük gürültü yapmasın)
      badge: task.priority === "high" || task.priority === "urgent" ? p : undefined,
      sort: d ?? "",
    };
  };

  const shootRow = (shoot: (typeof stats.upcomingShoots)[number]): AgendaRow => {
    const d = dateKey(new Date(shoot.scheduled_at!));
    const st = shootStatus[shoot.status as keyof typeof shootStatus];
    return {
      key: `s-${shoot.id}`,
      href: recordHref("shoots", shoot.id),
      kind: "shoot",
      title: shoot.title,
      meta: ["Çekim", shoot.location].filter(Boolean).join(" · "),
      when: formatDue(d, today),
      whenTone: d === today ? "accent" : "muted",
      badge: st,
      sort: d,
    };
  };

  const shootsToday = stats.upcomingShoots.filter((s) => dateKey(new Date(s.scheduled_at!)) === today);
  const shootsLater = stats.upcomingShoots.filter((s) => dateKey(new Date(s.scheduled_at!)) !== today);

  const overdueRows = stats.overdueTasks.slice(0, OVERDUE_LIMIT).map((t) => taskRow(t, "danger"));
  const todayRows = [...shootsToday.map(shootRow), ...stats.todayTasks.map((t) => taskRow(t, "accent"))];
  const upcomingAll = [...shootsLater.map(shootRow), ...stats.weekTasks.map((t) => taskRow(t, "muted"))]
    .sort((a, b) => a.sort.localeCompare(b.sort));
  const upcomingRows = upcomingAll.slice(0, UPCOMING_LIMIT);
  const awaitingRows: AgendaRow[] = stats.awaiting.slice(0, 5).map((content) => ({
    key: `c-${content.id}`,
    href: recordHref("contents", content.id),
    kind: "content",
    title: content.title,
    meta: [content.platform, content.content_type].filter(Boolean).join(" · "),
    badge: { label: content.status === "internal_review" ? "İç kontrol" : "Müşteride", tone: "warning" },
    sort: "",
  }));
  const agendaEmpty = !overdueRows.length && !todayRows.length && !upcomingRows.length && !awaitingRows.length;

  const summary = [
    stats.overdueTasks.length ? `${stats.overdueTasks.length} geciken görev` : null,
    todayRows.length ? `bugün ${todayRows.length} iş` : null,
    stats.awaiting.length ? `${stats.awaiting.length} onay bekleyen içerik` : null,
  ].filter(Boolean).join(" · ");

  const mrrP = mrrProgress(stats.mrr.mrr, orgTargets.target);
  const mrrHint = !mrrP.hasTarget ? "KDV hariç" : mrrP.reached ? "Eşik aşıldı" : `Eşiğe ${TRY(mrrP.remaining)} kaldı`;

  return (
    <div>
      <p className="mb-1 text-[13px] text-muted">{dayLabel(today)}</p>
      <PageHeader
        title="Bugün"
        subtitle={summary || "Bugün için bekleyen iş yok."}
        action={<NewMenu />}
      />

      <BackupReminder />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard href="/finance/invoices" label="Bekleyen tahsilat" value={TRY(stats.expected)} icon={Wallet} />
        <StatCard href="/finance/invoices" label="Geciken ödeme" value={TRY(stats.overdue)} icon={AlertTriangle} tone={stats.overdue > 0 ? "danger" : "default"} />
        <StatCard href="/teklifler" label="MRR" value={TRY(stats.mrr.mrr)} hint={mrrHint} icon={Repeat} />
        <StatCard
          href="/finance/expenses"
          label={`Aylık net · ${monthName}`}
          value={TRY(stats.net)}
          hint={`Tahsilat ${TRY(stats.income)} · Gider ${TRY(stats.expense)}`}
          icon={Scale}
          tone={stats.net < 0 ? "danger" : "default"}
        />
      </div>

      <section aria-labelledby="yapilacaklar" className="card mt-5 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-border px-4 py-2.5">
          <h2 id="yapilacaklar" className="text-[15px] font-semibold tracking-tight text-foreground">Yapılacaklar</h2>
          <div className="ml-auto flex items-center gap-3">
            {scopeOn && (
              <FilterChips
                label="Yapılacaklar: kimin görevleri"
                value={taskScope}
                onChange={setTaskScope}
                options={[
                  { id: "mine", label: "Benim" },
                  { id: "all", label: "Herkes" },
                ]}
              />
            )}
            <Link prefetch={false} href="/tasks" className="flex items-center gap-1 text-[13px] text-muted transition-colors hover:text-foreground">
              Tüm görevler <ArrowRight className="h-3.5 w-3.5" aria-hidden />
            </Link>
          </div>
        </div>
        {scopeOn && taskScope === "mine" && !agendaEmpty && (
          <p className="px-4 pt-2 text-xs text-faint">Sana atanan ve atanmamış görevler; çekim ve onay bekleyen içerikler herkes için.</p>
        )}
        {agendaEmpty ? (
          <p className="px-4 py-10 text-center text-sm text-muted">
            {scopeOn && taskScope === "mine" ? "Sana atanmış ya da atanmamış geciken / yaklaşan iş yok." : "Geciken ya da yaklaşan iş yok."} Yeni görev için <kbd className="rounded border border-border px-1.5 font-sans text-xs">Q</kbd>
          </p>
        ) : (
          <div className="divide-y divide-border pb-2">
            <AgendaSection
              title="Geciken"
              count={stats.overdueTasks.length}
              rows={overdueRows}
              more={stats.overdueTasks.length > OVERDUE_LIMIT ? { label: `${stats.overdueTasks.length - OVERDUE_LIMIT} gecikmiş görev daha`, href: "/tasks" } : undefined}
            />
            <AgendaSection title="Bugün" count={todayRows.length} rows={todayRows} />
            <AgendaSection
              title="Önümüzdeki 7 gün"
              count={upcomingAll.length}
              rows={upcomingRows}
              more={upcomingAll.length > UPCOMING_LIMIT ? { label: "Tüm yaklaşanlar", href: "/tasks" } : undefined}
            />
            <AgendaSection
              title="Onay bekleyen içerikler"
              count={stats.awaiting.length}
              rows={awaitingRows}
              more={stats.awaiting.length > 5 ? { label: "İçerik takvimi", href: "/content" } : undefined}
            />
          </div>
        )}
      </section>

      <h2 className="mb-3 mt-8 text-[15px] font-semibold tracking-tight text-foreground">Genel durum</h2>
      <MrrCard result={stats.mrr} target={orgTargets.target} label={orgTargets.label} loaded={orgTargets.loaded} />
      <div className="mt-3">
        <StatStrip
          items={[
            { label: `Tahsilat · ${monthName}`, value: TRY(stats.income) },
            { label: `Gider · ${monthName}`, value: TRY(stats.expense) },
            { label: "Aktif müşteri", value: String(stats.activeClients) },
            { label: "Boştaki ekipman", value: String(stats.idleEquipment) },
          ]}
        />
      </div>

      <div className="mt-1">
        <Panel
          title="Son işlemler"
          action={
            <Link prefetch={false} href="/settings/islem-gecmisi" className="flex items-center gap-1 text-[13px] text-muted transition-colors hover:text-foreground">
              Tümü <ArrowRight className="h-3.5 w-3.5" aria-hidden />
            </Link>
          }
        >
          <ActivityFeed logs={activityLogs} limit={6} />
        </Panel>
      </div>
    </div>
  );
}
