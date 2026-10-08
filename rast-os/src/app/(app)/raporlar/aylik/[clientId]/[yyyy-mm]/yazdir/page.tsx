"use client";

import Link from "next/link";
import { use, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Printer } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/ui";
import { PageLoading } from "@/components/list";
import { RastDocStyles } from "@/components/RastDocStyles";
import { useStore, useHydrated, nowISO } from "@/lib/store";
import { approvalStatus, contentStatus, shootStatus } from "@/lib/labels";
import { parseTextBlocks } from "@/lib/proposal-logic";
import {
  APPROVAL_BUCKETS, buildMonthlyReport, findReport, isValidMonth, localDay, monthLabelTR,
} from "@/lib/report-logic";
import type { ApprovalBucket, ReportContentRow } from "@/lib/report-logic";

// Rast Creative markalı A4 aylık müşteri raporu. Ortak belge stili: components/RastDocStyles.tsx.
// Tüm sayılar içerik / çekim / onay kayıtlarından hesaplanır; tahmini veya reklam performansı verisi YOK.
// window.print() otomatik ÇAĞRILMAZ — kullanıcı "Yazdır / PDF kaydet" düğmesine basar.

const REPORT_CSS = `
.rc-stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 3mm; }
.rc-stat { border: 1px solid var(--rc-line); border-top: 1mm solid var(--rc-navy); border-radius: 1.5mm; padding: 3mm 3.5mm; break-inside: avoid; }
.rc-stat .v { font-size: 20pt; font-weight: 900; color: var(--rc-navy); line-height: 1.1; font-variant-numeric: tabular-nums; }
.rc-stat .l { font-size: 7.5pt; text-transform: uppercase; letter-spacing: .12em; color: var(--rc-muted); margin-top: 1mm; }
.rc-stat .h { font-size: 8pt; color: var(--rc-muted); margin-top: .6mm; }
@media (max-width: 640px) { .rc-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
.rc-dist { display: flex; flex-wrap: wrap; gap: 2mm; margin-top: 3mm; font-size: 8.5pt; }
.rc-tag { display: inline-block; border-radius: 99px; padding: .4mm 2.4mm; font-size: 8pt; font-weight: 700; white-space: nowrap; background: var(--rc-soft); color: var(--rc-muted); border: 1px solid var(--rc-line); }
.rc-tag.ok { background: #e8f5ee; color: #1d6b41; border-color: #c4e5d2; }
.rc-tag.wait { background: #fff3e8; color: #a8430a; border-color: #f7d3b8; }
.rc-tag.bad { background: #fdecec; color: #a12828; border-color: #f3c7c7; }
.rc-table .date { width: 24mm; white-space: nowrap; font-variant-numeric: tabular-nums; }
.rc-table .tag { width: 1%; white-space: nowrap; }
.rc-note { border-left: 1mm solid var(--rc-orange); background: var(--rc-soft); padding: 3mm 4mm; border-radius: 0 1.5mm 1.5mm 0; }
.rc-note + .rc-note { margin-top: 3mm; }
.rc-note h3 { margin-top: 0 !important; }
.rc-fine { font-size: 8pt; color: var(--rc-muted); }
/* Dar ekranda (önizleme) geniş tablolar sayfayı taşırmasın; yazdırmada etkisiz. */
@media screen and (max-width: 900px) { .rc-doc { overflow-x: auto; } }
`;

const toneClass = (tone: string) =>
  tone === "success" ? "ok" : tone === "amber" || tone === "warning" ? "wait" : tone === "danger" ? "bad" : "";

const longDate = (s?: string | null) => {
  const day = localDay(s);
  if (!day) return "—";
  return new Date(`${day}T12:00:00`).toLocaleDateString("tr-TR", { day: "numeric", month: "long", year: "numeric" });
};
const shortDate = (s?: string | null) => {
  const day = localDay(s);
  if (!day) return "—";
  return new Date(`${day}T12:00:00`).toLocaleDateString("tr-TR", { day: "2-digit", month: "2-digit", year: "numeric" });
};

const bucketLabel = (b: ApprovalBucket) => (b === "none" ? "Onaya gönderilmedi" : approvalStatus[b].label);

function ContentTable({ rows }: { rows: ReportContentRow[] }) {
  return (
    <table className="rc-table">
      <thead>
        <tr>
          <th className="date">Tarih</th>
          <th>Başlık</th>
          <th>Kanal</th>
          <th className="tag">Durum</th>
          <th className="tag">Onay</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((c) => (
          <tr key={c.id}>
            <td className="date">{c.date ? shortDate(c.date) : "—"}</td>
            <td><div className="name">{c.title}</div></td>
            <td>{c.channel || "—"}</td>
            <td className="tag"><span className={`rc-tag ${toneClass(contentStatus[c.status].tone)}`}>{contentStatus[c.status].label}</span></td>
            <td className="tag">
              {c.approval ? (
                <span className={`rc-tag ${toneClass(approvalStatus[c.approval.status].tone)}`}>v{c.approval.version} · {approvalStatus[c.approval.status].short}</span>
              ) : (
                <span className="rc-tag">—</span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function MonthlyReportPrintPage({ params }: { params: Promise<{ clientId: string; "yyyy-mm": string }> }) {
  const p = use(params);
  const clientId = decodeURIComponent(p.clientId);
  const month = p["yyyy-mm"];
  const hydrated = useHydrated(["clients", "brands", "contents", "shoots", "content_approvals", "client_reports"]);
  const client = useStore((s) => s.clients.find((c) => c.id === clientId));
  const brands = useStore((s) => s.brands);
  const contents = useStore((s) => s.contents);
  const shoots = useStore((s) => s.shoots);
  const approvals = useStore((s) => s.content_approvals);
  const saved = useStore((s) => findReport(s.client_reports, clientId, month));
  const [now] = useState(() => nowISO());

  const report = useMemo(
    () => (isValidMonth(month) ? buildMonthlyReport({ clientId, month, contents, shoots, approvals, now }) : null),
    [clientId, month, contents, shoots, approvals, now],
  );

  // Kaydırma kabı <main>; rapor editöründen gelince sayfa üstten başlasın.
  useEffect(() => {
    document.getElementById("main")?.scrollTo(0, 0);
  }, []);

  if (!hydrated) return <PageLoading title="Aylık rapor yazdırma görünümü" />;
  if (!client || !report) {
    return (
      <>
        <PageHeader title="Rapor bulunamadı" />
        <EmptyState
          title={!report ? "Geçersiz ay" : "Bu müşteri yok veya silinmiş"}
          hint="Rapor sayfasından müşteri ve ay seçin."
          cta={{ label: "Aylık rapora dön", href: "/raporlar/aylik" }}
        />
      </>
    );
  }

  const s = report.summary;
  const label = monthLabelTR(month);
  const brandNames = brands.filter((b) => b.client_id === client.id).map((b) => b.name);
  const points = saved?.highlights?.points ?? [];
  const notes = parseTextBlocks(saved?.notes);
  const adsNote = parseTextBlocks(saved?.highlights?.ads_note);
  const ratio = s.planned ? Math.round((s.publishedFromPlan / s.planned) * 100) : null;

  return (
    <>
      <RastDocStyles extra={REPORT_CSS} />

      <div className="mx-auto mb-4 flex max-w-[210mm] flex-wrap items-center justify-between gap-3 print:hidden">
        <Link
          href={`/raporlar/aylik?musteri=${encodeURIComponent(client.id)}&ay=${month}`}
          prefetch={false}
          className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-sm text-foreground transition-colors hover:bg-surface-2"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden /> Rapora dön
        </Link>
        <div className="min-w-0 flex-1 text-xs text-muted">
          <span className="text-foreground">{client.name}</span> · {label}
          {!saved && <span className="ml-2 text-warning">· Not yazılmamış — rapor sayfasından ekleyebilirsiniz</span>}
          <span className="block">Yazdırma penceresinde Hedef: “PDF olarak kaydet”, Kenar boşlukları: Varsayılan.</span>
        </div>
        <button
          type="button"
          onClick={() => window.print()}
          className="btn-amber inline-flex min-h-10 items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium"
        >
          <Printer className="h-4 w-4" aria-hidden /> Yazdır / PDF kaydet
        </button>
      </div>

      <article className="rc-doc" aria-label={`${client.name} ${label} raporu`}>
        <header className="rc-top">
          <div className="rc-wordmark" aria-label="Rast Creative">RAST <span>CREATIVE</span></div>
          <div className="rc-top-meta">
            Aylık rapor
            <strong>{label}</strong>
          </div>
        </header>

        <section style={{ marginTop: "10mm" }}>
          <p className="rc-eyebrow">İçerik ve onay raporu</p>
          <h1>{client.name}</h1>
          <dl className="rc-facts">
            <div><dt>Dönem</dt><dd>{label}</dd></div>
            <div><dt>Marka</dt><dd>{brandNames.length ? brandNames.join(", ") : "—"}</dd></div>
            <div><dt>Rapor tarihi</dt><dd>{longDate(saved?.generated_at ?? now)}</dd></div>
            <div><dt>Hazırlayan</dt><dd>Rast Creative</dd></div>
          </dl>
        </section>

        {/* 1. Özet */}
        <section>
          <h2>Özet</h2>
          <div className="rc-stats">
            <div className="rc-stat"><div className="v">{s.published}</div><div className="l">Yayınlanan içerik</div></div>
            <div className="rc-stat">
              <div className="v">{s.planned}</div><div className="l">Planlanan içerik</div>
              {ratio !== null && <div className="h">{s.publishedFromPlan} tanesi bu ay yayınlandı (%{ratio})</div>}
            </div>
            <div className="rc-stat">
              <div className="v">{s.shootDays}</div><div className="l">Çekim günü</div>
              {s.shoots > 0 && <div className="h">{s.shoots} çekim kaydı</div>}
            </div>
            <div className="rc-stat"><div className="v">{s.approvals.approved}</div><div className="l">Onaylı içerik</div><div className="h">{s.contents} içerikten</div></div>
          </div>
          <div className="rc-dist" aria-label="Onay durumu dağılımı">
            {APPROVAL_BUCKETS.filter((b) => s.approvals[b] > 0).map((b) => (
              <span key={b} className={`rc-tag ${b === "none" ? "" : toneClass(approvalStatus[b].tone)}`}>{bucketLabel(b)}: {s.approvals[b]}</span>
            ))}
            {s.contents === 0 && <span className="rc-fine">Bu ay planlanmış ya da yayınlanmış içerik yok.</span>}
          </div>
          {points.length > 0 && (
            <div className="rc-blocks" style={{ marginTop: "4mm" }}>
              <h3>Öne çıkanlar</h3>
              <ul>{points.map((t, i) => <li key={i}>{t}</li>)}</ul>
            </div>
          )}
        </section>

        {/* 2. İçerik listesi */}
        <section>
          <h2>İçerik listesi</h2>
          {report.contents.length === 0 ? <p className="rc-empty">Bu ay planlanmış ya da yayınlanmış içerik yok.</p> : <ContentTable rows={report.contents} />}
        </section>

        {/* 3. Çekim günleri */}
        <section>
          <h2>Çekim günleri</h2>
          {report.shoots.length === 0 ? (
            <p className="rc-empty">Bu ay çekim yapılmadı.</p>
          ) : (
            <table className="rc-table">
              <thead>
                <tr><th className="date">Tarih</th><th>Çekim</th><th>Yer</th><th className="tag">Durum</th></tr>
              </thead>
              <tbody>
                {report.shoots.map((sh) => (
                  <tr key={sh.id}>
                    <td className="date">{shortDate(sh.date)}{sh.time && <div className="desc">{sh.time}</div>}</td>
                    <td><div className="name">{sh.title}</div>{sh.type && <div className="desc">{sh.type}</div>}</td>
                    <td>{sh.location || "—"}</td>
                    <td className="tag"><span className={`rc-tag ${toneClass(shootStatus[sh.status].tone)}`}>{shootStatus[sh.status].label}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {/* 4. Onay kayıtları */}
        <section>
          <h2>Onay kayıtları</h2>
          <p className="rc-fine">
            Her senaryo yayından önce 8 maddelik mevzuat kontrol listesiyle onaya sunulur (Sağlık Hizmetlerinde Tanıtım
            Yönetmeliği md. 5/2 ortak sorumluluk). Aşağıdaki kayıtlar onayın sürüm sürüm kanıtıdır.
          </p>
          {report.approvalRecords.length === 0 ? (
            <p className="rc-empty">Bu ayın içerikleri için onay kaydı yok.</p>
          ) : (
            <table className="rc-table">
              <thead>
                <tr><th>İçerik</th><th className="tag">Sürüm</th><th className="tag">Karar</th><th>Karar veren</th><th className="date">Tarih</th><th className="tag">Kontrol</th></tr>
              </thead>
              <tbody>
                {report.approvalRecords.map((a) => (
                  <tr key={a.id}>
                    <td><div className="name">{a.contentTitle}</div></td>
                    <td className="tag">v{a.version}</td>
                    <td className="tag"><span className={`rc-tag ${toneClass(approvalStatus[a.status].tone)}`}>{approvalStatus[a.status].short}</span></td>
                    <td>{a.decidedBy || "—"}</td>
                    <td className="date">{a.decidedAt ? shortDate(a.decidedAt) : <>{shortDate(a.sentAt)}<div className="desc">gönderildi</div></>}</td>
                    <td className="tag">{a.total ? `${a.checked}/${a.total}` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {/* 5. Gelecek ay planı */}
        <section>
          <h2>Gelecek ay planı · {monthLabelTR(report.nextMonth)}</h2>
          {report.nextMonthPlan.length === 0 ? <p className="rc-empty">Gelecek ay için henüz planlanmış içerik yok.</p> : <ContentTable rows={report.nextMonthPlan} />}
        </section>

        {/* 6. Notlar */}
        <section>
          <h2>Notlar</h2>
          {notes.length === 0 && adsNote.length === 0 ? (
            <p className="rc-empty">Bu ay için not eklenmedi.</p>
          ) : (
            <>
              {notes.length > 0 && (
                <div className="rc-note rc-blocks">
                  {notes.map((b, i) =>
                    b.type === "heading" ? <h3 key={i}>{b.text}</h3> : b.type === "list" ? (
                      <ul key={i} className={b.ordered ? "ordered" : undefined}>{b.items.map((t, j) => <li key={j}>{t}</li>)}</ul>
                    ) : <p key={i}>{b.text}</p>,
                  )}
                </div>
              )}
              {adsNote.length > 0 && (
                <div className="rc-note rc-blocks">
                  <h3>Reklam / GİP notları</h3>
                  {adsNote.map((b, i) =>
                    b.type === "list" ? <ul key={i}>{b.items.map((t, j) => <li key={j}>{t}</li>)}</ul> : <p key={i}>{b.text}</p>,
                  )}
                </div>
              )}
            </>
          )}
        </section>

        <footer className="rc-foot">
          <span><b>RAST CREATIVE</b></span>
          <span>Sayılar Rast OS içerik, çekim ve onay kayıtlarından alınmıştır; tahmini veya reklam performansı verisi içermez.</span>
        </footer>
      </article>
    </>
  );
}
