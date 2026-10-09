import { after } from "next/server";
import { isSupabaseConfigured } from "@/lib/env";
import { createAnonClient } from "@/lib/supabase/anon";
import { leadNotifyConfig, sendLeadNotification } from "@/lib/lead-notify";
import { MAX_BODY_BYTES, normalizeLeadPayload, sourceLabelFor } from "@/lib/lead-logic";
import type { LeadIntake } from "@/lib/lead-logic";
import { BodyTooLargeError, clientIp, createRateLimiter, parseLeadBody, readBodyLimited, secretsMatch } from "@/lib/lead-intake";

// Web sitesi iletişim formundan (Web3Forms webhook'u / sunucudan sunucuya) gelen lead girişi.
// Oturum yok: yetki, `x-rast-lead-secret` başlığı (LEAD_WEBHOOK_SECRET) ile sağlanır; yazma işi
// anon istemciyle `lead_intake` RPC'sini (migration 0017, SECURITY DEFINER) çağırarak yapılır.
// Kod tabanında service-role deseni yok; bu yüzden RPC yolu seçildi. Ayrıntı: supabase/migrations/README-0017.md
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const limiter = createRateLimiter({ limit: 30, windowMs: 60_000 });
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const json = (body: Record<string, unknown>, status: number, headers?: Record<string, string>) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });

// Ekibe iç e-posta bildirimi (docs/lead-bildirim.md). LEAD_NOTIFY_TO + SMTP_* yoksa sessizce no-op; Müşteri Bulma'nın
// OUTREACH_EMAIL_ENABLED bayrağından bağımsızdır. `after()` ile yanıt gittikten sonra çalışır; sendLeadNotification
// asla fırlatmaz (≤5 sn zaman aşımı, yalnızca kısa console.error). Burada da try/catch: kayıt yanıtı hiçbir koşulda bozulmaz.
function notifyTeamAfterResponse(lead: LeadIntake, duplicate: boolean) {
  try {
    if (!leadNotifyConfig(process.env)) return;
    after(() => sendLeadNotification(lead, { duplicate }));
  } catch (e) {
    console.error("[leads] bildirim zamanlanamadı:", e instanceof Error ? e.name : "bilinmiyor");
  }
}

export async function POST(request: Request) {
  // 1) Hız sınırı (IP başına 30/dk) — sır denemelerini de kapsar.
  const rate = limiter.check(clientIp(request.headers));
  if (!rate.ok) {
    return json({ ok: false, error: "Çok fazla istek." }, 429, { "Retry-After": String(rate.retryAfterSec) });
  }

  // 2) Yapılandırma (fail-closed)
  const expectedSecret = process.env.LEAD_WEBHOOK_SECRET;
  const orgId = process.env.LEAD_INTAKE_ORG_ID;
  if (!expectedSecret || expectedSecret.length < 16 || !orgId || !UUID_RE.test(orgId) || !isSupabaseConfigured) {
    console.error("[leads] yapılandırma eksik: LEAD_WEBHOOK_SECRET (≥16 karakter), LEAD_INTAKE_ORG_ID (uuid) ve Supabase env gerekli.");
    return json({ ok: false, error: "Lead alımı yapılandırılmamış." }, 503);
  }

  // 3) Yetki: paylaşılan sır, sabit-zamanlı karşılaştırma
  // Tercih edilen: `x-rast-lead-secret` başlığı. Yedek: `?secret=` sorgu parametresi — yalnızca webhook
  // gönderen taraf özel başlık ekleyemiyorsa (Web3Forms dokümanında özel başlık belgelenmemiş). URL'ler
  // erişim loglarında görünebilir; bu yüzden yedek yol README-0017'de açıkça işaretlidir.
  const provided = request.headers.get("x-rast-lead-secret") ?? new URL(request.url).searchParams.get("secret");
  if (!secretsMatch(provided, expectedSecret)) return json({ ok: false, error: "Yetkisiz." }, 401);

  // 4) Gövde: en fazla 20 KB, JSON veya form
  let bytes: Uint8Array;
  try {
    bytes = await readBodyLimited(request, MAX_BODY_BYTES);
  } catch (e) {
    if (e instanceof BodyTooLargeError) return json({ ok: false, error: "Gövde en fazla 20 KB olabilir." }, 413);
    return json({ ok: false, error: "Gövde okunamadı." }, 400);
  }
  const body = await parseLeadBody(request.headers.get("content-type"), bytes);
  if (!body) return json({ ok: false, error: "JSON veya form gövdesi bekleniyor." }, 415);

  const result = normalizeLeadPayload(body);
  if (!result.ok) {
    // Bot kapanı dolu: kaydetme, ama botu bilgilendirme.
    if ("spam" in result) return json({ ok: true }, 200);
    return json({ ok: false, error: result.error }, 400);
  }
  const lead = result.value;

  // 5) RPC: tekilleştir (e-posta/telefon) → lead ekle/güncelle → arama görevi
  try {
    const { data, error } = await createAnonClient().rpc("lead_intake", {
      p_org: orgId,
      p_token: expectedSecret,
      p_payload: { ...lead, source_label: sourceLabelFor(lead.kaynak) },
    });
    if (error) {
      // Kişisel veri loglanmaz: yalnızca hata kodu ve mesajı.
      console.error("[leads] lead_intake hatası:", error.code, error.message);
      return json({ ok: false, error: "Kaydedilemedi." }, 502);
    }
    const out = (data ?? {}) as { lead_id?: string; task_id?: string; duplicate?: boolean };
    if (!out.lead_id) return json({ ok: false, error: "Kaydedilemedi." }, 502);
    // 6) Kayıt başarılı → ekibe iç bildirim (yanıt döndükten sonra; hata kaydı etkilemez).
    notifyTeamAfterResponse(lead, Boolean(out.duplicate));
    return json({ ok: true, leadId: out.lead_id, taskId: out.task_id ?? null, duplicate: Boolean(out.duplicate) }, 200);
  } catch (e) {
    console.error("[leads] bağlantı hatası:", e instanceof Error ? e.message : "bilinmiyor");
    return json({ ok: false, error: "Kaydedilemedi." }, 502);
  }
}
