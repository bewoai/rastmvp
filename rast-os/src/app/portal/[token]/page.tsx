import type { Metadata } from "next";
import Link from "next/link";
import { after } from "next/server";
import { CalendarDays, CheckCircle2, ClipboardCheck, Clapperboard, FileText, Info } from "lucide-react";
import { Chip, PortalFooter, PortalNotFound, PortalShell, Wordmark } from "@/components/portal/PortalChrome";
import { getPortal, touchPortal } from "@/lib/portal-public";
import { isSupabaseConfigured } from "@/lib/env";
import { approvalPath } from "@/lib/approval-logic";
import { approvalStatus, contentStatus, shootStatus } from "@/lib/labels";
import { portalReportPath, splitByMonth } from "@/lib/portal-logic";
import type { PortalContentRow, PortalPayload } from "@/lib/portal-logic";
import { monthLabelTR, parsePoints } from "@/lib/report-logic";

// Herkese açık, salt okunur müşteri portalı. Oturum gerekmez (proxy /portal/* yolunu serbest bırakır);
// veri yalnızca token ile anon RPC'den (portal_get, 0018) gelir. Arama motorlarına kapalı; token başka
// sitelere Referer ile sızmasın diye no-referrer (next.config.ts aynı başlıkları HTTP'de de gönderir).
export const metadata: Metadata = {
  title: "Müşteri portalı · Rast Creative",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

const TZ = "Europe/Istanbul";

/** "YYYY-MM-DD" → "14 Eki Sal" (gün kayması olmasın diye öğlen UTC). */
function dayParts(day: string) {
  const d = new Date(`${day}T12:00:00Z`);
  return {
    num: d.toLocaleDateString("tr-TR", { timeZone: TZ, day: "numeric" }),
    mon: d.toLocaleDateString("tr-TR", { timeZone: TZ, month: "short" }),
    wd: d.toLocaleDateString("tr-TR", { timeZone: TZ, weekday: "short" }),
  };
}

const longDay = (day: string) =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString("tr-TR", { timeZone: TZ, day: "numeric", month: "long", year: "numeric" });

const until = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("tr-TR", { timeZone: TZ, day: "numeric", month: "long" }) : "";

function DateBadge({ day }: { day: string }) {
  if (!day) return <div className="w-12 shrink-0 text-center text-xs text-[#5b6475]">—</div>;
  const p = dayParts(day);
  return (
    <div className="w-12 shrink-0 rounded-xl bg-[#f5f6f9] py-1.5 text-center ring-1 ring-inset ring-[#e3e6ec]">
      <div className="text-lg font-black leading-none text-[#1B2A49]">{p.num}</div>
      <div className="mt-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#5b6475]">{p.mon}</div>
    </div>
  );
}

function Section({ id, icon, title, aside, children }: {
  id: string;
  icon: React.ReactNode;
  title: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="mt-6 rounded-2xl border border-[#e3e6ec] bg-white p-4 shadow-sm sm:p-5">
      <div className="flex items-center gap-2">
        <span className="text-[#E25303]" aria-hidden>{icon}</span>
        <h2 id={id} className="text-base font-bold text-[#1B2A49]">{title}</h2>
        {aside && <span className="ml-auto text-xs text-[#5b6475]">{aside}</span>}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function ContentList({ rows, empty }: { rows: PortalContentRow[]; empty: string }) {
  if (rows.length === 0) return <p className="rounded-xl border border-dashed border-[#e3e6ec] px-4 py-6 text-center text-sm text-[#5b6475]">{empty}</p>;
  return (
    <ul className="divide-y divide-[#eef0f4]">
      {rows.map((c, i) => {
        const st = contentStatus[c.status] ?? { label: c.status, tone: "default" as const };
        const ap = c.approval;
        return (
          <li key={`${c.date}-${i}`} className="flex gap-3 py-3 first:pt-0 last:pb-0">
            <DateBadge day={c.date} />
            <div className="min-w-0 flex-1">
              <p className="font-semibold leading-snug text-[#1f2533]">{c.title}</p>
              {c.channel && <p className="mt-0.5 text-xs text-[#5b6475]">{c.channel}</p>}
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <Chip tone={st.tone}>{st.label}</Chip>
                {ap && <Chip tone={approvalStatus[ap.status].tone}>Onay v{ap.version} · {approvalStatus[ap.status].short}</Chip>}
              </div>
              {ap?.status === "pending" && ap.token && (
                <Link
                  href={approvalPath(ap.token)}
                  prefetch={false}
                  className="mt-2.5 inline-flex min-h-10 items-center gap-2 rounded-xl bg-[#E25303] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#c94902]"
                >
                  <ClipboardCheck className="h-4 w-4" aria-hidden /> İncele ve onayla
                </Link>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function PortalView({ token, p, demo }: { token: string; p: PortalPayload; demo: boolean }) {
  const { current, previous } = splitByMonth(p);
  const report = p.latest_report;
  const points = report?.highlights?.points?.filter(Boolean) ?? [];
  const noteLines = parsePoints(report?.notes).slice(0, 3);
  const pendingOutside = p.pending.filter((x) => !current.some((c) => c.approval?.token === x.token));

  return (
    <main className="mx-auto w-full max-w-2xl px-4 pb-12 pt-6 sm:pt-10">
      <header>
        <div className="flex items-center justify-between gap-3">
          <Wordmark />
          <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#5b6475]">Müşteri portalı</span>
        </div>
        <div className="mt-5 h-1 w-14 rounded-full bg-[#E25303]" aria-hidden />
        <h1 className="mt-3 text-2xl font-black leading-tight text-[#1B2A49] sm:text-3xl">{p.client_name}</h1>
        <p className="mt-1 text-sm text-[#5b6475]">{longDay(p.today)} itibarıyla içerik, çekim ve onay durumu</p>
        {demo && (
          <p className="mt-3 rounded-xl bg-[#eef1f6] px-3 py-2 text-xs text-[#1B2A49]">
            Demo modu: örnek veriler gösteriliyor; veritabanına bağlı değil.
          </p>
        )}
      </header>

      {p.pending_count > 0 && (
        <div role="status" className="mt-6 rounded-2xl border border-[#f7d3b8] bg-[#fff6ef] p-4">
          <p className="font-bold text-[#a8430a]">
            Onayınızı bekleyen {p.pending_count} içerik var
          </p>
          <p className="mt-1 text-sm text-[#5b4a3f]">
            Yayından önce metni okuyup 8 maddelik kontrol listesiyle onaylamanız ya da değişiklik istemeniz gerekiyor.
          </p>
          {pendingOutside.length > 0 && (
            <ul className="mt-3 space-y-2">
              {pendingOutside.map((x) => (
                <li key={x.token} className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="min-w-0 flex-1 font-semibold text-[#1f2533]">{x.title} <span className="font-normal text-[#5b6475]">(v{x.version}, {until(x.expires_at)} tarihine kadar)</span></span>
                  <Link href={approvalPath(x.token)} prefetch={false} className="inline-flex min-h-9 items-center gap-1.5 rounded-xl bg-[#E25303] px-3 text-xs font-semibold text-white hover:bg-[#c94902]">
                    <ClipboardCheck className="h-3.5 w-3.5" aria-hidden /> İncele ve onayla
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <Section id="bu-ay" icon={<CalendarDays className="h-5 w-5" />} title="Bu ay" aside={monthLabelTR(p.months.current)}>
        <ContentList rows={current} empty="Bu ay için planlanmış içerik yok." />
      </Section>

      <Section id="gecen-ay" icon={<CheckCircle2 className="h-5 w-5" />} title="Geçen ay" aside={monthLabelTR(p.months.previous)}>
        <ContentList rows={previous} empty="Geçen ay planlanmış ya da yayınlanmış içerik yok." />
      </Section>

      <Section id="cekim-gunleri" icon={<Clapperboard className="h-5 w-5" />} title="Çekim günleri" aside={`${monthLabelTR(p.months.previous)} – ${monthLabelTR(p.months.current)}`}>
        {p.shoots.length === 0 ? (
          <p className="rounded-xl border border-dashed border-[#e3e6ec] px-4 py-6 text-center text-sm text-[#5b6475]">Bu dönemde planlanmış çekim yok.</p>
        ) : (
          <ul className="divide-y divide-[#eef0f4]">
            {p.shoots.map((s, i) => {
              const st = shootStatus[s.status] ?? { label: s.status, tone: "default" as const };
              return (
                <li key={`${s.date}-${i}`} className="flex gap-3 py-3 first:pt-0 last:pb-0">
                  <DateBadge day={s.date} />
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-[#1f2533]">
                      {dayParts(s.date).wd}{s.time && ` · ${s.time}`}{s.type && <span className="font-normal text-[#5b6475]"> · {s.type}</span>}
                    </p>
                    <p className="mt-0.5 text-sm text-[#5b6475]">{s.location || "Yer bilgisi sonra paylaşılacak"}</p>
                    <div className="mt-1.5"><Chip tone={st.tone}>{st.label}</Chip></div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <Section id="son-rapor" icon={<FileText className="h-5 w-5" />} title="Son rapor" aside={report ? monthLabelTR(report.month) : undefined}>
        {!report ? (
          <p className="rounded-xl border border-dashed border-[#e3e6ec] px-4 py-6 text-center text-sm text-[#5b6475]">Henüz paylaşılmış aylık rapor yok.</p>
        ) : (
          <>
            {points.length > 0 && (
              <ul className="space-y-1.5 text-sm text-[#1f2533]">
                {points.map((t, i) => (
                  <li key={i} className="flex gap-2"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[#E25303]" aria-hidden />{t}</li>
                ))}
              </ul>
            )}
            {noteLines.length > 0 && (
              <div className="mt-3 space-y-1.5 border-l-4 border-[#E25303] bg-[#f5f6f9] px-3 py-2 text-sm text-[#1f2533]">
                {noteLines.map((t, i) => <p key={i}>{t}</p>)}
              </div>
            )}
            <Link
              href={portalReportPath(token, report.month)}
              prefetch={false}
              className="mt-4 inline-flex min-h-10 items-center gap-2 rounded-xl bg-[#1B2A49] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#24375f]"
            >
              <FileText className="h-4 w-4" aria-hidden /> {monthLabelTR(report.month)} raporunu aç
            </Link>
          </>
        )}
      </Section>

      <Section id="nasil-calisir" icon={<Info className="h-5 w-5" />} title="Nasıl çalışır">
        <ol className="list-decimal space-y-1.5 pl-5 text-sm leading-6 text-[#1f2533] marker:font-bold marker:text-[#E25303]">
          <li>Her ay içerikleri birlikte planlarız; bu sayfa planın ve çekim günlerinin güncel halini gösterir.</li>
          <li>Her senaryo yayından önce size gönderilir. &ldquo;İncele ve onayla&rdquo; ile metni okuyup 8 maddelik mevzuat listesiyle onaylar ya da değişiklik istersiniz.</li>
          <li>Onayınız olmadan hiçbir içerik yayınlanmaz; sessizlik onay sayılmaz.</li>
          <li>Ay sonunda sade bir rapor hazırlarız: ne planlandı, ne yayınlandı, hangi onaylar verildi.</li>
        </ol>
      </Section>

      <PortalFooter contactLine={p.contact_line} />
    </main>
  );
}

export default async function PortalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const result = await getPortal(token);
  if (result.kind !== "ok") return <PortalNotFound kind={result.kind} />;

  // "Son görüntülenme" yanıt gönderildikten sonra yazılır (sayfayı bekletmez).
  after(() => touchPortal(token));

  return (
    <PortalShell>
      <PortalView token={token} p={result.payload} demo={!isSupabaseConfigured} />
    </PortalShell>
  );
}
