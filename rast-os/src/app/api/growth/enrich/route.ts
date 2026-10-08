import { enrichWebsite, isNeverFetchHost } from "@/lib/growth/enrich";
import type { EnrichResult } from "@/lib/growth/enrich";
import { createHttpFetcher, createMockFetcher } from "@/lib/growth/fetcher";
import { normalizeEmail, normalizeInstagram } from "@/lib/growth/logic";
import { createPlacesClient, isPlaceId } from "@/lib/growth/places";
import type { PlaceSummary } from "@/lib/growth/places";
import { scoreProspect } from "@/lib/growth/score";
import { growthContext, json, limiters, rateLimited, readJson, str, unauthorized } from "@/lib/growth/server";
import type { Prospect } from "@/lib/types";

// Zenginleştirme: işletmenin KENDİ sitesinden (ana sayfa + /iletisim + /contact) e-posta, Instagram ve telefon.
// robots.txt'e uyulur; 8 sn zaman aşımı, en fazla 300 KB, ≤2 yönlendirme, yalnızca http(s), özel IP yok;
// Instagram / Facebook asla çekilmez. Places adayının sitesi kaydedilmez: canlı Place Details'ten alınır.
// Yanıt yalnızca SAKLANABİLİR yamayı (siteden bulunan alanlar + köken etiketi + puan) döndürür; istemci yazar.
// Demo modunda gerçek sitelere istek atılmaz (sahte çekici).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_ITEMS = 10;

type Item = Pick<Prospect, "id" | "source" | "external_id" | "website" | "sector" | "city" | "email" | "instagram" | "phone" | "field_sources">;

function parseItem(raw: unknown): Item | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = str(r.id, 80);
  const source = r.source === "places" || r.source === "csv" || r.source === "manuel" ? r.source : null;
  if (!id || !source) return null;
  const website = str(r.website, 500);
  return {
    id,
    source,
    external_id: isPlaceId(r.external_id) ? r.external_id : null,
    website: /^https?:\/\//i.test(website) ? website : null,
    sector: str(r.sector, 120) || null,
    city: str(r.city, 80) || null,
    email: normalizeEmail(r.email),
    instagram: normalizeInstagram(typeof r.instagram === "string" ? r.instagram : null),
    phone: str(r.phone, 40) || null,
    field_sources: r.field_sources && typeof r.field_sources === "object" ? (r.field_sources as Item["field_sources"]) : {},
  };
}

export async function POST(request: Request) {
  const ctx = await growthContext(request);
  if (!ctx) return unauthorized();
  const rate = limiters.enrich.check(ctx.key);
  if (!rate.ok) return rateLimited(rate.retryAfterSec);

  const body = await readJson(request);
  const items = (Array.isArray(body?.items) ? (body!.items as unknown[]) : []).map(parseItem).filter((x): x is Item => x !== null);
  if (items.length === 0) return json({ ok: false, error: "Zenginleştirilecek aday yok." }, 400);
  if (items.length > MAX_ITEMS) return json({ ok: false, error: `Tek seferde en fazla ${MAX_ITEMS} aday.` }, 400);

  // Places adayları: site + puan için canlı Place Details (saklanmaz).
  const placeIds = items.filter((i) => i.source === "places" && i.external_id).map((i) => i.external_id!);
  let live: Record<string, PlaceSummary> = {};
  if (placeIds.length) {
    try {
      live = await createPlacesClient(process.env, { forceMock: ctx.demo }).details(placeIds, "contact");
    } catch {
      live = {};
    }
  }

  const fetchText = ctx.demo ? createMockFetcher() : createHttpFetcher({ isBlockedHost: isNeverFetchHost });
  const results = [];
  for (const item of items) {
    const lp = item.external_id ? live[item.external_id] : undefined;
    const website = item.website ?? lp?.website ?? null;
    let found: EnrichResult | null = null;
    if (website) found = await enrichWebsite(website, fetchText);

    const fs: NonNullable<Prospect["field_sources"]> = { ...(item.field_sources ?? {}) };
    const patch: Partial<Prospect> = {};
    const email = item.email ?? normalizeEmail(found?.emails[0]);
    if (!item.email && email) {
      patch.email = email;
      fs.email = "website";
    }
    const instagram = item.instagram ?? normalizeInstagram(found?.instagram[0]);
    if (!item.instagram && instagram) {
      patch.instagram = instagram;
      fs.instagram = "website";
    }
    if (!item.phone && found?.phones[0]) {
      patch.phone = found.phones[0];
      fs.phone = "website";
    }
    const { score, breakdown } = scoreProspect({
      sector: item.sector, rating: lp?.rating, reviewsCount: lp?.reviewsCount, website, site: found?.signals ?? null,
      instagram, email, city: item.city,
    });
    patch.field_sources = fs;
    patch.score = score;
    patch.score_breakdown = breakdown;
    results.push({
      id: item.id,
      patch,
      found: found ? { emails: found.emails, instagram: found.instagram, phones: found.phones, fetched: found.fetched, skipped: found.skipped } : null,
      note: website ? null : "Web sitesi yok",
    });
  }
  return json({ ok: true, results });
}
