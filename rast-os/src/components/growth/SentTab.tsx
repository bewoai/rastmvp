"use client";

import { useMemo, useState } from "react";
import { Ban, Reply } from "lucide-react";
import { Button, Field, Input, Select } from "@/components/form";
import { Badge, EmptyState, Panel } from "@/components/ui";
import { FilterChips, RowActions } from "@/components/list";
import { useDeleteConfirm } from "@/components/confirm";
import { useStore, uid, nowISO } from "@/lib/store";
import { useToasts } from "@/lib/toast";
import { dateTimeTR } from "@/lib/labels";
import { usePlaceDetails } from "@/lib/growth/client";
import { prospectView, renderTemplate, suppressionValue, templateContext } from "@/lib/growth/logic";
import type { OutreachChannel, Prospect, SuppressionEntry } from "@/lib/types";
import { GoogleAttribution, channelLabel, messageStatusLabel } from "./GrowthChrome";
import { ReplyLeadModal } from "./ProspectModals";

type ChannelFilter = "all" | OutreachChannel;
const reasonLabel: Record<SuppressionEntry["reason"], string> = { unsubscribe: "Ret bağlantısı", bounce: "Teslim edilemedi", manual: "Elle", complaint: "Şikâyet" };

/** Gönderilenler: tüm kanallardaki temaslar (e-posta + manuel), "Yanıt geldi" ve ret listesi. */
export function SentTab() {
  const messages = useStore((s) => s.outreach_messages);
  const prospects = useStore((s) => s.prospects);
  const suppression = useStore((s) => s.suppression_list);
  const [channel, setChannel] = useState<ChannelFilter>("all");
  const [reply, setReply] = useState<{ p: Prospect; channel: OutreachChannel } | null>(null);
  const del = useDeleteConfirm();

  const sent = useMemo(
    () => messages
      .filter((m) => ["sent", "bounced", "replied"].includes(m.status) && (channel === "all" || m.channel === channel))
      .sort((a, b) => (b.sent_at ?? b.created_at).localeCompare(a.sent_at ?? a.created_at))
      .slice(0, 200),
    [messages, channel],
  );
  const byId = useMemo(() => new Map(prospects.map((p) => [p.id, p])), [prospects]);
  const { details } = usePlaceDetails(sent.slice(0, 40).map((m) => {
    const p = byId.get(m.prospect_id);
    return p?.source === "places" && !p.name ? p.external_id : null;
  }), "basic");

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: 0 };
    for (const m of messages) if (["sent", "bounced", "replied"].includes(m.status)) { c.all++; c[m.channel] = (c[m.channel] ?? 0) + 1; }
    return c;
  }, [messages]);

  return (
    <div className="space-y-4">
      <FilterChips
        label="Kanal"
        value={channel}
        onChange={setChannel}
        options={(["all", "phone", "whatsapp", "instagram", "email"] as ChannelFilter[]).map((id) => ({ id, label: id === "all" ? "Tümü" : channelLabel[id], count: counts[id] ?? 0 }))}
      />
      {sent.length === 0 ? (
        <EmptyState title="Henüz temas yok" hint="Bugün listesinden aradığınız / yazdığınız adayları kaydedin; burada görünür." cta={{ label: "Bugünün listesi", href: "/musteri-bulma/bugun" }} />
      ) : (
        <ul className="card divide-y divide-border/60" aria-label="Gönderilenler">
          {sent.map((m) => {
            const p = byId.get(m.prospect_id);
            const v = p ? prospectView(p, p.external_id ? details[p.external_id] : undefined) : null;
            const st = m.manual && m.status === "sent" ? { label: "Yapıldı", tone: "default" as const } : messageStatusLabel[m.status];
            return (
              <li key={m.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-foreground">{v?.name ?? "…"} {v?.fromGoogle.includes("name") && <GoogleAttribution className="ml-1" />}</p>
                  <p className="truncate text-xs text-muted">
                    {channelLabel[m.channel]} · {dateTimeTR(m.sent_at ?? m.created_at)} · {m.channel === "email" ? `${m.step_no}. adım: ${renderTemplate(m.subject, v ? templateContext(v) : {}).text}` : m.subject}
                    {m.error ? ` · ${m.error}` : ""}
                  </p>
                </div>
                <Badge tone={st.tone}>{st.label}</Badge>
                {p && m.status === "sent" && p.status !== "replied" && p.status !== "suppressed" && (
                  <Button variant="ghost" onClick={() => setReply({ p, channel: m.channel })}><Reply className="h-4 w-4" aria-hidden /> Yanıt geldi</Button>
                )}
                {m.status === "replied" && m.channel === "email" && (
                  <Button variant="ghost" onClick={() => useStore.getState().update("outreach_messages", m.id, { status: "sent" })}>Geri al</Button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <Panel title={`Ret listesi (${suppression.length})`}>
        <SuppressionForm />
        {suppression.length > 0 && (
          <ul className="mt-3 divide-y divide-border/60 text-sm">
            {suppression.map((s) => (
              <li key={s.id} className="flex items-center gap-3 py-2">
                <Ban className="h-4 w-4 text-danger" aria-hidden />
                <span className="min-w-0 flex-1 truncate text-foreground">{s.value} <span className="text-xs text-muted">({s.kind === "email" ? "e-posta" : s.kind === "domain" ? "alan adı" : "telefon"})</span></span>
                <span className="text-xs text-muted">{reasonLabel[s.reason]} · {dateTimeTR(s.created_at)}</span>
                <RowActions label={s.value} onDelete={() => del.ask({ key: "suppression_list", id: s.id, label: s.value, warning: "Yalnızca yönetici kaldırabilir. Kişi ret hakkını kullandıysa KALDIRMAYIN." })} />
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {reply && <ReplyLeadModal prospect={reply.p} live={reply.p.external_id ? details[reply.p.external_id] : undefined} channel={reply.channel} onClose={() => setReply(null)} />}
      {del.dialog}
    </div>
  );
}

function SuppressionForm() {
  const [kind, setKind] = useState<SuppressionEntry["kind"]>("email");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const v = suppressionValue(kind, value);
    if (!v) return useToasts.getState().push({ message: "Değer geçersiz", tone: "danger" });
    if (useStore.getState().suppression_list.some((s) => s.kind === kind && s.value === v)) return useToasts.getState().push({ message: "Zaten listede" });
    setBusy(true);
    const r = await useStore.getState().add("suppression_list", { id: uid(), kind, value: v, reason: "manual", note: null, created_at: nowISO() });
    setBusy(false);
    if (r.ok) setValue("");
    useToasts.getState().push(r.ok ? { message: "Ret listesine eklendi" } : { message: `Eklenemedi: ${r.error}`, tone: "danger" });
  }

  return (
    <form onSubmit={add} className="grid grid-cols-1 gap-2 sm:grid-cols-[10rem_1fr_auto] sm:items-end">
      <Field label="Tür">
        <Select value={kind} onChange={(e) => setKind(e.target.value as SuppressionEntry["kind"])}>
          <option value="email">E-posta</option>
          <option value="domain">Alan adı</option>
          <option value="phone">Telefon</option>
        </Select>
      </Field>
      <Field label="Değer"><Input value={value} onChange={(e) => setValue(e.target.value)} placeholder={kind === "email" ? "ornek@firma.com" : kind === "domain" ? "firma.com" : "0532 000 00 00"} /></Field>
      <Button type="submit" loading={busy}>Ekle</Button>
    </form>
  );
}
