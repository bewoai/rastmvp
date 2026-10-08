"use client";

// Rast Creative markalı A4 belge stili (teklif ve aylık rapor yazdırma görünümleri ortak kullanır).
// Ekranda beyaz bir A4 sayfası olarak görünür; yazdırırken uygulama kabuğu (sidebar/topbar,
// AppShell'deki print:* sınıfları) ve sayfanın araç çubuğu (print:hidden) gizlenir.
export const RC_NAVY = "#1B2A49";
export const RC_ORANGE = "#E25303";

export const RC_PRINT_CSS = `
@page { size: A4; margin: 18mm; }
@page {
  @bottom-right { content: counter(page) " / " counter(pages); font: 8pt Lato, "Helvetica Neue", Arial, sans-serif; color: #8a93a3; }
}
.rc-doc {
  --rc-navy: ${RC_NAVY};
  --rc-orange: ${RC_ORANGE};
  --rc-ink: #1f2533;
  --rc-muted: #5b6475;
  --rc-line: #e3e6ec;
  --rc-soft: #f5f6f9;
  font-family: Lato, "Helvetica Neue", Helvetica, Arial, sans-serif;
  color: var(--rc-ink);
  background: #fff;
  font-size: 10pt;
  line-height: 1.5;
  width: 100%;
  max-width: 210mm;
  min-height: 297mm;
  margin: 0 auto;
  padding: 18mm;
  box-sizing: border-box;
  box-shadow: 0 20px 60px rgba(0,0,0,.35);
  border-radius: 4px;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
@media (max-width: 640px) { .rc-doc { padding: 8mm 6mm; min-height: 0; } }
.rc-doc *, .rc-doc *::before, .rc-doc *::after { box-sizing: border-box; }
.rc-doc h1, .rc-doc h2, .rc-doc h3 { color: var(--rc-navy); margin: 0; font-weight: 900; letter-spacing: -0.01em; }
.rc-doc h1 { font-size: 22pt; line-height: 1.15; }
.rc-doc h2 { font-size: 12.5pt; margin: 0 0 3mm; display: flex; align-items: center; gap: 2.5mm; break-after: avoid; }
.rc-doc h2::before { content: ""; width: 3mm; height: 3mm; background: var(--rc-orange); border-radius: 1px; flex: none; }
.rc-doc h3 { font-size: 10.5pt; font-weight: 700; margin: 4mm 0 2mm; break-after: avoid; }
.rc-doc p { margin: 0 0 2mm; }
.rc-doc section { margin-top: 9mm; }
.rc-top { display: flex; justify-content: space-between; align-items: flex-end; gap: 8mm; padding-bottom: 4mm; border-bottom: 1.2mm solid var(--rc-orange); }
.rc-wordmark { font-weight: 900; font-size: 17pt; letter-spacing: .32em; color: var(--rc-navy); line-height: 1; white-space: nowrap; }
.rc-wordmark span { color: var(--rc-orange); }
.rc-top-meta { text-align: right; font-size: 8.5pt; color: var(--rc-muted); letter-spacing: .14em; text-transform: uppercase; line-height: 1.4; }
.rc-top-meta strong { display: block; color: var(--rc-navy); font-size: 11pt; letter-spacing: .04em; }
.rc-eyebrow { color: var(--rc-orange); font-weight: 700; font-size: 8.5pt; letter-spacing: .2em; text-transform: uppercase; margin: 0 0 2mm !important; }
.rc-facts { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 0; margin: 6mm 0 0; border: 1px solid var(--rc-line); border-radius: 2mm; overflow: hidden; }
.rc-facts div { padding: 3mm 3.5mm; border-left: 1px solid var(--rc-line); background: var(--rc-soft); }
.rc-facts div:first-child { border-left: 0; }
.rc-facts dt { font-size: 7.5pt; text-transform: uppercase; letter-spacing: .12em; color: var(--rc-muted); }
.rc-facts dd { margin: .8mm 0 0; font-weight: 700; color: var(--rc-navy); word-break: break-word; }
@media (max-width: 640px) { .rc-facts { grid-template-columns: repeat(2, minmax(0, 1fr)); } .rc-facts div:nth-child(3) { border-left: 0; } }
.rc-table { width: 100%; border-collapse: collapse; font-size: 9.5pt; }
.rc-table th { background: var(--rc-navy); color: #fff; font-weight: 700; text-align: left; padding: 2.2mm 3mm; font-size: 8pt; letter-spacing: .08em; text-transform: uppercase; }
.rc-table td { padding: 2.6mm 3mm; border-bottom: 1px solid var(--rc-line); vertical-align: top; }
.rc-table tr { break-inside: avoid; }
.rc-table .num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; width: 27mm; }
.rc-table .idx { width: 8mm; color: var(--rc-muted); }
.rc-table .name { font-weight: 700; color: var(--rc-navy); }
.rc-table .desc { color: var(--rc-muted); font-size: 8.5pt; margin-top: .6mm; }
.rc-table tfoot td { font-weight: 700; color: var(--rc-navy); border-bottom: 0; background: var(--rc-soft); }
.rc-totals { display: flex; justify-content: flex-end; break-inside: avoid; }
.rc-totals table { width: 92mm; max-width: 100%; border-collapse: collapse; font-size: 9.5pt; }
.rc-totals td { padding: 1.6mm 3mm; }
.rc-totals td:last-child { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.rc-totals .grp td { text-align: left !important; padding-top: 3mm; font-weight: 700; color: var(--rc-navy); font-size: 8pt; letter-spacing: .1em; text-transform: uppercase; }
.rc-totals .sub td { border-top: 1px solid var(--rc-line); font-weight: 700; }
.rc-totals .grand { background: var(--rc-navy); }
.rc-totals .grand td { background: var(--rc-navy); color: #fff; font-weight: 900; font-size: 11.5pt; padding: 3mm; }
.rc-totals .grand td:last-child { color: #fff; }
.rc-totals .grand small { display: block; font-weight: 400; font-size: 7.5pt; opacity: .8; }
.rc-blocks ul { margin: 0 0 2mm; padding-left: 5mm; list-style: disc; }
.rc-blocks ul.ordered { list-style: none; padding-left: 0; }
.rc-blocks li { margin: 0 0 1.2mm; }
.rc-blocks li::marker { color: var(--rc-orange); }
.rc-blocks h3:first-child { margin-top: 0; }
.rc-sign { display: grid; grid-template-columns: 1fr 1fr; gap: 10mm; break-inside: avoid; }
.rc-sign > div { border: 1px solid var(--rc-line); border-top: 1mm solid var(--rc-navy); border-radius: 1.5mm; padding: 4mm; }
.rc-sign .who { font-weight: 900; color: var(--rc-navy); margin-bottom: 5mm; }
.rc-sign .line { display: flex; align-items: flex-end; gap: 3mm; margin-top: 6mm; font-size: 8.5pt; color: var(--rc-muted); }
.rc-sign .line span:last-child { flex: 1; border-bottom: 1px solid #b9bfca; height: 4mm; }
.rc-foot { margin-top: 10mm; padding-top: 3mm; border-top: 1px solid var(--rc-line); font-size: 8pt; color: var(--rc-muted); display: flex; justify-content: space-between; gap: 6mm; }
.rc-foot b { color: var(--rc-navy); letter-spacing: .2em; }
.rc-empty { padding: 6mm; text-align: center; color: var(--rc-muted); border: 1px dashed var(--rc-line); border-radius: 2mm; }
@media print {
  html, body { background: #fff !important; }
  .rc-doc { max-width: none; min-height: 0; padding: 0; margin: 0; box-shadow: none; border-radius: 0; }
  .rc-doc section { margin-top: 7mm; }
}
`;

/**
 * Lato (Google Fonts; yüklenemezse Helvetica/Arial'a düşer) + ortak belge CSS'i. React 19 bağlantıları
 * <head>'e taşır. Font bilerek yalnızca yazdırma sayfalarında yüklenir; uygulamanın geri kalanı Geist kullanır.
 */
export function RastDocStyles({ extra = "" }: { extra?: string }) {
  return (
    <>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
      {/* eslint-disable-next-line @next/next/no-page-custom-font */}
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Lato:wght@400;700;900&display=swap" precedence="default" />
      <style>{RC_PRINT_CSS + extra}</style>
    </>
  );
}
