import { createPlacesClient, MAX_SEARCH_RESULTS, PlacesApiError } from "@/lib/growth/places";
import { scoreProspect } from "@/lib/growth/score";
import { growthContext, json, limiters, rateLimited, readJson, str, unauthorized } from "@/lib/growth/server";
import type { Prospect } from "@/lib/types";

// Keşfet: Google Places (New) Text Search → aday upsert (place_id ile tekil).
// VERİ KAYNAĞI: Places içeriği (ad, adres, telefon, site, puan…) SAKLANMAZ; yanıtta yalnızca gösterim için
// döner. DB'ye yalnızca place_id, ≤30 gün lat/lng, kullanıcının sorgusu (sektör / il / ilçe) ve puan SAYISI +
// bant dökümü yazılır. GOOGLE_PLACES_API_KEY yoksa / demo modunda sahte istemci (ağ yok).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(request: Request) {
  const ctx = await growthContext(request);
  if (!ctx) return unauthorized();
  const rate = limiters.discover.check(ctx.key);
  if (!rate.ok) return rateLimited(rate.retryAfterSec);

  const body = await readJson(request);
  if (!body) return json({ ok: false, error: "JSON gövdesi bekleniyor." }, 400);
  const query = str(body.query, 80);
  const city = str(body.city, 40);
  const district = str(body.district, 40) || null;
  const maxRaw = Number(body.max ?? 20);
  const max = Number.isInteger(maxRaw) ? Math.max(1, Math.min(maxRaw, MAX_SEARCH_RESULTS)) : 20;
  if (query.length < 2) return json({ ok: false, error: "Arama ifadesi en az 2 karakter olmalı (ör. diş kliniği)." }, 400);
  if (city.length < 2) return json({ ok: false, error: "İl zorunlu (ör. Sakarya)." }, 400);

  const client = createPlacesClient(process.env, { forceMock: ctx.demo });
  let places;
  try {
    places = await client.searchText({ query, city, district, max });
  } catch (e) {
    const status = e instanceof PlacesApiError ? e.status : 0;
    console.error("[growth/discover] Places hatası:", status || (e instanceof Error ? e.name : "bilinmiyor"));
    return json({ ok: false, error: status === 403 || status === 401 ? "Places API anahtarı geçersiz ya da yetkisiz." : "Google Places'e ulaşılamadı." }, 502);
  }

  const now = new Date().toISOString();
  const rows = places.map((p) => {
    const { score, breakdown } = scoreProspect({
      sector: query, rating: p.rating, reviewsCount: p.reviewsCount, website: p.website, city, targetCity: city,
    });
    const hasLoc = typeof p.lat === "number" && typeof p.lng === "number";
    return {
      source: "places" as const,
      external_id: p.placeId,
      sector: query,
      city,
      district,
      lat: hasLoc ? p.lat! : null,
      lng: hasLoc ? p.lng! : null,
      places_cached_at: hasLoc ? now : null,
      score,
      score_breakdown: breakdown,
    };
  });

  let prospects: Prospect[] = [];
  if (ctx.demo) {
    prospects = rows.map((r) => ({ ...r, id: `demo-${r.external_id}`, status: "new", field_sources: {}, created_at: now }));
  } else if (rows.length > 0) {
    if (!ctx.orgId) return json({ ok: false, error: "Hesabınız bir organizasyona bağlı değil." }, 403);
    const { data, error } = await ctx.supabase
      .from("prospects")
      .upsert(rows.map((r) => ({ ...r, organization_id: ctx.orgId })), { onConflict: "organization_id,external_id" })
      .select("*");
    if (error) {
      console.error("[growth/discover] upsert hatası:", error.code, error.message);
      return json({ ok: false, error: "Adaylar kaydedilemedi (0019 uygulandı mı?)." }, 502);
    }
    prospects = (data ?? []) as Prospect[];
  }

  const idByPlace = new Map(prospects.map((p) => [p.external_id, p.id]));
  return json({
    ok: true,
    mode: client.kind,
    // Canlı Places verisi: yalnızca gösterim için (istemci saklamaz).
    results: places.map((p, i) => ({ place: p, prospectId: idByPlace.get(p.placeId) ?? null, score: rows[i].score, breakdown: rows[i].score_breakdown })),
    prospects,
  });
}
