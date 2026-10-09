"use client";

import Link from "next/link";
import { use, useEffect, useMemo } from "react";
import { ArrowLeft, Printer } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/ui";
import { PageLoading } from "@/components/list";
import { RastDocStyles } from "@/components/RastDocStyles";
import { useStore, useHydrated } from "@/lib/store";
import { proposalStatus } from "@/lib/labels";
import { formatMoney, lineTotal, parseTextBlocks, proposalTotals, sortItems } from "@/lib/proposal-logic";
import type { TextBlock } from "@/lib/proposal-logic";
import type { Proposal, ProposalItem } from "@/lib/types";

// Rast Creative markalı A4 teklif. Ortak belge stili: components/RastDocStyles.tsx.
// window.print() otomatik ÇAĞRILMAZ — kullanıcı "Yazdır / PDF kaydet" düğmesine basar.

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
      <RastDocStyles />

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
          className="btn-accent inline-flex min-h-10 items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium"
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
