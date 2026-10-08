"use client";

import Link from "next/link";
import { use, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Printer } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/ui";
import { PageLoading } from "@/components/list";
import { MonthlyReportDoc } from "@/components/MonthlyReportDoc";
import { useStore, useHydrated, nowISO } from "@/lib/store";
import { buildMonthlyReport, findReport, isValidMonth, monthLabelTR } from "@/lib/report-logic";

// Rast Creative markalı A4 aylık müşteri raporu (iç yazdırma görünümü). Belge: components/MonthlyReportDoc.tsx
// (müşteri portalının rapor görünümüyle ortak). Tüm sayılar içerik / çekim / onay kayıtlarından hesaplanır.
// window.print() otomatik ÇAĞRILMAZ — kullanıcı "Yazdır / PDF kaydet" düğmesine basar.

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

  const label = monthLabelTR(month);
  const brandNames = brands.filter((b) => b.client_id === client.id).map((b) => b.name);

  return (
    <>
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

      <MonthlyReportDoc clientName={client.name} brandNames={brandNames} report={report} saved={saved} now={now} />
    </>
  );
}
