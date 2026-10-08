// Müşteri Bulma — Google Places API (New) istemcisi + sahte (mock) istemci. YALNIZCA SUNUCU.
//
// VERİ KAYNAĞI (Google Maps Platform Şartları 3.2.3(a)): bu modülün döndürdüğü içerik (ad, adres, telefon,
// site, puan, yorum sayısı, Maps bağlantısı) SAKLANMAZ; yalnızca istek boyunca bellekte tutulur. Saklanabilen:
// place_id (süresiz) ve lat/lng (≤30 gün). Bkz. supabase/migrations/README-0019.md "Veri kaynağı".
//
// Anahtar (GOOGLE_PLACES_API_KEY) yoksa, demo modunda ve testlerde MockPlacesClient kullanılır (ağ erişimi yok).
// Not: yalnızca `import type` (type-stripping ile test edilir).

export interface PlaceSummary {
  placeId: string;
  name?: string;
  address?: string;
  phone?: string;
  website?: string;
  rating?: number;
  reviewsCount?: number;
  mapsUrl?: string;
  lat?: number;
  lng?: number;
}

export interface TextSearchQuery {
  query: string;
  city: string;
  district?: string | null;
  max: number;
}

/** basic: ad + adres + Maps bağlantısı (Pro SKU) · contact: + telefon, site, puan, yorum sayısı (Enterprise SKU) */
export type DetailsLevel = "basic" | "contact";

export interface PlacesClient {
  readonly kind: "google" | "mock";
  searchText(q: TextSearchQuery): Promise<PlaceSummary[]>;
  details(placeIds: string[], level: DetailsLevel): Promise<Record<string, PlaceSummary>>;
}

export const MAX_SEARCH_RESULTS = 60; // Text Search: sayfa başına 20, en fazla 3 sayfa
export const MAX_DETAILS_PER_REQUEST = 20;
const PLACE_ID_RE = /^[A-Za-z0-9_-]{4,300}$/;

export function isPlaceId(id: unknown): id is string {
  return typeof id === "string" && PLACE_ID_RE.test(id);
}

/** Arama metni: "diş kliniği Serdivan Sakarya". */
export function buildTextQuery(q: TextSearchQuery): string {
  return [q.query, q.district, q.city].map((s) => (s ?? "").trim()).filter(Boolean).join(" ").slice(0, 200);
}

// ---------------------------------------------------------------------------
// Google Places API (New)
// ---------------------------------------------------------------------------

const SEARCH_FIELDS = [
  "places.id", "places.displayName", "places.formattedAddress", "places.location", "places.nationalPhoneNumber",
  "places.websiteUri", "places.rating", "places.userRatingCount", "places.googleMapsUri", "nextPageToken",
].join(",");
const DETAILS_FIELDS: Record<DetailsLevel, string> = {
  basic: "id,displayName,formattedAddress,googleMapsUri,location",
  contact: "id,displayName,formattedAddress,googleMapsUri,location,nationalPhoneNumber,websiteUri,rating,userRatingCount",
};

interface GPlace {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: { latitude?: number; longitude?: number };
  nationalPhoneNumber?: string;
  websiteUri?: string;
  rating?: number;
  userRatingCount?: number;
  googleMapsUri?: string;
}

export function mapGooglePlace(p: GPlace): PlaceSummary | null {
  if (!p.id || !isPlaceId(p.id)) return null;
  const website = p.websiteUri && /^https?:\/\//i.test(p.websiteUri) ? p.websiteUri : undefined;
  const mapsUrl = p.googleMapsUri && /^https:\/\//i.test(p.googleMapsUri) ? p.googleMapsUri : undefined;
  return {
    placeId: p.id,
    name: p.displayName?.text,
    address: p.formattedAddress,
    phone: p.nationalPhoneNumber,
    website,
    rating: typeof p.rating === "number" ? p.rating : undefined,
    reviewsCount: typeof p.userRatingCount === "number" ? p.userRatingCount : undefined,
    mapsUrl,
    lat: p.location?.latitude,
    lng: p.location?.longitude,
  };
}

export class PlacesApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "PlacesApiError";
  }
}

export class GooglePlacesClient implements PlacesClient {
  readonly kind = "google" as const;
  private apiKey: string;
  private fetchImpl: typeof fetch;
  constructor(apiKey: string, fetchImpl: typeof fetch = fetch) {
    this.apiKey = apiKey;
    this.fetchImpl = fetchImpl;
  }

  async searchText(q: TextSearchQuery): Promise<PlaceSummary[]> {
    const max = Math.max(1, Math.min(q.max, MAX_SEARCH_RESULTS));
    const out: PlaceSummary[] = [];
    let pageToken: string | undefined;
    for (let page = 0; page < 3 && out.length < max; page++) {
      const res = await this.fetchImpl("https://places.googleapis.com/v1/places:searchText", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Goog-Api-Key": this.apiKey, "X-Goog-FieldMask": SEARCH_FIELDS },
        body: JSON.stringify({
          textQuery: buildTextQuery(q),
          languageCode: "tr",
          regionCode: "TR",
          pageSize: Math.min(20, max - out.length),
          ...(pageToken ? { pageToken } : {}),
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new PlacesApiError(res.status, `Places searchText ${res.status}`);
      const data = (await res.json()) as { places?: GPlace[]; nextPageToken?: string };
      for (const p of data.places ?? []) {
        const m = mapGooglePlace(p);
        if (m && !out.some((x) => x.placeId === m.placeId)) out.push(m);
      }
      pageToken = data.nextPageToken;
      if (!pageToken) break;
    }
    return out.slice(0, max);
  }

  async details(placeIds: string[], level: DetailsLevel): Promise<Record<string, PlaceSummary>> {
    const ids = [...new Set(placeIds.filter(isPlaceId))].slice(0, MAX_DETAILS_PER_REQUEST);
    const out: Record<string, PlaceSummary> = {};
    await Promise.all(
      ids.map(async (id) => {
        const res = await this.fetchImpl(`https://places.googleapis.com/v1/places/${encodeURIComponent(id)}?languageCode=tr&regionCode=TR`, {
          headers: { "X-Goog-Api-Key": this.apiKey, "X-Goog-FieldMask": DETAILS_FIELDS[level] },
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) return; // kapanmış / kaldırılmış yer: atlanır
        const m = mapGooglePlace((await res.json()) as GPlace);
        if (m) out[id] = m;
      }),
    );
    return out;
  }
}

// ---------------------------------------------------------------------------
// Sahte istemci (anahtar yok / demo / test). Kurgusal işletmeler, .example alan adları, 0555 000 … numaralar.
// ---------------------------------------------------------------------------

interface MockPlace extends PlaceSummary {
  sector: "hekim" | "mobilya" | "insaat";
  city: string;
  district: string;
}

const mk = (n: number, sector: MockPlace["sector"], name: string, city: string, district: string, rating: number, reviews: number, site = true): MockPlace => {
  const slug = `demo-${sector}-${String(n).padStart(2, "0")}`;
  return {
    placeId: `mock-${sector}-${String(n).padStart(2, "0")}`,
    sector, city, district, name,
    address: `Örnek Mah. ${n}. Sokak No:${n}, ${district}/${city}`,
    phone: `0555 000 ${String(10 + n).padStart(2, "0")} ${String(20 + n).padStart(2, "0")}`,
    website: site ? `https://${slug}.example` : undefined,
    rating, reviewsCount: reviews,
    mapsUrl: `https://www.google.com/maps/search/?api=1&query=Google&query_place_id=mock-${sector}-${n}`,
    lat: 40.7 + n / 1000, lng: 30.4 + n / 1000,
  };
};

export const MOCK_PLACES: MockPlace[] = [
  mk(1, "hekim", "Demo Gülüş Diş Polikliniği", "Sakarya", "Serdivan", 4.8, 312),
  mk(2, "hekim", "Demo Beyaz Diş Kliniği", "Sakarya", "Serdivan", 4.6, 140),
  mk(3, "hekim", "Demo Adapazarı Ağız ve Diş Sağlığı Merkezi", "Sakarya", "Adapazarı", 4.4, 88),
  mk(4, "hekim", "Demo Dermatoloji Kliniği", "Sakarya", "Serdivan", 4.9, 61),
  mk(5, "hekim", "Demo Göz Tıp Merkezi", "Sakarya", "Adapazarı", 4.2, 230),
  mk(6, "hekim", "Demo Ortodonti Stüdyosu", "Sakarya", "Serdivan", 4.7, 45, false),
  mk(7, "hekim", "Demo İzmit Diş Polikliniği", "Kocaeli", "İzmit", 4.5, 520),
  mk(8, "hekim", "Demo Körfez Estetik Kliniği", "Kocaeli", "İzmit", 3.9, 33),
  mk(9, "hekim", "Demo Diyet ve Beslenme Merkezi", "Sakarya", "Serdivan", 4.6, 19),
  mk(10, "hekim", "Demo Fizyoterapi Kliniği", "Sakarya", "Erenler", 4.3, 12),
  mk(11, "mobilya", "Demo Mobilya Evi", "Sakarya", "Adapazarı", 4.4, 210),
  mk(12, "mobilya", "Demo Koltuk Atölyesi", "Sakarya", "Serdivan", 4.1, 57),
  mk(13, "mobilya", "Demo Ev Tekstili Mağazası", "Sakarya", "Adapazarı", 4.6, 98),
  mk(14, "mobilya", "Demo Yatak Dünyası", "Kocaeli", "İzmit", 4.0, 140, false),
  mk(15, "insaat", "Demo Yapı İnşaat", "Sakarya", "Serdivan", 4.5, 41),
  mk(16, "insaat", "Demo Gayrimenkul Danışmanlık", "Sakarya", "Adapazarı", 4.7, 120),
  mk(17, "insaat", "Demo Konut Projeleri", "Kocaeli", "Başiskele", 4.2, 26),
  mk(18, "insaat", "Demo Mimarlık Ofisi", "Sakarya", "Serdivan", 4.9, 15),
];

const foldTr = (s: string) =>
  s.toLocaleLowerCase("tr").replace(/ı/g, "i").replace(/ş/g, "s").replace(/ğ/g, "g").replace(/ü/g, "u").replace(/ö/g, "o").replace(/ç/g, "c");

function mockSectorOf(query: string): MockPlace["sector"] | null {
  const q = foldTr(query);
  if (/(dis|klinik|doktor|hekim|estetik|dermatolo|goz|tip|diyet|fizyo|ortodonti|saglik)/.test(q)) return "hekim";
  if (/(mobilya|koltuk|yatak|tekstil|dekor|perakende|magaza)/.test(q)) return "mobilya";
  if (/(insaat|emlak|gayrimenkul|yapi|konut|mimar)/.test(q)) return "insaat";
  return null;
}

/** Kurgusal veriyle Places taklidi: sorgudaki sektör + il (+ ilçe) ile süzer. Ağ erişimi YOK. */
export class MockPlacesClient implements PlacesClient {
  readonly kind = "mock" as const;
  public calls = { search: 0, details: 0 };

  async searchText(q: TextSearchQuery): Promise<PlaceSummary[]> {
    this.calls.search++;
    const sector = mockSectorOf(q.query);
    const city = foldTr(q.city ?? "");
    const district = foldTr(q.district ?? "");
    return MOCK_PLACES.filter((p) => (!sector || p.sector === sector) && (!city || foldTr(p.city) === city) && (!district || foldTr(p.district) === district))
      .slice(0, Math.max(1, Math.min(q.max, MAX_SEARCH_RESULTS)))
      .map(strip);
  }

  async details(placeIds: string[], level: DetailsLevel): Promise<Record<string, PlaceSummary>> {
    this.calls.details++;
    const out: Record<string, PlaceSummary> = {};
    for (const id of placeIds.slice(0, MAX_DETAILS_PER_REQUEST)) {
      const p = MOCK_PLACES.find((x) => x.placeId === id);
      if (!p) continue;
      const s = strip(p);
      out[id] = level === "basic" ? { placeId: s.placeId, name: s.name, address: s.address, mapsUrl: s.mapsUrl, lat: s.lat, lng: s.lng } : s;
    }
    return out;
  }
}

function strip(p: MockPlace): PlaceSummary {
  const { sector: _s, city: _c, district: _d, ...rest } = p;
  void _s; void _c; void _d;
  return { ...rest };
}

/** GOOGLE_PLACES_API_KEY varsa gerçek istemci; yoksa ya da `forceMock` (demo) ise sahte. */
export function createPlacesClient(env: Record<string, string | undefined>, opts: { forceMock?: boolean; fetchImpl?: typeof fetch } = {}): PlacesClient {
  const key = (env.GOOGLE_PLACES_API_KEY ?? "").trim();
  if (!key || opts.forceMock) return new MockPlacesClient();
  return new GooglePlacesClient(key, opts.fetchImpl);
}
