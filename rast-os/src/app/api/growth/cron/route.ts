import { isSupabaseConfigured } from "@/lib/env";
import { secretsMatch } from "@/lib/lead-intake";
import { cronEmailDecision, nextStepDraft, parseDailyCap, renderTemplate, templateContext } from "@/lib/growth/logic";
import { addressOf, buildOutgoingEmail, createMailerFromEnv } from "@/lib/growth/mailer";
import { createPlacesClient } from "@/lib/growth/places";
import type { PlaceSummary } from "@/lib/growth/places";
import { isUnsubTokenShape } from "@/lib/growth/unsubscribe";
import { createAnonClient } from "@/lib/supabase/anon";
import type { SequenceStep } from "@/lib/types";

// Saatlik Vercel Cron (vercel.json): Authorization: Bearer <CRON_SECRET>.
//  1) Her çalışmada: 30 günü geçen Places lat/lng'yi siler (outreach_places_purge).
//  2) E-posta YALNIZCA OUTREACH_EMAIL_ENABLED=true iken (varsayılan KAPALI — İYS kaydı bekleniyor): SMTP
//     yapılandırılmış ve hafta içi 09-18 ise, onaylı + vadesi gelmiş mesajları günlük limit (DAILY_SEND_CAP) ve
//     ret listesine uyarak gönderir; gönderilen her adımın ardından sonraki adımı TASLAK açar (insan onaylar).
//     Bayrak kapalıyken e-posta RPC'leri HİÇ çağrılmaz.
// Yazma işi anon istemci + CRON_SECRET doğrulayan SECURITY DEFINER RPC'lerle (0019) yapılır (0017 deseni).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const BATCH_LIMIT = 25;

interface Claimed {
  id: string;
  step_no: number;
  to_email: string;
  subject: string;
  body: string;
  unsub_token: string;
  steps: SequenceStep[] | null;
  prospect: { name: string | null; sector: string | null; city: string | null; district: string | null; website: string | null; source: string; external_id: string | null } | null;
}

const json = (body: Record<string, unknown>, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

function baseUrl(request: Request): string {
  const env = process.env;
  if (env.APP_BASE_URL && /^https?:\/\//.test(env.APP_BASE_URL)) return env.APP_BASE_URL.replace(/\/+$/, "");
  if (env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${env.VERCEL_PROJECT_PRODUCTION_URL}`;
  return new URL(request.url).origin;
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET ?? "";
  if (secret.length < 16 || !isSupabaseConfigured) {
    console.error("[growth/cron] yapılandırma eksik: CRON_SECRET (≥16 karakter) ve Supabase env gerekli.");
    return json({ ok: false, error: "Cron yapılandırılmamış." }, 503);
  }
  const auth = request.headers.get("authorization") ?? "";
  const provided = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!secretsMatch(provided, secret)) return json({ ok: false, error: "Yetkisiz." }, 401);

  const sb = createAnonClient();

  // 1) Places lat/lng temizliği (Google Maps Platform Şartları: ≤30 gün)
  let purged: number | null = null;
  const purge = await sb.rpc("outreach_places_purge", { p_token: secret });
  if (purge.error) console.error("[growth/cron] purge hatası:", purge.error.code);
  else purged = Number(purge.data ?? 0);

  // 2) E-posta — bayrak kapalıysa burada biter (hiçbir mesaj talep edilmez / gönderilmez).
  const mailer = createMailerFromEnv(process.env);
  const now = new Date();
  const decision = cronEmailDecision({ env: process.env, mailerKind: mailer.kind, now });
  if (decision !== "send") return json({ ok: true, email: decision, purged });

  const cap = parseDailyCap(process.env.DAILY_SEND_CAP);
  const claim = await sb.rpc("outreach_cron_claim", { p_token: secret, p_cap: cap, p_limit: BATCH_LIMIT });
  if (claim.error) {
    console.error("[growth/cron] claim hatası:", claim.error.code);
    return json({ ok: false, error: "Mesajlar alınamadı.", purged }, 502);
  }
  const messages = ((claim.data as { messages?: Claimed[] } | null)?.messages ?? []).filter((m) => isUnsubTokenShape(m.unsub_token));

  // Places adaylarının adı saklanmaz → gönderim anında canlı Place Details (yalnızca bu istek boyunca bellekte).
  const placeIds = [...new Set(messages.filter((m) => m.prospect?.source === "places" && !m.prospect.name && m.prospect.external_id).map((m) => m.prospect!.external_id!))];
  let live: Record<string, PlaceSummary> = {};
  if (placeIds.length) {
    try {
      const client = createPlacesClient(process.env);
      for (let i = 0; i < placeIds.length; i += 20) Object.assign(live, await client.details(placeIds.slice(i, i + 20), "basic"));
    } catch {
      live = {};
    }
  }

  const from = (process.env.SMTP_FROM ?? "").trim();
  const base = baseUrl(request);
  let sent = 0, failed = 0;
  for (const m of messages) {
    const p = m.prospect;
    const lp = p?.external_id ? live[p.external_id] : undefined;
    const ctx = templateContext({ name: p?.name ?? lp?.name, sector: p?.sector, city: p?.city, district: p?.district, website: p?.website ?? lp?.website });
    const mail = buildOutgoingEmail({
      to: m.to_email,
      subject: renderTemplate(m.subject, ctx).text,
      body: renderTemplate(m.body, ctx).text,
      unsubscribeUrl: `${base}/api/growth/unsubscribe?t=${encodeURIComponent(m.unsub_token)}`,
      from,
      unsubscribeMailto: addressOf(from),
    });
    const r = await mailer.send(mail);
    const next = r.ok ? nextStepDraft(m.steps, m.step_no, now) : null;
    const res = await sb.rpc("outreach_cron_result", {
      p_token: secret,
      p_message_id: m.id,
      p_result: r.ok ? "sent" : r.permanent ? "bounced" : "retry",
      p_provider_id: r.ok ? r.messageId.slice(0, 300) : null,
      p_error: r.ok ? null : r.error,
      p_next: next,
    });
    if (res.error) console.error("[growth/cron] sonuç yazılamadı:", res.error.code);
    if (r.ok) sent++;
    else failed++;
  }
  return json({ ok: true, email: "enabled", claimed: messages.length, sent, failed, cap, purged });
}
