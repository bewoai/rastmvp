import { createPlacesClient, isPlaceId, MAX_DETAILS_PER_REQUEST } from "@/lib/growth/places";
import type { DetailsLevel } from "@/lib/growth/places";
import { growthContext, json, limiters, rateLimited, readJson, unauthorized } from "@/lib/growth/server";

// Canlı Place Details (liste / kart gösterimi). Yanıt önbelleğe ALINMAZ (Cache-Control: no-store) ve
// hiçbir yere yazılmaz; aynı istekteki tekrar eden kimlikler bir kez çekilir (istek içi bellek).
// level=basic → ad + adres + Maps (Pro SKU) · level=contact → + telefon, site, puan (Enterprise SKU).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const ctx = await growthContext(request);
  if (!ctx) return unauthorized();
  const rate = limiters.places.check(ctx.key);
  if (!rate.ok) return rateLimited(rate.retryAfterSec);

  const body = await readJson(request);
  const ids = Array.isArray(body?.ids) ? [...new Set((body!.ids as unknown[]).filter(isPlaceId))] : [];
  const level: DetailsLevel = body?.level === "contact" ? "contact" : "basic";
  if (ids.length === 0) return json({ ok: true, details: {} });
  if (ids.length > MAX_DETAILS_PER_REQUEST) return json({ ok: false, error: `En fazla ${MAX_DETAILS_PER_REQUEST} kimlik.` }, 400);

  const client = createPlacesClient(process.env, { forceMock: ctx.demo });
  try {
    const details = await client.details(ids, level);
    return json({ ok: true, mode: client.kind, details });
  } catch (e) {
    console.error("[growth/places] Places hatası:", e instanceof Error ? e.name : "bilinmiyor");
    return json({ ok: false, error: "Google Places'e ulaşılamadı." }, 502);
  }
}
