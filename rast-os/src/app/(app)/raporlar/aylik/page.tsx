"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, FileText, Printer, Save } from "lucide-react";
import { PageHeader, EmptyState, Badge, StatStrip } from "@/components/ui";
import { Field, Select, Textarea, Button } from "@/components/form";
import { PageLoading } from "@/components/list";
import { useStore, useHydrated, uid, nowISO } from "@/lib/store";
import { useToday } from "@/lib/useToday";
import { useToasts } from "@/lib/toast";
import { approvalStatus, contentStatus, dateTR, dateTimeTR, shootStatus } from "@/lib/labels";
import {
  APPROVAL_BUCKETS, buildMonthlyReport, defaultReportMonth, findReport, isValidMonth, monthLabelTR,
  normalizeHighlights, periodOf, pointsToText, shiftMonth,
} from "@/lib/report-logic";
import type { ApprovalBucket, MonthlyReport } from "@/lib/report-logic";
import type { Client, ClientReport } from "@/lib/types";

const bucketLabel = (b: ApprovalBucket) => (b === "none" ? "Onaya gönderilmedi" : approvalStatus[b].label);
const bucketTone = (b: ApprovalBucket) => (b === "none" ? "muted" : approvalStatus[b].tone);

/** Seçim adres çubuğunda tutulur (?musteri=…&ay=YYYY-MM): bağlantı paylaşılabilir, yenilemede kaybolmaz. */
function readQuery(): { client: string; month: string } {
  try {
    const q = new URLSearchParams(window.location.search);
    return { client: q.get("musteri") ?? "", month: q.get("ay") ?? "" };
  } catch {
    return { client: "", month: "" };
  }
}

const reportHref = (clientId: string, month: string) =>
  `/raporlar/aylik?musteri=${encodeURIComponent(clientId)}&ay=${month}`;
const printHref = (clientId: string, month: string) =>
  `/raporlar/aylik/${encodeURIComponent(clientId)}/${month}/yazdir`;

export default function MonthlyReportPage() {
  const hydrated = useHydrated(["clients", "contents", "shoots", "content_approvals", "client_reports"]);
  const clients = useStore((s) => s.clients);
  const reports = useStore((s) => s.client_reports);
  const today = useToday();

  const [query] = useState(readQuery);
  const [clientId, setClientId] = useState(query.client);
  const [month, setMonth] = useState(isValidMonth(query.month) ? query.month : defaultReportMonth(today));

  const sortedClients = useMemo(
    () => [...clients].sort((a, b) => Number(b.is_active) - Number(a.is_active) || a.name.localeCompare(b.name, "tr")),
    [clients],
  );
  // Adresteki müşteri yoksa (silinmiş / ilk açılış) ilk aktif müşteri seçilir.
  const activeClient = sortedClients.find((c) => c.id === clientId) ?? sortedClients[0];

  useEffect(() => {
    if (!activeClient) return;
    const url = reportHref(activeClient.id, month);
    if (window.location.pathname + window.location.search !== url) window.history.replaceState(window.history.state, "", url);
  }, [activeClient, month]);

  const savedReports = useMemo(() => {
    const names = new Map(clients.map((c) => [c.id, c.name]));
    return [...reports]
      .sort((a, b) => String(b.period).localeCompare(String(a.period)) || (names.get(a.client_id) ?? "").localeCompare(names.get(b.client_id) ?? "", "tr"))
      .map((r) => ({ report: r, client: names.get(r.client_id) ?? "Silinmiş müşteri", month: String(r.period).slice(0, 7) }));
  }, [reports, clients]);

  if (!hydrated) return <PageLoading title="Aylık müşteri raporu" />;

  if (!activeClient) {
    return (
      <>
        <PageHeader title="Aylık müşteri raporu" />
        <EmptyState title="Henüz müşteri yok" hint="Rapor hazırlamak için önce bir müşteri ekleyin." cta={{ label: "Müşteriler", href: "/crm/clients" }} />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Aylık müşteri raporu"
        subtitle="Ay sonunda müşteriye gönderilen sade rapor. Sayılar içerik, çekim ve onay kayıtlarından hesaplanır; notları siz yazarsınız."
      />

      <div className="card mb-4 flex flex-col gap-3 p-3 sm:flex-row sm:items-end">
        <div className="min-w-0 sm:w-72">
          <Field label="Müşteri">
            <Select value={activeClient.id} onChange={(e) => setClientId(e.target.value)}>
              {sortedClients.map((c) => (
                <option key={c.id} value={c.id}>{c.name}{c.is_active ? "" : " (pasif)"}</option>
              ))}
            </Select>
          </Field>
        </div>
        <div>
          <span className="mb-1 block text-xs font-medium text-muted">Ay</span>
          <div className="flex h-[2.625rem] items-center overflow-hidden rounded-xl border border-border/80 bg-background/70">
            <button type="button" aria-label="Önceki ay" onClick={() => setMonth((m) => shiftMonth(m, -1))} className="flex h-full w-10 items-center justify-center text-muted hover:bg-surface-2 hover:text-foreground">
              <ChevronLeft className="h-4 w-4" aria-hidden />
            </button>
            <label className="relative flex h-full min-w-[150px] cursor-pointer items-center justify-center gap-2 px-2 text-sm font-medium text-foreground focus-within:ring-2 focus-within:ring-amber/60">
              <CalendarDays className="h-4 w-4 text-amber" aria-hidden />
              {monthLabelTR(month)}
              <input
                type="month"
                value={month}
                onChange={(e) => isValidMonth(e.target.value) && setMonth(e.target.value)}
                className="absolute inset-0 cursor-pointer opacity-0"
                aria-label="Rapor ayı"
              />
            </label>
            <button type="button" aria-label="Sonraki ay" onClick={() => setMonth((m) => shiftMonth(m, 1))} className="flex h-full w-10 items-center justify-center text-muted hover:bg-surface-2 hover:text-foreground">
              <ChevronRight className="h-4 w-4" aria-hidden />
            </button>
          </div>
        </div>
      </div>

      <ReportWorkspace key={`${activeClient.id}:${month}`} client={activeClient} month={month} />

      {savedReports.length > 0 && (
        <section className="card mt-4 p-4" aria-labelledby="saved-reports">
          <h2 id="saved-reports" className="mb-3 text-sm font-semibold text-foreground">Kayıtlı raporlar</h2>
          <ul className="divide-y divide-border/60">
            {savedReports.map(({ report, client, month: m }) => (
              <li key={report.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <button
                  type="button"
                  onClick={() => { setClientId(report.client_id); setMonth(m); document.getElementById("main")?.scrollTo({ top: 0 }); }}
                  className="min-w-0 text-left text-foreground hover:text-amber"
                >
                  <span className="font-medium">{client}</span> · {monthLabelTR(m)}
                </button>
                <span className="flex items-center gap-3 text-xs text-muted">
                  Son kayıt {dateTimeTR(report.generated_at)}
                  <Link prefetch={false} href={printHref(report.client_id, m)} className="text-amber hover:text-amber-hi">Yazdır</Link>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

function ReportWorkspace({ client, month }: { client: Client; month: string }) {
  const router = useRouter();
  const contents = useStore((s) => s.contents);
  const shoots = useStore((s) => s.shoots);
  const approvals = useStore((s) => s.content_approvals);
  const saved = useStore((s) => findReport(s.client_reports, client.id, month));
  const [now] = useState(() => nowISO());

  const report = useMemo(
    () => buildMonthlyReport({ clientId: client.id, month, contents, shoots, approvals, now }),
    [client.id, month, contents, shoots, approvals, now],
  );

  const initial = useMemo(() => ({
    points: pointsToText(saved?.highlights?.points),
    notes: saved?.notes ?? "",
    ads: saved?.highlights?.ads_note ?? "",
  }), [saved]);
  const [draft, setDraft] = useState(initial);
  const [saving, setSaving] = useState(false);
  const dirty = draft.points !== initial.points || draft.notes !== initial.notes || draft.ads !== initial.ads;

  async function save(): Promise<boolean> {
    setSaving(true);
    const stamp = nowISO();
    const fields: Pick<ClientReport, "notes" | "highlights" | "generated_at"> = {
      notes: draft.notes.trim() || null,
      highlights: normalizeHighlights({ points: draft.points, ads_note: draft.ads }),
      generated_at: stamp,
    };
    const s = useStore.getState();
    const res = saved
      ? await s.update("client_reports", saved.id, { ...fields, updated_at: stamp })
      : await s.add("client_reports", { ...fields, id: uid(), client_id: client.id, period: periodOf(month), created_at: stamp, updated_at: stamp });
    setSaving(false);
    if (!res.ok) {
      const hint = /client_reports|does not exist|schema cache/i.test(res.error ?? "") ? " (0015_client_reports.sql uygulanmış mı?)" : "";
      useToasts.getState().push({ message: `Rapor kaydedilemedi: ${res.error ?? ""}${hint}`, tone: "danger" });
      return false;
    }
    setDraft({ points: fields.highlights.points?.join("\n") ?? "", notes: fields.notes ?? "", ads: fields.highlights.ads_note ?? "" });
    useToasts.getState().push({ message: `${client.name} · ${monthLabelTR(month)} raporu kaydedildi` });
    return true;
  }

  async function openPrint() {
    if (dirty && !(await save())) return;
    router.push(printHref(client.id, month));
  }

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="min-w-0 space-y-4">
        <Summary report={report} />
        <ContentsCard title="İçerik listesi" rows={report.contents} empty="Bu ay planlanmış ya da yayınlanmış içerik yok." />
        <ShootsCard report={report} />
        <ApprovalsCard report={report} />
        <ContentsCard title={`Gelecek ay planı · ${monthLabelTR(report.nextMonth)}`} rows={report.nextMonthPlan} empty="Gelecek ay için planlanmış içerik yok." />
      </div>

      <aside className="xl:sticky xl:top-0 xl:self-start" aria-label="Rapor notları">
        <section className="card p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-foreground">Notlar</h2>
            {dirty ? <Badge tone="warning">Kaydedilmedi</Badge> : saved ? <Badge tone="muted">Kayıtlı</Badge> : <Badge tone="muted">Yeni</Badge>}
          </div>
          <div className="space-y-3">
            <Field label="Öne çıkanlar" hint="Her satır raporda bir madde olur.">
              <Textarea rows={4} value={draft.points} onChange={(e) => setDraft((d) => ({ ...d, points: e.target.value }))} placeholder={"Kardiyoloji serisi başladı\nYeni hekim tanıtımı yayında"} />
            </Field>
            <Field label="Notlar" hint="Ayın kısa özeti, gecikmeler, müşteriden beklenenler.">
              <Textarea rows={6} value={draft.notes} onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))} />
            </Field>
            <Field label="Reklam / GİP notları (opsiyonel)" hint="Yalnızca serbest metin. Hekim raporunda gösterim / tıklama gibi performans sayısı verilmez.">
              <Textarea rows={3} value={draft.ads} onChange={(e) => setDraft((d) => ({ ...d, ads: e.target.value }))} />
            </Field>
          </div>
          <div className="mt-4 grid gap-2">
            <Button onClick={() => void save()} loading={saving} disabled={!dirty}>
              {!saving && <Save className="h-4 w-4" aria-hidden />}
              {saving ? "Kaydediliyor…" : dirty ? "Kaydet" : "Kaydedildi"}
            </Button>
            <Button variant="ghost" onClick={() => void openPrint()} disabled={saving}>
              <Printer className="h-4 w-4" aria-hidden /> Yazdırma görünümü
            </Button>
            <p className="text-[11px] leading-4 text-muted">
              {saved ? `Son kayıt: ${dateTimeTR(saved.generated_at)}. ` : ""}
              {dirty ? "Yazdırma görünümü önce notları kaydeder." : "Yazdırma penceresinde “PDF olarak kaydet” seçin."}
            </p>
          </div>
        </section>
      </aside>
    </div>
  );
}

function Summary({ report }: { report: MonthlyReport }) {
  const s = report.summary;
  return (
    <section aria-label="Özet">
      <StatStrip
        items={[
          { label: "Yayınlanan içerik", value: String(s.published), tone: "success" },
          { label: "Planlanan içerik", value: String(s.planned), hint: s.planned ? `${s.publishedFromPlan} tanesi bu ay yayınlandı` : undefined },
          { label: "Çekim günü", value: String(s.shootDays), hint: s.shoots ? `${s.shoots} çekim kaydı` : undefined },
          { label: "Onaylı içerik", value: `${s.approvals.approved} / ${s.contents}` },
        ]}
      />
      <div className="card -mt-2 mb-0 flex flex-wrap items-center gap-2 p-3 text-xs">
        <span className="mr-1 font-medium text-muted">Onay durumu:</span>
        {APPROVAL_BUCKETS.map((b) => (
          <Badge key={b} tone={s.approvals[b] ? bucketTone(b) : "muted"}>{bucketLabel(b)}: {s.approvals[b]}</Badge>
        ))}
      </div>
    </section>
  );
}

function ContentsCard({ title, rows, empty }: { title: string; rows: MonthlyReport["contents"]; empty: string }) {
  return (
    <section className="card p-4">
      <h2 className="mb-3 text-sm font-semibold text-foreground">{title} <span className="font-normal text-muted">· {rows.length}</span></h2>
      {rows.length === 0 ? (
        <p className="text-sm text-muted">{empty}</p>
      ) : (
        <ul className="divide-y divide-border/60">
          {rows.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
              <span className="w-24 shrink-0 text-xs tabular-nums text-muted">{c.date ? dateTR(c.date) : "Tarihsiz"}</span>
              <span className="min-w-0 flex-1 truncate text-foreground">{c.title}{c.channel && <span className="text-xs text-muted"> · {c.channel}</span>}</span>
              <Badge tone={contentStatus[c.status].tone}>{contentStatus[c.status].label}</Badge>
              {c.approval ? (
                <Badge tone={approvalStatus[c.approval.status].tone}>v{c.approval.version} · {approvalStatus[c.approval.status].short}</Badge>
              ) : (
                <Badge tone="muted">Onay yok</Badge>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ShootsCard({ report }: { report: MonthlyReport }) {
  return (
    <section className="card p-4">
      <h2 className="mb-3 text-sm font-semibold text-foreground">Çekim günleri <span className="font-normal text-muted">· {report.shoots.length}</span></h2>
      {report.shoots.length === 0 ? (
        <p className="text-sm text-muted">Bu ay çekim kaydı yok.</p>
      ) : (
        <ul className="divide-y divide-border/60">
          {report.shoots.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
              <span className="w-24 shrink-0 text-xs tabular-nums text-muted">{dateTR(s.date)}{s.time && ` ${s.time}`}</span>
              <span className="min-w-0 flex-1 truncate text-foreground">{s.title}{s.location && <span className="text-xs text-muted"> · {s.location}</span>}</span>
              <Badge tone={shootStatus[s.status].tone}>{shootStatus[s.status].label}</Badge>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ApprovalsCard({ report }: { report: MonthlyReport }) {
  return (
    <section className="card p-4">
      <h2 className="mb-1 text-sm font-semibold text-foreground">Onay kayıtları <span className="font-normal text-muted">· {report.approvalRecords.length}</span></h2>
      <p className="mb-3 text-xs text-muted">Hekim / müşteri onayının sürüm sürüm kaydı (mevzuat kanıtı).</p>
      {report.approvalRecords.length === 0 ? (
        <p className="text-sm text-muted">Bu ayın içerikleri için onay kaydı yok.</p>
      ) : (
        <ul className="divide-y divide-border/60">
          {report.approvalRecords.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
              <FileText className="h-4 w-4 shrink-0 text-muted" aria-hidden />
              <span className="min-w-0 flex-1 truncate text-foreground">{a.contentTitle} <span className="text-xs text-muted">v{a.version}</span></span>
              <span className="text-xs text-muted">{a.decidedAt ? `${dateTR(a.decidedAt)}${a.decidedBy ? ` · ${a.decidedBy}` : ""}` : `Gönderildi ${dateTR(a.sentAt)}`}</span>
              <Badge tone={approvalStatus[a.status].tone}>{approvalStatus[a.status].short}</Badge>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
