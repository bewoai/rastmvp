"use client";

import { useMemo } from "react";
import { Field, FormModal, Input, MoreFields, Select, Textarea, useFormState } from "@/components/form";
import { Badge } from "@/components/ui";
import { useStore } from "@/lib/store";
import { useToasts } from "@/lib/toast";
import { useNowMs } from "@/lib/useNowMs";
import { dateTimeTR } from "@/lib/labels";
import { markReplied } from "@/lib/growth/client";
import type { ReplyLeadForm } from "@/lib/growth/client";
import {
  istanbulDay, normalizeEmail, normalizeInstagram, prospectToLeadDraft, prospectView, renderTemplate, templateContext,
} from "@/lib/growth/logic";
import type { LivePlace } from "@/lib/growth/logic";
import type { OutreachChannel, Prospect } from "@/lib/types";
import {
  GoogleAttribution, PROSPECT_STATUSES, ScoreBadge, channelLabel, messageStatusLabel, prospectStatusLabel, sourceLabel,
} from "./GrowthChrome";

/** "Yanıt geldi": CRM lead formu (canlı / saklanan verilerle önceden doldurulur, kullanıcı onaylar). */
export function ReplyLeadModal({ prospect, live, channel, onClose }: { prospect: Prospect; live?: LivePlace | null; channel: OutreachChannel | null; onClose: () => void }) {
  const view = prospectView(prospect, live);
  const nowMs = useNowMs();
  const draft = prospectToLeadDraft(view, channel, istanbulDay(nowMs));
  const f = useFormState<ReplyLeadForm>({ ...draft, notes: prospect.notes ?? "" });

  return (
    <FormModal
      title="Yanıt geldi → CRM lead"
      onClose={onClose}
      submitLabel="Lead ve arama görevi oluştur"
      successMessage="Lead oluşturuldu; yarına arama görevi eklendi"
      onSubmit={() => markReplied(prospect, f.form)}
    >
      <p className="mb-3 text-sm text-muted">
        Aday <strong className="text-foreground">yanıt verdi</strong> olarak işaretlenir; CRM&apos;de lead ve &quot;Lead&apos;i 24 saat içinde ara&quot; görevi açılır,
        bekleyen e-posta taslakları iptal edilir. Alanları kontrol edin — kaydedilen bilgiler sizin onayladıklarınızdır.
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2"><Field label="Firma adı *"><Input {...f.text("company_name")} autoComplete="off" /></Field></div>
        <Field label="Telefon"><Input type="tel" inputMode="tel" {...f.text("phone")} /></Field>
        <Field label="E-posta"><Input type="email" inputMode="email" {...f.text("email")} /></Field>
        <Field label="Sonraki takip"><Input type="date" {...f.text("next_followup_at")} /></Field>
        <Field label="Kaynak"><Input {...f.text("source")} /></Field>
        <MoreFields label="Ek alanlar">
          <Field label="Instagram"><Input {...f.text("instagram")} /></Field>
          <Field label="Web sitesi"><Input {...f.text("website")} /></Field>
          <Field label="İlgilendiği hizmet"><Input {...f.text("interested_in")} /></Field>
          <div className="sm:col-span-2"><Field label="Not"><Textarea {...f.text("notes")} placeholder="Ne dedi? Hangi hizmetle ilgilendi?" /></Field></div>
        </MoreFields>
      </div>
      {view.fromGoogle.length > 0 && <GoogleAttribution className="mt-3" />}
    </FormModal>
  );
}

interface DetailForm {
  name: string;
  phone: string;
  email: string;
  instagram: string;
  website: string;
  notes: string;
  next_action_at: string;
  status: Prospect["status"];
}

/** Aday ayrıntısı: temas geçmişi (tüm kanallar), notlar, sonraki eylem tarihi, elle düzeltilen iletişim bilgileri. */
export function ProspectDetailModal({ prospect, live, onClose }: { prospect: Prospect; live?: LivePlace | null; onClose: () => void }) {
  const messages = useStore((s) => s.outreach_messages);
  const view = prospectView(prospect, live);
  const f = useFormState<DetailForm>({
    name: prospect.name ?? "",
    phone: prospect.phone ?? "",
    email: prospect.email ?? "",
    instagram: prospect.instagram ?? "",
    website: prospect.website ?? "",
    notes: prospect.notes ?? "",
    next_action_at: prospect.next_action_at?.slice(0, 10) ?? "",
    status: prospect.status,
  });

  const timeline = useMemo(
    () => messages
      .filter((m) => m.prospect_id === prospect.id)
      .sort((a, b) => (b.sent_at ?? b.created_at).localeCompare(a.sent_at ?? a.created_at)),
    [messages, prospect.id],
  );
  const ctx = templateContext(view);

  async function submit() {
    const { form } = f;
    const fs = { ...(prospect.field_sources ?? {}) };
    const patch: Partial<Prospect> = { notes: form.notes.trim() || null, next_action_at: form.next_action_at || null, status: form.status };
    const setField = (key: "name" | "phone" | "email" | "instagram" | "website", value: string | null) => {
      const cur = prospect[key] ?? null;
      if ((value ?? null) === cur) return;
      patch[key] = value;
      if (value) fs[key] = "manual";
      else delete fs[key];
    };
    const email = form.email.trim() ? normalizeEmail(form.email) : null;
    if (form.email.trim() && !email) return { ok: false, error: "E-posta geçersiz." };
    const ig = form.instagram.trim() ? normalizeInstagram(form.instagram) : null;
    if (form.instagram.trim() && !ig) return { ok: false, error: "Instagram kullanıcı adı geçersiz." };
    const web = form.website.trim();
    if (web && !/^https?:\/\//i.test(web)) return { ok: false, error: "Web sitesi http:// veya https:// ile başlamalı." };
    if (prospect.source !== "places" && !form.name.trim()) return { ok: false, error: "Ad zorunludur." };
    setField("name", form.name.trim() || null);
    setField("phone", form.phone.trim() || null);
    setField("email", email);
    setField("instagram", ig);
    setField("website", web || null);
    patch.field_sources = fs;
    const r = await useStore.getState().update("prospects", prospect.id, patch);
    if (!r.ok) useToasts.getState().push({ message: `Kaydedilemedi: ${r.error ?? ""}`, tone: "danger" });
    return r;
  }

  return (
    <FormModal title={view.name ?? "Aday"} onClose={onClose} onSubmit={submit} size="lg" successMessage="Aday güncellendi">
      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-muted">
        <Badge tone={prospectStatusLabel[prospect.status].tone}>{prospectStatusLabel[prospect.status].label}</Badge>
        <ScoreBadge score={prospect.score} breakdown={prospect.score_breakdown} />
        <span>{sourceLabel[prospect.source]} · {prospect.sector ?? "—"} · {[view.district, view.city].filter(Boolean).join(" / ") || "—"}</span>
        {view.address && <span>· {view.address}</span>}
        {view.fromGoogle.length > 0 && <GoogleAttribution />}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_1fr]">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field label={prospect.source === "places" ? "Ad (elle; boşsa Google'dan canlı)" : "Ad *"}>
              <Input {...f.text("name")} placeholder={prospect.source === "places" ? view.name ?? "" : ""} />
            </Field>
          </div>
          <Field label="Durum">
            <Select {...f.text("status")}>
              {PROSPECT_STATUSES.map((s) => <option key={s} value={s}>{prospectStatusLabel[s].label}</option>)}
            </Select>
          </Field>
          <Field label="Sonraki eylem tarihi"><Input type="date" {...f.text("next_action_at")} /></Field>
          <Field label="Telefon" hint={prospect.field_sources?.phone ? `Kaynak: ${prospect.field_sources.phone === "website" ? "işletmenin sitesi" : prospect.field_sources.phone === "csv" ? "CSV" : "elle"}` : view.phone ? "Google'dan canlı (saklanmaz)" : undefined}>
            <Input type="tel" inputMode="tel" {...f.text("phone")} placeholder={view.phone ?? ""} />
          </Field>
          <Field label="E-posta" hint={prospect.field_sources?.email === "website" ? "Kaynak: işletmenin sitesi" : undefined}>
            <Input type="email" inputMode="email" {...f.text("email")} />
          </Field>
          <Field label="Instagram"><Input {...f.text("instagram")} placeholder="kullaniciadi" /></Field>
          <Field label="Web sitesi"><Input {...f.text("website")} placeholder={view.website ?? "https://"} /></Field>
          <div className="sm:col-span-2"><Field label="Notlar"><Textarea rows={4} {...f.text("notes")} /></Field></div>
        </div>

        <section aria-label="Temas geçmişi">
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">Temas geçmişi</h3>
          {timeline.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border/80 px-3 py-6 text-center text-xs text-muted">Henüz temas yok.</p>
          ) : (
            <ol className="relative space-y-3 border-l border-border/80 pl-4">
              {timeline.map((m) => {
                const st = m.manual && m.status === "sent" ? { label: "Yapıldı", tone: "default" as const } : messageStatusLabel[m.status];
                return (
                  <li key={m.id} className="text-sm">
                    <span className="absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full bg-amber/70" aria-hidden />
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-foreground">{channelLabel[m.channel]}</span>
                      <Badge tone={st.tone}>{st.label}</Badge>
                      <span className="text-xs text-muted">{dateTimeTR(m.sent_at ?? m.scheduled_for ?? m.created_at)}</span>
                    </div>
                    <p className="mt-0.5 text-xs text-muted">
                      {m.channel === "email" ? `${m.step_no}. adım · ${renderTemplate(m.subject, ctx).text}` : m.subject}
                    </p>
                    {m.error && <p className="text-xs text-danger">{m.error}</p>}
                  </li>
                );
              })}
            </ol>
          )}
        </section>
      </div>
    </FormModal>
  );
}
