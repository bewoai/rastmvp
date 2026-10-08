import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { MonthlyReportDoc } from "@/components/MonthlyReportDoc";
import { PortalFooter, PortalNotFound, PortalShell } from "@/components/portal/PortalChrome";
import { PrintButton } from "@/components/portal/PrintButton";
import { getPortalReport } from "@/lib/portal-public";
import { portalPath, portalReportInput } from "@/lib/portal-logic";
import { buildMonthlyReport, monthLabelTR } from "@/lib/report-logic";

// Müşteri portalının salt okunur aylık rapor görünümü: iç yazdırma görünümüyle aynı A4 belge
// (MonthlyReportDoc). Veri yalnızca token + ay ile anon RPC'den (portal_report_get, 0018) gelir ve yalnızca
// ajansın KAYDETTİĞİ aylar açılır. noindex + no-referrer (portal ana sayfasıyla aynı).
export const metadata: Metadata = {
  title: "Aylık rapor · Rast Creative",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

export default async function PortalReportPage({ params }: { params: Promise<{ token: string; "yyyy-mm": string }> }) {
  const p = await params;
  const token = p.token;
  const month = p["yyyy-mm"];
  const result = await getPortalReport(token, month);
  if (result.kind !== "ok") return <PortalNotFound kind={result.kind} what="Rapor" />;

  const now = new Date().toISOString();
  const data = result.data;
  const report = buildMonthlyReport(portalReportInput(data, now));

  return (
    <PortalShell>
      <div className="mx-auto w-full max-w-[210mm] px-4 pb-12 pt-6 print:p-0">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
          <Link
            href={portalPath(token)}
            prefetch={false}
            className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-[#d6dae3] bg-white px-3 py-2 text-sm text-[#1B2A49] transition-colors hover:bg-[#eef1f6]"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden /> Portala dön
          </Link>
          <p className="min-w-0 flex-1 text-xs text-[#5b6475]">
            <span className="font-semibold text-[#1f2533]">{data.client_name}</span> · {monthLabelTR(month)}
            <span className="block">Yazdırma penceresinde Hedef: &ldquo;PDF olarak kaydet&rdquo;.</span>
          </p>
          <PrintButton />
        </div>

        <MonthlyReportDoc clientName={data.client_name} brandNames={data.brand_names} report={report} saved={data.report} now={now} />

        <PortalFooter />
      </div>
    </PortalShell>
  );
}
