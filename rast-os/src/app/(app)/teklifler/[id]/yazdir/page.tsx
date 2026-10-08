"use client";

import Link from "next/link";
import { use, useEffect, useMemo } from "react";
import { ArrowLeft, Printer } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/ui";
import { PageLoading } from "@/components/list";
import { useStore, useHydrated } from "@/lib/store";
import { proposalStatus } from "@/lib/labels";
import { formatMoney, lineTotal, parseTextBlocks, proposalTotals, sortItems } from "@/lib/proposal-logic";
import type { TextBlock } from "@/lib/proposal-logic";
import type { Proposal, ProposalItem } from "@/lib/types";

// Rast Creative markalı A4 teklif. Ekranda beyaz bir A4 sayfası olarak görünür; yazdırırken uygulama
// kabuğu (sidebar/topbar, AppShell'deki print:* sınıfları) ve bu sayfanın araç çubuğu gizlenir.
// window.print() otomatik ÇAĞRILMAZ — kullanıcı "Yazdır / PDF kaydet" düğmesine basar.
const NAVY = "#1B2A49";
const ORANGE = "#E25303";

const PRINT_CSS = `
@page { size: A4; margin: 18mm; }
@page {
  @bottom-right { content: counter(page) " / " counter(pages); font: 8pt Lato, "Helvetica Neue", Arial, sans-serif; color: #8a93a3; }
}
.rc-doc {
  --rc-navy: ${NAVY};
  --rc-orange: ${ORANGE};
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

const longDate = (s?: string) => {
  if (!s) return "—";
  const d = new Date(`${s.slice(0, 10)}T12:00:00`);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("tr-TR", { day: "numeric", month: "long", year: "numeric" });
};

const qtyText = (it: ProposalItem) =>
  `${new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 2 }).format(Number(it.qty) || 0)} ${it.unit || ""}`.trim();

function Blocks({ blocks }: { blocks: TextBlock[] }) {
  return (
    <div className="rc-blocks">
      {blocks.map((b, i) =>
        b.type === "heading" ? (
          <h3 key={i}>{b.text}</h3>
        ) : b.type === "list" ? (
          <ul key={i} className={b.ordered ? "ordered" : undefined}>{b.items.map((t, j) => <li key={j}>{t}</li>)}</ul>
        ) : (
          <p key={i}>{b.text}</p>
        ),
      )}
    </div>
  );
}

function ItemsTable({ rows, startIndex, proposal, recurring }: { rows: ProposalItem[]; startIndex: number; proposal: Proposal; recurring: boolean }) {
  const money = (n: number) => formatMoney(n, proposal.currency);
  const subtotal = rows.reduce((s, it) => s + lineTotal(it), 0);
  return (
    <table className="rc-table">
      <thead>
        <tr>
          <th className="idx">#</th>
          <th>Hizmet</th>
          <th className="num">Miktar</th>
          <th className="num">Birim fiyat</th>
          <th className="num">{recurring ? "Aylık tutar" : "Tutar"}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((it, i) => (
          <tr key={it.id}>
            <td className="idx">{startIndex + i + 1}</td>
            <td>
              <div className="name">{it.name}</div>
              {it.description && <div className="desc">{it.description}</div>}
            </td>
            <td className="num">{qtyText(it)}</td>
            <td className="num">{money(Number(it.unit_price) || 0)}</td>
            <td className="num">{money(lineTotal(it))}</td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr>
          <td />
          <td colSpan={3}>{recurring ? "Aylık ara toplam (KDV hariç)" : "Ara toplam (KDV hariç)"}</td>
          <td className="num">{money(subtotal)}</td>
        </tr>
      </tfoot>
    </table>
  );
}

export default function ProposalPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const hydrated = useHydrated(["proposals", "proposal_items", "clients"]);
  const proposal = useStore((s) => s.proposals.find((p) => p.id === id));
  const allItems = useStore((s) => s.proposal_items);
  const clients = useStore((s) => s.clients);

  const items = useMemo(() => sortItems(allItems.filter((i) => i.proposal_id === id)), [allItems, id]);

  // Kaydırma kabı <main>; editörden gelince sayfa üstten başlasın.
  useEffect(() => {
    document.getElementById("main")?.scrollTo(0, 0);
  }, []);

  if (!hydrated) return <PageLoading title="Teklif yazdırma görünümü" />;
  if (!proposal) {
    return (
      <>
        <PageHeader title="Teklif bulunamadı" />
        <EmptyState title="Bu teklif yok veya silinmiş" cta={{ label: "Tekliflere dön", href: "/teklifler" }} />
      </>
    );
  }

  const client = clients.find((c) => c.id === proposal.client_id);
  const totals = proposalTotals(items, proposal.vat_rate);
  const money = (n: number) => formatMoney(n, proposal.currency);
  const recurringItems = items.filter((i) => i.is_recurring);
  const oneOffItems = items.filter((i) => !i.is_recurring);
  const zeroPriced = items.filter((i) => lineTotal(i) === 0).length;
  const notes = parseTextBlocks(proposal.notes);
  const terms = parseTextBlocks(proposal.terms);
  const vatLabel = `KDV (%${new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 2 }).format(proposal.vat_rate)})`;
  const onlyRecurring = recurringItems.length > 0 && oneOffItems.length === 0;

  return (
    <>
      {/* Lato (Google Fonts); yüklenemezse Helvetica/Arial'a düşer. React 19 bu bağlantıları <head>'e taşır. */}
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
      {/* Font bilerek yalnızca bu (yazdırma) sayfasında yüklenir; uygulamanın geri kalanı Geist kullanır. */}
      {/* eslint-disable-next-line @next/next/no-page-custom-font */}
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Lato:wght@400;700;900&display=swap" precedence="default" />
      <style>{PRINT_CSS}</style>

      <div className="mx-auto mb-4 flex max-w-[210mm] flex-wrap items-center justify-between gap-3 print:hidden">
        <Link
          href={`/teklifler/${proposal.id}`}
          prefetch={false}
          className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-sm text-foreground transition-colors hover:bg-surface-2"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden /> Editöre dön
        </Link>
        <div className="min-w-0 flex-1 text-xs text-muted">
          <span className="text-foreground">{proposal.proposal_no}</span> · {proposalStatus[proposal.status]?.label}
          {zeroPriced > 0 && <span className="ml-2 text-warning">· {zeroPriced} kalemin tutarı 0 — göndermeden önce fiyat girin</span>}
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

      <article className="rc-doc" aria-label={`Teklif ${proposal.proposal_no}`}>
        <header className="rc-top">
          <div className="rc-wordmark" aria-label="Rast Creative">RAST <span>CREATIVE</span></div>
          <div className="rc-top-meta">
            Teklif
            <strong>{proposal.proposal_no}</strong>
          </div>
        </header>

        {/* Kapak bilgileri */}
        <section style={{ marginTop: "10mm" }}>
          <p className="rc-eyebrow">Hizmet teklifi</p>
          <h1>{proposal.title}</h1>
          <dl className="rc-facts">
            <div><dt>Müşteri</dt><dd>{client?.name ?? "—"}</dd></div>
            <div><dt>Tarih</dt><dd>{longDate(proposal.created_at)}</dd></div>
            <div><dt>Teklif no</dt><dd>{proposal.proposal_no}</dd></div>
            <div><dt>Geçerlilik</dt><dd>{longDate(proposal.valid_until)}</dd></div>
          </dl>
        </section>

        {/* Kapsam */}
        <section>
          <h2>Kapsam ve fiyatlandırma</h2>
          {items.length === 0 ? (
            <p className="rc-empty">Bu teklifte henüz kalem yok.</p>
          ) : totals.mixed ? (
            <>
              <h3>Aylık hizmetler</h3>
              <ItemsTable rows={recurringItems} startIndex={0} proposal={proposal} recurring />
              <h3 style={{ marginTop: "6mm" }}>Tek seferlik işler</h3>
              <ItemsTable rows={oneOffItems} startIndex={recurringItems.length} proposal={proposal} recurring={false} />
            </>
          ) : (
            <ItemsTable rows={items} startIndex={0} proposal={proposal} recurring={onlyRecurring} />
          )}
        </section>

        {/* Toplamlar */}
        {items.length > 0 && (
          <section className="rc-totals">
            <table>
              <tbody>
                {totals.mixed ? (
                  <>
                    <tr className="grp"><td colSpan={2}>Aylık (her ay)</td></tr>
                    <tr><td>Ara toplam</td><td>{money(totals.recurring.subtotal)}</td></tr>
                    <tr><td>{vatLabel}</td><td>{money(totals.recurring.vat)}</td></tr>
                    <tr className="sub"><td>Aylık toplam</td><td>{money(totals.recurring.total)}</td></tr>
                    <tr className="grp"><td colSpan={2}>Tek seferlik</td></tr>
                    <tr><td>Ara toplam</td><td>{money(totals.oneOff.subtotal)}</td></tr>
                    <tr><td>{vatLabel}</td><td>{money(totals.oneOff.vat)}</td></tr>
                    <tr className="sub"><td>Tek seferlik toplam</td><td>{money(totals.oneOff.total)}</td></tr>
                    <tr><td colSpan={2} style={{ height: "2mm", padding: 0 }} /></tr>
                    <tr className="grand">
                      <td>İlk ay toplamı<small>aylık + tek seferlik, KDV dahil</small></td>
                      <td>{money(totals.total)}</td>
                    </tr>
                  </>
                ) : (
                  <>
                    <tr><td>Ara toplam</td><td>{money(totals.subtotal)}</td></tr>
                    <tr><td>{vatLabel}</td><td>{money(totals.vat)}</td></tr>
                    <tr><td colSpan={2} style={{ height: "1.5mm", padding: 0 }} /></tr>
                    <tr className="grand">
                      <td>Genel toplam{onlyRecurring ? " / ay" : ""}<small>KDV dahil</small></td>
                      <td>{money(totals.total)}</td>
                    </tr>
                  </>
                )}
              </tbody>
            </table>
          </section>
        )}

        {/* Süreç / takvim */}
        {notes.length > 0 && (
          <section>
            <h2>Süreç ve takvim</h2>
            <Blocks blocks={notes} />
          </section>
        )}

        {/* Sorumluluklar + ödeme koşulları */}
        {terms.length > 0 && (
          <section>
            <h2>Karşılıklı sorumluluklar ve ödeme koşulları</h2>
            <Blocks blocks={terms} />
          </section>
        )}

        {/* İmza */}
        <section>
          <h2>Onay</h2>
          <p style={{ color: "var(--rc-muted)", fontSize: "9pt" }}>
            Bu teklif {longDate(proposal.valid_until)} tarihine kadar geçerlidir. İmzalanması ile yukarıdaki kapsam ve koşullar kabul edilmiş sayılır.
          </p>
          <div className="rc-sign" style={{ marginTop: "4mm" }}>
            <div>
              <div className="who">Rast Creative</div>
              <div className="line"><span>Ad Soyad</span><span /></div>
              <div className="line"><span>Tarih</span><span /></div>
              <div className="line"><span>İmza</span><span /></div>
            </div>
            <div>
              <div className="who">{client?.name ?? "Müşteri"}</div>
              <div className="line"><span>Ad Soyad</span><span /></div>
              <div className="line"><span>Tarih</span><span /></div>
              <div className="line"><span>İmza / Kaşe</span><span /></div>
            </div>
          </div>
        </section>

        <footer className="rc-foot">
          <span><b>RAST CREATIVE</b></span>
          <span>{proposal.proposal_no} · Tutarlar {proposal.currency} cinsindendir.</span>
        </footer>
      </article>
    </>
  );
}
