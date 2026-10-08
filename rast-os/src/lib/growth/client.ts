"use client";

// Müşteri Bulma — istemci yardımcıları: API çağrıları, canlı Place Details kancası, sunucu durumu ve
// store üzerinden yapılan eylemler (manuel temas kaydı, yanıt → CRM lead + arama görevi, ret, erteleme,
// diziye ekleme, onay, CSV içe aktarma, zenginleştirme yamaları).
//
// VERİ KAYNAĞI: canlı Places verisi yalnızca bileşen durumunda (useState) tutulur — store / localStorage /
// DB'ye yazılmaz; bileşen kapanınca gider. Bkz. supabase/migrations/README-0019.md.
import { useEffect, useMemo, useRef, useState } from "react";
import { useStore, uid, nowISO } from "@/lib/store";
import type { MutationResult } from "@/lib/store";
import { callTaskTitle } from "@/lib/lead-logic";
import {
  addDays, approvalPatch, clinicCsvToProspects, firstStepDraft, istanbulDay, manualContactRecord, normalizeEmail,
  phoneKey, snoozePatch,
} from "./logic";
import type { LivePlace } from "./logic";
import type { Lead, OutreachChannel, OutreachMessage, OutreachSequence, Prospect, Task } from "@/lib/types";
import { HEDEF_KLINIKLER_CSV } from "./hedef-klinikler";

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

export async function apiPost<T>(url: string, body: unknown): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = (await res.json().catch(() => ({}))) as T & { ok?: boolean; error?: string };
    if (!res.ok || data.ok === false) return { ok: false, error: data.error || `İstek başarısız (${res.status})` };
    return { ok: true, data };
  } catch {
    return { ok: false, error: "Sunucuya ulaşılamadı." };
  }
}

export interface GrowthStatus {
  demo: boolean;
  places: "google" | "mock";
  emailEnabled: boolean;
  smtpConfigured: boolean;
  cronConfigured: boolean;
  dailyCap: number;
}

const FALLBACK_STATUS: GrowthStatus = { demo: true, places: "mock", emailEnabled: false, smtpConfigured: false, cronConfigured: false, dailyCap: 20 };
let statusPromise: Promise<GrowthStatus> | null = null;

/** Sunucu yapılandırması (e-posta bayrağı, günlük limit…). Ulaşılamazsa güvenli varsayılan: e-posta KAPALI. */
export function useGrowthStatus(): GrowthStatus | null {
  const [status, setStatus] = useState<GrowthStatus | null>(null);
  useEffect(() => {
    statusPromise ??= fetch("/api/growth/status", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : FALLBACK_STATUS))
      .then((d) => ({ ...FALLBACK_STATUS, ...d }) as GrowthStatus)
      .catch(() => FALLBACK_STATUS);
    let alive = true;
    statusPromise.then((s) => alive && setStatus(s));
    return () => {
      alive = false;
    };
  }, []);
  return status;
}

/**
 * Canlı Place Details: verilen place_id'ler için 20'lik partilerle çeker. Sonuç YALNIZCA bu bileşenin
 * durumunda tutulur (kalıcı önbellek yok). level=basic (ad/adres) ucuz; contact (telefon/site) yalnızca kartlarda.
 */
export function usePlaceDetails(placeIds: (string | null | undefined)[], level: "basic" | "contact" = "basic") {
  const key = useMemo(() => [...new Set(placeIds.filter((x): x is string => Boolean(x)))].sort().join("|"), [placeIds]);
  const [details, setDetails] = useState<Record<string, LivePlace>>({});
  const [loading, setLoading] = useState(false);
  const requested = useRef(new Set<string>());

  useEffect(() => {
    const ids = key ? key.split("|").filter((id) => !requested.current.has(id)) : [];
    if (ids.length === 0) return;
    ids.forEach((id) => requested.current.add(id));
    let alive = true;
    setLoading(true);
    (async () => {
      for (let i = 0; i < ids.length; i += 20) {
        const r = await apiPost<{ details: Record<string, LivePlace> }>("/api/growth/places", { ids: ids.slice(i, i + 20), level });
        if (!alive) return;
        if (r.ok) setDetails((d) => ({ ...d, ...r.data.details }));
      }
      if (alive) setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [key, level]);

  return { details, loading };
}

// ---------------------------------------------------------------------------
// Eylemler (store: Supabase'de RLS + 0019 guard'ı; demo'da bellek içi)
// ---------------------------------------------------------------------------

const store = () => useStore.getState();
const fail = (r: MutationResult[]) => r.find((x) => !x.ok);

/** "Aradım / WhatsApp attım / DM attım": manuel temas kaydı + aday durumu (DB'de trigger da yazar). */
export async function logManualContact(p: Prospect, channel: Exclude<OutreachChannel, "email">, template?: string): Promise<MutationResult> {
  const now = Date.now();
  const rec = manualContactRecord(p.id, channel, { id: uid(), now, template });
  const r = await store().add("outreach_messages", rec);
  if (!r.ok) return r;
  // Yerel görünüm (DB'de outreach_messages_touch_prospect aynı şeyi yapar; burada yalnızca store güncellenir).
  const patch: Partial<Prospect> = { last_contacted_at: rec.sent_at };
  if (p.status === "new" || p.status === "qualified" || p.status === "queued") patch.status = "contacted";
  store().mergeLocal("prospects", [{ ...p, ...patch }]);
  return { ok: true };
}

/** Yanlış girilen manuel temas kaydını geri al. */
export function undoManualContact(messageId: string) {
  return store().remove("outreach_messages", messageId);
}

export function snoozeProspect(p: Prospect) {
  return store().update("prospects", p.id, snoozePatch(Date.now()));
}

/** "İlgilenmiyor": aday bastırılır; saklanan (bizim) e-posta / telefon ret listesine eklenir. */
export async function markNotInterested(p: Prospect, note = "İlgilenmiyor"): Promise<MutationResult> {
  const s = store();
  const results: MutationResult[] = [await s.update("prospects", p.id, { status: "suppressed", next_action_at: null })];
  const existing = s.suppression_list;
  const email = normalizeEmail(p.email);
  if (email && !existing.some((e) => e.kind === "email" && e.value === email)) {
    results.push(await s.add("suppression_list", { id: uid(), kind: "email", value: email, reason: "manual", note, created_at: nowISO() }));
  }
  const ph = p.phone ? phoneKey(p.phone) : null;
  if (ph && /^[0-9]{7,10}$/.test(ph) && !existing.some((e) => e.kind === "phone" && e.value === ph)) {
    results.push(await s.add("suppression_list", { id: uid(), kind: "phone", value: ph, reason: "manual", note, created_at: nowISO() }));
  }
  // Bekleyen e-posta taslakları / onaylılar iptal
  for (const m of s.outreach_messages.filter((m) => m.prospect_id === p.id && (m.status === "draft" || m.status === "approved"))) {
    results.push(await s.update("outreach_messages", m.id, { status: "cancelled", error: "Aday ilgilenmiyor" }));
  }
  return fail(results) ?? { ok: true };
}

export interface ReplyLeadForm {
  company_name: string;
  phone: string;
  email: string;
  instagram: string;
  website: string;
  source: string;
  interested_in: string;
  next_followup_at: string;
  notes: string;
}

/**
 * "Yanıt geldi": kullanıcının onayladığı formdan CRM lead'i + "Lead'i 24 saat içinde ara" görevi (lead-logic ile
 * aynı başlık); aday → replied + lead_id; son gönderilmiş e-posta → replied.
 */
export async function markReplied(p: Prospect, form: ReplyLeadForm): Promise<MutationResult & { leadId?: string }> {
  const s = store();
  const name = form.company_name.trim();
  if (!name) return { ok: false, error: "Firma adı zorunludur." };
  const today = istanbulDay(Date.now());
  const leadId = uid();
  const lead: Lead = {
    id: leadId,
    company_name: name,
    phone: form.phone.trim() || undefined,
    email: normalizeEmail(form.email) ?? undefined,
    instagram: form.instagram.trim() || undefined,
    website: form.website.trim() || undefined,
    source: form.source,
    interested_in: form.interested_in || undefined,
    notes: form.notes.trim() || undefined,
    status: "contacted",
    next_followup_at: form.next_followup_at || addDays(today, 1),
    created_at: nowISO(),
  };
  const lr = await s.add("leads", lead);
  if (!lr.ok) return lr;
  const task: Task = {
    id: uid(), lead_id: leadId, title: callTaskTitle(name), due_date: addDays(today, 1), priority: "high", status: "todo", created_at: nowISO(),
  };
  const results: MutationResult[] = [await s.add("tasks", task), await s.update("prospects", p.id, { status: "replied", lead_id: leadId, next_action_at: null })];
  const lastEmail = s.outreach_messages
    .filter((m) => m.prospect_id === p.id && m.channel === "email" && m.status === "sent")
    .sort((a, b) => (b.sent_at ?? "").localeCompare(a.sent_at ?? ""))[0];
  if (lastEmail) results.push(await s.update("outreach_messages", lastEmail.id, { status: "replied" }));
  for (const m of s.outreach_messages.filter((m) => m.prospect_id === p.id && (m.status === "draft" || m.status === "approved"))) {
    results.push(await s.update("outreach_messages", m.id, { status: "cancelled", error: "Aday yanıt verdi" }));
  }
  return { ...(fail(results) ?? { ok: true }), leadId };
}

export async function setProspectStatus(ids: string[], status: Prospect["status"]): Promise<MutationResult> {
  const results = await Promise.all(ids.map((id) => store().update("prospects", id, { status })));
  return fail(results) ?? { ok: true };
}

/** "Diziye ekle": e-postası olan her aday için 1. adım ŞABLON taslağı; aday → queued. */
export async function addToSequence(seq: OutreachSequence, prospects: Prospect[]): Promise<{ created: number; noEmail: number; skipped: number; error?: string }> {
  const s = store();
  let created = 0, noEmail = 0, skipped = 0;
  for (const p of prospects) {
    if (p.status === "suppressed" || p.status === "replied" || p.status === "converted") {
      skipped++;
      continue;
    }
    const exists = s.outreach_messages.some((m) => m.prospect_id === p.id && m.sequence_id === seq.id && m.step_no === 1 && m.status !== "cancelled");
    if (exists) {
      skipped++;
      continue;
    }
    const draft = firstStepDraft(seq, p, { id: uid(), now: Date.now() });
    if (!draft) {
      noEmail++;
      continue;
    }
    const r = await s.add("outreach_messages", draft);
    if (!r.ok) return { created, noEmail, skipped, error: r.error };
    created++;
    if (p.status === "new" || p.status === "qualified") await s.update("prospects", p.id, { status: "queued" });
  }
  return { created, noEmail, skipped };
}

/** Onay: bayrak kapalıyken yalnızca 'approved' (scheduled_for boş); açıkken planlanır. */
export async function approveMessages(msgs: OutreachMessage[], emailEnabled: boolean): Promise<MutationResult> {
  const results = await Promise.all(
    msgs.filter((m) => m.status === "draft").map((m) => store().update("outreach_messages", m.id, approvalPatch(m, { emailEnabled, now: Date.now() }))),
  );
  return fail(results) ?? { ok: true };
}

/** Bayrak açıldıktan sonra: daha önce planlanmadan onaylanmış mesajları planla (taslağa al → yeniden onayla). */
export async function scheduleApproved(msgs: OutreachMessage[]): Promise<MutationResult> {
  const results: MutationResult[] = [];
  for (const m of msgs.filter((x) => x.status === "approved" && !x.scheduled_for)) {
    const back = await store().update("outreach_messages", m.id, { status: "draft" });
    results.push(back.ok ? await store().update("outreach_messages", m.id, approvalPatch(m, { emailEnabled: true, now: Date.now() })) : back);
  }
  return fail(results) ?? { ok: true };
}

/** Hedef klinik listesi (18, elle araştırılmış CSV) → adaylar, doğrudan `qualified`. Var olanlar atlanır. */
export async function importTargetClinics(text = HEDEF_KLINIKLER_CSV): Promise<{ added: number; skipped: number; error?: string }> {
  const s = store();
  const have = new Set(s.prospects.map((p) => p.external_id).filter(Boolean));
  let added = 0, skipped = 0;
  for (const d of clinicCsvToProspects(text)) {
    if (d.external_id && have.has(d.external_id)) {
      skipped++;
      continue;
    }
    const r = await s.add("prospects", { ...d, id: uid(), created_at: nowISO() });
    if (!r.ok) return { added, skipped, error: r.error };
    added++;
  }
  return { added, skipped };
}

/** Keşif sonuçlarını yerel listeye ekler (Supabase'de sunucu zaten yazdı; demo'da place_id ile tekilleştirilir). */
export function mergeDiscovered(rows: Prospect[]) {
  const s = store();
  const byExt = new Map(s.prospects.filter((p) => p.external_id).map((p) => [p.external_id!, p]));
  const merged = rows.map((r) => {
    const cur = r.external_id ? byExt.get(r.external_id) : undefined;
    return cur ? { ...cur, score: r.score, score_breakdown: r.score_breakdown, lat: r.lat, lng: r.lng, places_cached_at: r.places_cached_at } : r;
  });
  s.mergeLocal("prospects", merged);
  return merged;
}

export async function applyEnrichment(results: { id: string; patch: Partial<Prospect> }[]): Promise<MutationResult> {
  const r = await Promise.all(results.map((x) => store().update("prospects", x.id, x.patch)));
  return fail(r) ?? { ok: true };
}

/** Zenginleştirme isteği gövdesi (yalnızca saklanan alanlar gider; site Places adayında sunucuda canlı alınır). */
export function enrichPayload(p: Prospect) {
  return {
    id: p.id, source: p.source, external_id: p.external_id, website: p.website, sector: p.sector, city: p.city,
    email: p.email, instagram: p.instagram, phone: p.phone, field_sources: p.field_sources ?? {},
  };
}

/** Seçili adayların sitelerini tara (10'luk partiler) ve bulunanları kaydet. */
export async function enrichProspects(prospects: Prospect[]): Promise<{ updated: number; emails: number; error?: string }> {
  let updated = 0, emails = 0;
  for (let i = 0; i < prospects.length; i += 10) {
    const batch = prospects.slice(i, i + 10);
    const r = await apiPost<{ results: { id: string; patch: Partial<Prospect> }[] }>("/api/growth/enrich", { items: batch.map(enrichPayload) });
    if (!r.ok) return { updated, emails, error: r.error };
    const a = await applyEnrichment(r.data.results);
    if (!a.ok) return { updated, emails, error: a.error };
    updated += r.data.results.length;
    emails += r.data.results.filter((x) => x.patch.email).length;
  }
  return { updated, emails };
}
