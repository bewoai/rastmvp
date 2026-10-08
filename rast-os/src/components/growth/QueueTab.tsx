"use client";

import { useMemo, useState } from "react";
import { CalendarClock, Check, MailX, Pencil, Undo2 } from "lucide-react";
import { Button, Field, FormModal, Input, Textarea } from "@/components/form";
import { Badge, EmptyState } from "@/components/ui";
import { useStore } from "@/lib/store";
import { useToasts } from "@/lib/toast";
import { useNowMs } from "@/lib/useNowMs";
import { dateTimeTR } from "@/lib/labels";
import { approveMessages, scheduleApproved, usePlaceDetails } from "@/lib/growth/client";
import type { GrowthStatus } from "@/lib/growth/client";
import { emailsSentToday, isSuppressed, normalizeEmail, prospectView, remainingCap, renderTemplate, templateContext } from "@/lib/growth/logic";
import type { OutreachMessage, Prospect } from "@/lib/types";
import { GoogleAttribution, messageStatusLabel } from "./GrowthChrome";

/** Onay kuyruğu: taslaklar (önizleme belirteçler doldurulmuş), düzenle → onayla (tekli / toplu), günlük limit. */
export function QueueTab({ status }: { status: GrowthStatus | null }) {
  const messages = useStore((s) => s.outreach_messages);
  const prospects = useStore((s) => s.prospects);
  const suppression = useStore((s) => s.suppression_list);
  const nowMs = useNowMs();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [edit, setEdit] = useState<OutreachMessage | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToasts.getState().push;
  const emailEnabled = Boolean(status?.emailEnabled);
  const cap = status?.dailyCap ?? 20;

  const queue = useMemo(
    () => messages.filter((m) => m.channel === "email" && !m.manual && (m.status === "draft" || m.status === "approved" || m.status === "scheduled"))
      .sort((a, b) => a.status.localeCompare(b.status) || a.created_at.localeCompare(b.created_at)),
    [messages],
  );
  const byId = useMemo(() => new Map(prospects.map((p) => [p.id, p])), [prospects]);
  const { details } = usePlaceDetails(queue.map((m) => {
    const p = byId.get(m.prospect_id);
    return p?.source === "places" && !p.name ? p.external_id : null;
  }), "basic");

  const sentToday = emailsSentToday(messages, nowMs);
  const approvedPending = queue.filter((m) => m.status === "approved").length;
  const unscheduled = queue.filter((m) => m.status === "approved" && !m.scheduled_for);
  const drafts = queue.filter((m) => m.status === "draft");

  const viewOf = (m: OutreachMessage) => {
    const p = byId.get(m.prospect_id);
    return p ? prospectView(p, p.external_id ? details[p.external_id] : undefined) : null;
  };

  async function approve(ms: OutreachMessage[]) {
    const blocked = ms.filter((m) => !m.to_email || isSuppressed(suppression, { email: m.to_email }));
    const ok = ms.filter((m) => !blocked.includes(m));
    setBusy(true);
    const r = await approveMessages(ok, emailEnabled);
    setBusy(false);
    setSelected(new Set());
    if (!r.ok) return toast({ message: `Onaylanamadı: ${r.error}`, tone: "danger" });
    toast({ message: `${ok.length} mesaj onaylandı${emailEnabled ? " ve planlandı" : " (gönderim kapalı — planlanmadı)"}${blocked.length ? ` · ${blocked.length} ret listesinde / alıcısız` : ""}` });
  }

  const allDrafts = drafts.length > 0 && drafts.every((m) => selected.has(m.id));

  return (
    <div className="space-y-3">
      {!emailEnabled && (
        <div role="status" className="flex items-start gap-3 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning">
          <MailX className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <div>
            <p className="font-medium">E-posta gönderimi kapalı (İYS kaydı bekleniyor)</p>
            <p className="text-[13px] text-warning/90">Taslak hazırlayıp onaylayabilirsiniz; onay yalnızca &quot;onaylandı&quot; işaretler, gönderim planlanmaz ve hiçbir e-posta gitmez. Bu arada adaylara Bugün listesinden telefon / WhatsApp / Instagram ile ulaşın.</p>
          </div>
        </div>
      )}

      <dl className="card grid grid-cols-3 gap-px overflow-hidden bg-border/70 text-sm">
        <div className="bg-surface/95 px-4 py-3"><dt className="text-[11px] uppercase tracking-wide text-muted">Bugün gönderilen</dt><dd className="text-lg font-semibold text-foreground">{sentToday} / {cap}</dd></div>
        <div className="bg-surface/95 px-4 py-3"><dt className="text-[11px] uppercase tracking-wide text-muted">Kalan limit</dt><dd className="text-lg font-semibold text-foreground">{emailEnabled ? remainingCap(cap, sentToday) : "—"}</dd></div>
        <div className="bg-surface/95 px-4 py-3"><dt className="text-[11px] uppercase tracking-wide text-muted">Onaylı bekleyen</dt><dd className="text-lg font-semibold text-amber">{approvedPending}</dd></div>
      </dl>
      <div className="h-1.5 overflow-hidden rounded-full bg-surface-2" aria-hidden>
        <div className="h-full bg-amber" style={{ width: `${Math.min(100, cap ? (sentToday / cap) * 100 : 0)}%` }} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="inline-flex items-center gap-2 text-sm text-muted">
          <input type="checkbox" checked={allDrafts} disabled={!drafts.length} onChange={() => setSelected(allDrafts ? new Set() : new Set(drafts.map((m) => m.id)))} className="h-4 w-4 accent-[var(--amber)]" />
          Tüm taslaklar ({drafts.length})
        </label>
        <Button disabled={!selected.size || busy} onClick={() => approve(queue.filter((m) => selected.has(m.id)))}><Check className="h-4 w-4" aria-hidden /> Seçilenleri onayla ({selected.size})</Button>
        {emailEnabled && unscheduled.length > 0 && (
          <Button variant="ghost" onClick={async () => { const r = await scheduleApproved(unscheduled); toast(r.ok ? { message: `${unscheduled.length} mesaj planlandı` } : { message: `Hata: ${r.error}`, tone: "danger" }); }}>
            <CalendarClock className="h-4 w-4" aria-hidden /> Onaylıları planla ({unscheduled.length})
          </Button>
        )}
      </div>

      {queue.length === 0 ? (
        <EmptyState title="Kuyruk boş" hint="Adaylar sekmesinde e-postası olan adayları seçip 'Diziye ekle' ile taslak oluşturun." />
      ) : (
        <ul className="space-y-2" aria-label="Onay kuyruğu">
          {queue.map((m) => {
            const v = viewOf(m);
            const ctx = v ? templateContext(v) : {};
            const subj = renderTemplate(m.subject, ctx);
            const body = renderTemplate(m.body, ctx);
            const missing = [...new Set([...subj.missing, ...body.missing])].filter((t) => t !== "rast_vaka_link");
            const sup = m.to_email ? isSuppressed(suppression, { email: m.to_email }) : false;
            const st = messageStatusLabel[m.status];
            return (
              <li key={m.id} className="card p-3.5">
                <div className="flex items-start gap-3">
                  {m.status === "draft" && (
                    <input type="checkbox" aria-label={`Seç: ${subj.text}`} checked={selected.has(m.id)} onChange={() => setSelected((s) => { const n = new Set(s); if (n.has(m.id)) n.delete(m.id); else n.add(m.id); return n; })} className="mt-1 h-4 w-4 accent-[var(--amber)]" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                      <Badge tone={st.tone}>{st.label}</Badge>
                      <span>{m.step_no}. adım</span>
                      <span className="truncate">→ {m.to_email ?? "alıcı yok"}</span>
                      <span className="truncate">· {v?.name ?? "…"}</span>
                      {v?.fromGoogle.includes("name") && <GoogleAttribution />}
                      {m.status === "approved" && <span>{m.scheduled_for ? `planlandı: ${dateTimeTR(m.scheduled_for)}` : "planlanmadı (gönderim kapalı)"}</span>}
                    </div>
                    <p className="mt-1 truncate text-sm font-medium text-foreground">{subj.text}</p>
                    <details className="mt-1 text-[13px]">
                      <summary className="cursor-pointer text-xs text-muted">Önizleme</summary>
                      <p className="mt-1 whitespace-pre-wrap leading-5 text-muted">{body.text}</p>
                    </details>
                    {missing.length > 0 && <p className="mt-1 text-xs text-warning">Eksik bilgi (yedek metin kullanılacak): {missing.join(", ")}</p>}
                    {sup && <p className="mt-1 text-xs text-danger">Alıcı ret listesinde — onaylanamaz.</p>}
                    {m.error && <p className="mt-1 text-xs text-danger">{m.error}</p>}
                  </div>
                  <div className="flex shrink-0 flex-col gap-1 sm:flex-row">
                    {m.status === "draft" && (
                      <>
                        <Button variant="ghost" aria-label="Düzenle" onClick={() => setEdit(m)}><Pencil className="h-4 w-4" aria-hidden /></Button>
                        <Button disabled={busy || sup || !m.to_email} onClick={() => approve([m])}><Check className="h-4 w-4" aria-hidden /> Onayla</Button>
                      </>
                    )}
                    {m.status === "approved" && (
                      <Button variant="ghost" onClick={() => useStore.getState().update("outreach_messages", m.id, { status: "draft" })}><Undo2 className="h-4 w-4" aria-hidden /> Taslağa al</Button>
                    )}
                    {m.status !== "scheduled" && (
                      <Button variant="ghost" onClick={() => useStore.getState().update("outreach_messages", m.id, { status: "cancelled" })}>İptal</Button>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {edit && <EditMessageModal message={edit} prospect={byId.get(edit.prospect_id)} onClose={() => setEdit(null)} />}
    </div>
  );
}

function EditMessageModal({ message, prospect, onClose }: { message: OutreachMessage; prospect?: Prospect; onClose: () => void }) {
  const [to, setTo] = useState(message.to_email ?? "");
  const [subject, setSubject] = useState(message.subject);
  const [body, setBody] = useState(message.body);
  const ctx = prospect ? templateContext(prospectView(prospect)) : {};

  async function submit() {
    const email = normalizeEmail(to);
    if (!email) return { ok: false, error: "Geçerli bir alıcı e-postası girin." };
    if (!subject.trim() || !body.trim()) return { ok: false, error: "Konu ve gövde zorunlu." };
    const unknown = renderTemplate(subject + body, {}).unknown;
    if (unknown.length) return { ok: false, error: `Tanınmayan belirteç: ${unknown.join(", ")}` };
    return useStore.getState().update("outreach_messages", message.id, { to_email: email, subject: subject.trim(), body: body.trim() });
  }

  return (
    <FormModal title="Taslağı düzenle" onClose={onClose} onSubmit={submit} size="lg" successMessage="Taslak güncellendi">
      <div className="grid grid-cols-1 gap-3">
        <Field label="Alıcı"><Input type="email" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        <Field label="Konu" hint="Belirteçler ({{isim}} vb.) gönderimde doldurulur."><Input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={300} /></Field>
        <Field label="Gövde"><Textarea rows={10} value={body} onChange={(e) => setBody(e.target.value)} maxLength={10000} /></Field>
        <div className="rounded-xl border border-border/70 bg-background/40 p-3 text-[13px]">
          <p className="text-xs uppercase tracking-wide text-muted">Önizleme</p>
          <p className="mt-1 font-medium text-foreground">{renderTemplate(subject, ctx).text}</p>
          <p className="mt-1 whitespace-pre-wrap leading-5 text-muted">{renderTemplate(body, ctx).text}</p>
        </div>
      </div>
    </FormModal>
  );
}
