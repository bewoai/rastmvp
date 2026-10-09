"use client";

import { useMemo, useState } from "react";
import { AtSign, ChevronLeft, ChevronRight, Globe, ListPlus, MessageCircle, Reply, Star, ThumbsDown } from "lucide-react";
import { Button, Select } from "@/components/form";
import { EmptyState } from "@/components/ui";
import { DataTable, FilterChips, SearchBox, StatusSelect, Toolbar, useListSearch, usePersistentState } from "@/components/list";
import type { Column } from "@/components/list";
import { useConfirm } from "@/components/confirm";
import { useStore } from "@/lib/store";
import { patchRecord } from "@/lib/mutate";
import { useToasts } from "@/lib/toast";
import { dateTR } from "@/lib/labels";
import { enrichProspects, markNotInterested, setProspectStatus, usePlaceDetails } from "@/lib/growth/client";
import {
  MANUAL_SCRIPTS, SECTORS, SECTOR_KEYS, instagramLink, lastContactByProspect, prospectView, renderTemplate, sectorKeyOf,
  templateContext, whatsappLink,
} from "@/lib/growth/logic";
import type { SectorKey } from "@/lib/growth/logic";
import type { Prospect } from "@/lib/types";
import { GoogleAttribution, PROSPECT_STATUSES, ScoreBadge, prospectStatusLabel, sourceLabel } from "./GrowthChrome";
import { ProspectDetailModal, ReplyLeadModal } from "./ProspectModals";
import { SequencePicker } from "./SequencePicker";

const PAGE = 20;
type StatusFilter = "all" | Prospect["status"];
const STATUS_FILTERS: readonly StatusFilter[] = ["all", ...PROSPECT_STATUSES];
const statusOptions = PROSPECT_STATUSES.map((value) => ({ value, ...prospectStatusLabel[value] }));

/** `linked`: kayıt aramasından (`?ac=`) gelinen aday — detay penceresi açık gelir; kapanınca `onLinkedClose`. */
export function ProspectsTab({ linked, onLinkedClose }: { linked?: Prospect; onLinkedClose?: () => void } = {}) {
  const prospects = useStore((s) => s.prospects);
  const messages = useStore((s) => s.outreach_messages);
  const [status, setStatus] = usePersistentState<StatusFilter>("growth-status", "all", STATUS_FILTERS);
  const [sector, setSector] = useState<"all" | SectorKey>("all");
  const [minScore, setMinScore] = useState(0);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [picker, setPicker] = useState(false);
  const [detail, setDetail] = useState<Prospect | null>(null);
  const shownDetail = detail ?? linked ?? null;
  const [reply, setReply] = useState<Prospect | null>(null);
  const [busy, setBusy] = useState(false);
  const confirm = useConfirm();
  const toast = useToasts.getState().push;

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: prospects.length };
    for (const p of prospects) c[p.status] = (c[p.status] ?? 0) + 1;
    return c;
  }, [prospects]);
  const lastContact = useMemo(() => lastContactByProspect(prospects, messages), [prospects, messages]);

  const filtered = useMemo(
    () => prospects
      .filter((p) => (status === "all" || p.status === status) && (sector === "all" || sectorKeyOf(p.sector) === sector) && p.score >= minScore)
      .sort((a, b) => b.score - a.score),
    [prospects, status, sector, minScore],
  );
  // Arama yalnızca saklanan alanlarda (Places adları canlıdır, aranamaz).
  const searched = useListSearch(filtered, query, (p) => `${p.name ?? ""} ${p.sector ?? ""} ${p.city ?? ""} ${p.district ?? ""} ${p.email ?? ""} ${p.instagram ?? ""} ${p.notes ?? ""}`);
  const pages = Math.max(1, Math.ceil(searched.length / PAGE));
  const cur = Math.min(page, pages - 1);
  const visible = searched.slice(cur * PAGE, cur * PAGE + PAGE);
  // Yalnızca görünen sayfadaki Places adayları için canlı ad/adres (basic SKU).
  const { details } = usePlaceDetails(visible.map((p) => (p.source === "places" ? p.external_id : null)), "basic");
  const selectedRows = prospects.filter((p) => selected.has(p.id));

  const toggle = (id: string) => setSelected((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  });

  const columns = useMemo<Column<Prospect>[]>(() => [
    {
      key: "sel", header: "", mobile: "hide", className: "w-8",
      cell: (p) => <input type="checkbox" aria-label="Seç" checked={selected.has(p.id)} onChange={() => toggle(p.id)} className="h-4 w-4 accent-[var(--accent)]" />,
    },
    {
      key: "name", header: "Aday", tone: "primary", mobile: "title",
      cell: (p) => {
        const v = prospectView(p, p.external_id ? details[p.external_id] : undefined);
        return (
          <>
            <span className="block max-w-[18rem] truncate">{v.name ?? (p.source === "places" ? "Yükleniyor…" : "—")}</span>
            <span className="block max-w-[18rem] truncate text-xs font-normal text-muted">
              {sourceLabel[p.source]} · {p.sector ?? "—"} · {[p.district, p.city].filter(Boolean).join(" / ")}
            </span>
          </>
        );
      },
    },
    { key: "score", header: "Puan", sort: (p) => p.score, cell: (p) => <ScoreBadge score={p.score} breakdown={p.score_breakdown} /> },
    {
      key: "status", header: "Durum", mobile: "badge", sort: (p) => PROSPECT_STATUSES.indexOf(p.status),
      cell: (p) => <StatusSelect value={p.status} options={statusOptions} label={`Durum: ${p.name ?? p.id}`} onChange={(s) => patchRecord("prospects", p.id, { status: s }, "Durum güncellenemedi")} />,
    },
    {
      key: "contact", header: "İletişim", mobile: "meta",
      cell: (p) => (
        <span className="text-xs">
          {[p.email ? "e-posta" : null, p.instagram ? "Instagram" : null, p.phone ? "telefon" : null].filter(Boolean).join(" · ") || "—"}
        </span>
      ),
    },
    { key: "last", header: "Son temas", sort: (p) => lastContact.get(p.id), cell: (p) => (lastContact.has(p.id) ? dateTR(new Date(lastContact.get(p.id)!).toISOString()) : "—") },
    { key: "next", header: "Sonraki eylem", mobile: "hide", sort: (p) => p.next_action_at ?? undefined, cell: (p) => dateTR(p.next_action_at ?? undefined) },
  ], [selected, details, lastContact]);

  async function bulk(kind: "qualify" | "enrich" | "no") {
    if (kind === "no" && !(await confirm.ask({ title: "İlgilenmiyor", message: `${selectedRows.length} aday ret listesine alınır.`, confirmLabel: "Listeden çıkar" }))) return;
    setBusy(true);
    if (kind === "qualify") {
      const r = await setProspectStatus(selectedRows.filter((p) => p.status === "new").map((p) => p.id), "qualified");
      toast(r.ok ? { message: "Kalifiye edildi" } : { message: `Hata: ${r.error}`, tone: "danger" });
    } else if (kind === "enrich") {
      const r = await enrichProspects(selectedRows);
      toast(r.error ? { message: `Tarama hatası: ${r.error}`, tone: "danger" } : { message: `${r.updated} site tarandı, ${r.emails} yeni e-posta` });
    } else {
      for (const p of selectedRows) await markNotInterested(p);
      toast({ message: "Ret listesine alındı" });
    }
    setBusy(false);
    setSelected(new Set());
  }

  const anyGoogle = visible.some((p) => p.source === "places" && !p.name);

  return (
    <div className="space-y-3">
      <Toolbar>
        <FilterChips
          label="Aday durumu"
          value={status}
          onChange={(v) => { setStatus(v); setPage(0); }}
          options={STATUS_FILTERS.map((id) => ({ id, label: id === "all" ? "Tümü" : prospectStatusLabel[id].label, count: counts[id] ?? 0 }))}
        />
      </Toolbar>
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <Select aria-label="Sektör" value={sector} onChange={(e) => { setSector(e.target.value as "all" | SectorKey); setPage(0); }} className="sm:w-48">
          <option value="all">Tüm sektörler</option>
          {SECTOR_KEYS.map((k) => <option key={k} value={k}>{SECTORS[k].label}</option>)}
        </Select>
        <Select aria-label="En düşük puan" value={String(minScore)} onChange={(e) => { setMinScore(Number(e.target.value)); setPage(0); }} className="sm:w-40">
          {[0, 30, 50, 70].map((n) => <option key={n} value={n}>{n === 0 ? "Tüm puanlar" : `Puan ≥ ${n}`}</option>)}
        </Select>
        <SearchBox value={query} onChange={(v) => { setQuery(v); setPage(0); }} placeholder="Ad, sektör, şehir, not…" label="Aday ara" />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted">{selected.size} seçili</span>
        <Button variant="ghost" disabled={!selected.size || busy} onClick={() => bulk("qualify")}><Star className="h-4 w-4" aria-hidden /> Kalifiye et</Button>
        <Button variant="ghost" disabled={!selected.size || busy} onClick={() => setPicker(true)}><ListPlus className="h-4 w-4" aria-hidden /> Diziye ekle</Button>
        <Button variant="ghost" disabled={!selected.size || busy} onClick={() => bulk("enrich")}><Globe className="h-4 w-4" aria-hidden /> Siteleri tara</Button>
        <Button variant="danger" disabled={!selected.size || busy} onClick={() => bulk("no")}><ThumbsDown className="h-4 w-4" aria-hidden /> İlgilenmiyor</Button>
        {anyGoogle && <GoogleAttribution className="ml-auto" />}
      </div>

      <DataTable
        columns={columns}
        rows={visible}
        rowKey={(p) => p.id}
        onOpen={(p) => setDetail(p)}
        openLabel={(p) => `Ayrıntı: ${p.name ?? "aday"}`}
        actions={(p) => {
          const v = prospectView(p, p.external_id ? details[p.external_id] : undefined);
          const sk = sectorKeyOf(p.sector);
          const ctx = templateContext(v);
          const ig = instagramLink(v.instagram);
          return (
            <div className="flex items-center justify-end gap-0.5">
              <a href={whatsappLink(v.phone, renderTemplate(MANUAL_SCRIPTS[sk].whatsapp, ctx).text)} target="_blank" rel="noopener noreferrer" title="WhatsApp mesajı (siz gönderirsiniz)" aria-label={`WhatsApp mesajı: ${v.name ?? ""}`} className="flex h-10 w-10 items-center justify-center rounded-lg text-success hover:bg-success/15 md:h-8 md:w-8">
                <MessageCircle className="h-4 w-4" aria-hidden />
              </a>
              {ig && (
                <a
                  href={ig}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Instagram DM (metin panoya kopyalanır)"
                  aria-label={`Instagram DM: ${v.name ?? ""}`}
                  onClick={() => { void navigator.clipboard?.writeText(renderTemplate(MANUAL_SCRIPTS[sk].instagram, ctx).text).catch(() => undefined); toast({ message: "DM metni panoya kopyalandı" }); }}
                  className="flex h-10 w-10 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-foreground md:h-8 md:w-8"
                >
                  <AtSign className="h-4 w-4" aria-hidden />
                </a>
              )}
              {p.status !== "replied" && p.status !== "suppressed" && (
                <button type="button" onClick={() => setReply(p)} title="Yanıt geldi → CRM lead" aria-label={`Yanıt geldi: ${v.name ?? ""}`} className="flex h-10 w-10 items-center justify-center rounded-lg text-accent hover:bg-accent/15 md:h-8 md:w-8">
                  <Reply className="h-4 w-4" aria-hidden />
                </button>
              )}
            </div>
          );
        }}
        empty={<EmptyState title="Aday yok" hint={prospects.length ? "Filtreleri değiştirin." : "Keşfet sekmesinden arama yapın ya da hedef klinik listesini içe aktarın."} />}
      />

      {pages > 1 && (
        <nav aria-label="Sayfalar" className="flex items-center justify-end gap-2 text-sm text-muted">
          <Button variant="ghost" disabled={cur === 0} onClick={() => setPage(cur - 1)} aria-label="Önceki sayfa"><ChevronLeft className="h-4 w-4" aria-hidden /></Button>
          <span>{cur + 1} / {pages}</span>
          <Button variant="ghost" disabled={cur >= pages - 1} onClick={() => setPage(cur + 1)} aria-label="Sonraki sayfa"><ChevronRight className="h-4 w-4" aria-hidden /></Button>
        </nav>
      )}

      {picker && <SequencePicker prospects={selectedRows} onClose={() => setPicker(false)} onDone={() => setSelected(new Set())} />}
      {shownDetail && (
        <ProspectDetailModal
          prospect={shownDetail}
          live={shownDetail.external_id ? details[shownDetail.external_id] : undefined}
          onClose={() => { setDetail(null); onLinkedClose?.(); }}
        />
      )}
      {reply && <ReplyLeadModal prospect={reply} live={reply.external_id ? details[reply.external_id] : undefined} channel={null} onClose={() => setReply(null)} />}
      {confirm.dialog}
    </div>
  );
}
