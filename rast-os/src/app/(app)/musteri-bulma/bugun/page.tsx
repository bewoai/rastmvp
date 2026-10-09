"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Check, Clock, Copy, AtSign, Flame, MessageCircle, Phone, PhoneCall, Reply, ThumbsDown, Undo2, UserRound } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/ui";
import { PageLoading } from "@/components/list";
import { useConfirm } from "@/components/confirm";
import { useHydrated, useStore } from "@/lib/store";
import { useToasts } from "@/lib/toast";
import { useNowMs } from "@/lib/useNowMs";
import {
  logManualContact, markNotInterested, snoozeProspect, undoManualContact, useGrowthStatus, usePlaceDetails,
} from "@/lib/growth/client";
import {
  DAILY_LIST_SIZE, MANUAL_CHANNEL_LABEL, MANUAL_SCRIPTS, contactStats, instagramLink, istanbulDay, prospectView, renderTemplate,
  sectorKeyOf, selectDailyList, telLink, templateContext, whatsappLink,
} from "@/lib/growth/logic";
import type { DailyItem, LivePlace } from "@/lib/growth/logic";
import type { OutreachChannel, Prospect } from "@/lib/types";
import { CompliancePanel, GoogleAttribution, GrowthNav, ScoreBadge } from "@/components/growth/GrowthChrome";
import { ProspectDetailModal, ReplyLeadModal } from "@/components/growth/ProspectModals";

type ManualChannel = Exclude<OutreachChannel, "email">;

export default function BugunPage() {
  const hydrated = useHydrated(["prospects", "outreach_messages", "suppression_list", "leads", "tasks"]);
  const prospects = useStore((s) => s.prospects);
  const messages = useStore((s) => s.outreach_messages);
  const suppression = useStore((s) => s.suppression_list);
  const nowMs = useNowMs();
  const status = useGrowthStatus();
  const [reply, setReply] = useState<{ p: Prospect; channel: OutreachChannel | null } | null>(null);
  const [detail, setDetail] = useState<Prospect | null>(null);

  // Gün içinde sabit liste (bugün temas edilenler "yapıldı" olarak kalır).
  const day = istanbulDay(nowMs);
  const list = useMemo(
    () => selectDailyList(prospects, messages, suppression, { now: nowMs }),
    [prospects, messages, suppression, nowMs],
  );
  const stats = useMemo(() => contactStats(messages, nowMs), [messages, nowMs]);
  const placeIds = useMemo(() => list.map((x) => (x.prospect.source === "places" ? x.prospect.external_id : null)), [list]);
  // ≤10 aday için canlı Place Details (contact: telefon + site). Saklanmaz; yalnızca bu sayfa açıkken bellekte.
  const { details } = usePlaceDetails(placeIds, "contact");
  const done = list.filter((x) => x.doneToday.length > 0).length;

  if (!hydrated) return <PageLoading title="Bugünün listesi" />;

  return (
    <>
      <PageHeader
        title="Bugünün listesi"
        subtitle={`Puanı en yüksek ${DAILY_LIST_SIZE} aday · son 14 günde temas edilmemiş · ertelenmemiş. Ara, WhatsApp'tan ya da Instagram'dan yaz; sonra kaydet.`}
        action={<GrowthNav active="bugun" />}
      />

      <dl className="card mb-4 grid grid-cols-3 gap-px overflow-hidden bg-border/70" aria-label="Günlük sayaç">
        <div className="bg-surface px-4 py-3">
          <dt className="text-xs font-medium text-muted">Bugün temas</dt>
          <dd className="mt-0.5 text-lg font-semibold text-foreground" data-testid="daily-count">{stats.today}</dd>
        </div>
        <div className="bg-surface px-4 py-3">
          <dt className="text-xs font-medium text-muted">Liste</dt>
          <dd className="mt-0.5 text-lg font-semibold text-foreground">{done}/{list.length}</dd>
        </div>
        <div className="bg-surface px-4 py-3">
          <dt className="flex items-center gap-1 text-xs font-medium text-muted"><Flame className="h-3 w-3" aria-hidden /> Seri</dt>
          <dd className="mt-0.5 text-lg font-semibold text-foreground" data-testid="streak">{stats.streak} gün</dd>
        </div>
      </dl>

      <CompliancePanel dailyCap={status?.dailyCap} emailEnabled={status?.emailEnabled} />

      {list.length === 0 ? (
        <EmptyState
          title="Bugün için aday yok"
          hint="Keşfet'ten yeni aday bul ya da hedef klinik listesini içe aktar. Adayı listeye almak için 'Kalifiye' yapın."
          cta={{ label: "Keşfet ve yönet", href: "/musteri-bulma" }}
        />
      ) : (
        <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2" aria-label="Bugünün adayları">
          {list.map((item, i) => (
            <li key={item.prospect.id}>
              <DailyCard
                index={i + 1}
                item={item}
                live={item.prospect.external_id ? details[item.prospect.external_id] : undefined}
                lastManualId={messages.filter((m) => m.prospect_id === item.prospect.id && m.manual && m.sent_at && istanbulDay(m.sent_at) === day).sort((a, b) => (b.sent_at ?? "").localeCompare(a.sent_at ?? ""))[0]?.id}
                onReply={(channel) => setReply({ p: item.prospect, channel })}
                onDetail={() => setDetail(item.prospect)}
              />
            </li>
          ))}
        </ul>
      )}

      {reply && (
        <ReplyLeadModal
          prospect={reply.p}
          live={reply.p.external_id ? details[reply.p.external_id] : undefined}
          channel={reply.channel}
          onClose={() => setReply(null)}
        />
      )}
      {detail && (
        <ProspectDetailModal prospect={detail} live={detail.external_id ? details[detail.external_id] : undefined} onClose={() => setDetail(null)} />
      )}
    </>
  );
}

function DailyCard({
  index, item, live, lastManualId, onReply, onDetail,
}: {
  index: number;
  item: DailyItem<Prospect>;
  live?: LivePlace;
  lastManualId?: string;
  onReply: (channel: OutreachChannel | null) => void;
  onDetail: () => void;
}) {
  const p = item.prospect;
  const view = prospectView(p, live);
  const ctx = templateContext(view);
  const sk = sectorKeyOf(p.sector);
  const waText = renderTemplate(MANUAL_SCRIPTS[sk].whatsapp, ctx).text;
  const igText = renderTemplate(MANUAL_SCRIPTS[sk].instagram, ctx).text;
  const phoneScript = renderTemplate(MANUAL_SCRIPTS[sk].phone, ctx).text;
  const tel = telLink(view.phone);
  const ig = instagramLink(view.instagram);
  const [busy, setBusy] = useState<string | null>(null);
  const confirm = useConfirm();
  const toast = useToasts.getState().push;
  const name = view.name ?? (p.source === "places" ? "Yükleniyor…" : "Adsız aday");
  const isDone = item.doneToday.length > 0;

  async function run(key: string, fn: () => Promise<{ ok: boolean; error?: string }>, okMsg: string) {
    setBusy(key);
    const r = await fn().catch((e: unknown) => ({ ok: false, error: e instanceof Error ? e.message : String(e) }));
    setBusy(null);
    toast(r.ok ? { message: okMsg } : { message: `Kaydedilemedi: ${r.error ?? ""}`, tone: "danger" });
  }

  const log = (channel: ManualChannel) =>
    run(channel, () => logManualContact(p, channel, MANUAL_SCRIPTS[sk][channel]), `${MANUAL_CHANNEL_LABEL[channel].done} — kaydedildi`);

  async function copyInstagram() {
    try {
      await navigator.clipboard.writeText(igText);
      toast({ message: "DM metni panoya kopyalandı — Instagram'da yapıştırıp gönderin" });
    } catch {
      toast({ message: "Pano kullanılamadı; metni elle kopyalayın", tone: "danger" });
    }
  }

  const btn = "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors";
  const ghost = `${btn} border border-border text-foreground hover:bg-surface-2`;

  return (
    <article aria-label={`Aday: ${name}`} className={`card flex h-full flex-col gap-3 p-4 ${isDone ? "opacity-80 ring-1 ring-success/40" : ""}`}>
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-muted">#{index} · {p.sector ?? "—"} · {[view.district, view.city].filter(Boolean).join(" / ") || "—"}</p>
          <h2 className="mt-0.5 truncate text-base font-semibold text-foreground">{name}</h2>
          {view.fromGoogle.length > 0 && <GoogleAttribution />}
        </div>
        <ScoreBadge score={p.score} breakdown={p.score_breakdown} />
      </header>

      {isDone && (
        <p className="flex flex-wrap items-center gap-1.5 text-xs text-success">
          <Check className="h-3.5 w-3.5" aria-hidden /> Bugün: {item.doneToday.map((c) => MANUAL_CHANNEL_LABEL[c as ManualChannel]?.label ?? c).join(", ")}
          {lastManualId && (
            <button type="button" onClick={() => run("undo", () => undoManualContact(lastManualId), "Son kayıt geri alındı")} className="ml-1 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-muted hover:text-foreground">
              <Undo2 className="h-3 w-3" aria-hidden /> geri al
            </button>
          )}
        </p>
      )}

      <div className="grid grid-cols-3 gap-2">
        {tel ? (
          <a href={tel} className={ghost} aria-label={`Ara: ${view.phone}`}><Phone className="h-4 w-4" aria-hidden /> Ara</a>
        ) : (
          <span className={`${ghost} cursor-not-allowed opacity-50`} aria-disabled="true"><Phone className="h-4 w-4" aria-hidden /> Tel yok</span>
        )}
        <a href={whatsappLink(view.phone, waText)} target="_blank" rel="noopener noreferrer" className={`${btn} bg-success/15 text-success hover:bg-success/25`} aria-label="WhatsApp">
          <MessageCircle className="h-4 w-4" aria-hidden /> WhatsApp
        </a>
        {ig ? (
          <a href={ig} target="_blank" rel="noopener noreferrer" onClick={() => void copyInstagram()} className={ghost} aria-label="Instagram DM">
            <AtSign className="h-4 w-4" aria-hidden /> DM
          </a>
        ) : (
          <span className={`${ghost} cursor-not-allowed opacity-50`} aria-disabled="true"><AtSign className="h-4 w-4" aria-hidden /> IG yok</span>
        )}
      </div>

      <details className="rounded-lg border border-border/70 bg-background/30 px-3 py-2 text-sm">
        <summary className="cursor-pointer text-xs font-medium text-muted">Telefon konuşması (20 sn) ve mesaj metinleri</summary>
        <p className="mt-2 text-[13px] leading-5 text-foreground">{phoneScript}</p>
        <p className="mt-2 text-xs text-muted">WhatsApp</p>
        <p className="text-[13px] leading-5 text-muted">{waText}</p>
        <p className="mt-2 flex items-center gap-2 text-xs text-muted">
          Instagram DM
          <button type="button" onClick={() => void copyInstagram()} className="inline-flex items-center gap-1 normal-case tracking-normal text-accent"><Copy className="h-3 w-3" aria-hidden /> kopyala</button>
        </p>
        <p className="text-[13px] leading-5 text-muted">{igText}</p>
      </details>

      <div className="mt-auto grid grid-cols-3 gap-2">
        <button type="button" disabled={busy !== null} onClick={() => log("phone")} className={ghost}><PhoneCall className="h-4 w-4" aria-hidden /> Aradım</button>
        <button type="button" disabled={busy !== null} onClick={() => log("whatsapp")} className={ghost}><MessageCircle className="h-4 w-4" aria-hidden /> WhatsApp attım</button>
        <button type="button" disabled={busy !== null} onClick={() => log("instagram")} className={ghost}><AtSign className="h-4 w-4" aria-hidden /> DM attım</button>
        <button type="button" disabled={busy !== null} onClick={() => onReply(item.doneToday.at(-1) ?? null)} className={`${btn} btn-accent`}><Reply className="h-4 w-4" aria-hidden /> Yanıt geldi</button>
        <button
          type="button"
          disabled={busy !== null}
          onClick={async () => {
            if (await confirm.ask({ title: "İlgilenmiyor olarak işaretle", message: `${name} listeden çıkarılır; kayıtlı e-posta/telefonu ret listesine eklenir ve bir daha aranmaz / yazılmaz.`, confirmLabel: "Listeden çıkar" })) {
              void run("no", () => markNotInterested(p), "Listeden çıkarıldı (ret listesine eklendi)");
            }
          }}
          className={`${btn} bg-danger/15 text-danger hover:bg-danger/25`}
        >
          <ThumbsDown className="h-4 w-4" aria-hidden /> İlgilenmiyor
        </button>
        <button type="button" disabled={busy !== null} onClick={() => run("snooze", () => snoozeProspect(p), "7 gün ertelendi")} className={ghost}><Clock className="h-4 w-4" aria-hidden /> Sonra</button>
      </div>
      <div className="flex justify-between text-xs">
        <button type="button" onClick={onDetail} className="inline-flex items-center gap-1 text-muted hover:text-foreground"><UserRound className="h-3.5 w-3.5" aria-hidden /> Ayrıntı ve geçmiş</button>
        {p.lead_id && <Link href="/crm/leads" prefetch={false} className="text-accent">CRM&apos;de</Link>}
      </div>
      {confirm.dialog}
    </article>
  );
}
