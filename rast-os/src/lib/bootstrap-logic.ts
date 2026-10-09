// Açılış verisi (0020 app_bootstrap) — saf mantık: rota → koleksiyon eşlemesi, RPC yanıtının
// doğrulanması, yerel/uzak satır birleştirme ve sessionStorage anlık görüntüsü (snapshot) kuralları.
// React / Supabase / tarayıcı API'si içermez; scripts/bootstrap-logic.test.mjs ile sınanır.
import type { RastData } from "./types";

export type Collection = keyof RastData;
export type Row = { id: string } & Record<string, unknown>;

// ---------------------------------------------------------------------------
// Rota → koleksiyon
// ---------------------------------------------------------------------------

/** Dashboard'un `useHydrated` listesi (src/app/(app)/page.tsx ile aynı). */
export const DASHBOARD_COLLECTIONS: Collection[] = [
  "jobs", "invoices", "payments", "expenses", "clients", "equipment", "shoots", "tasks", "contents",
  "activity_logs", "proposals", "proposal_items",
];

/**
 * İlk açılışta, hangi sayfa açılırsa açılsın TEK istekte çekilen çekirdek küme: dashboard + CRM'in küçük
 * referans tabloları. Böylece sayfalar arası gezinti çoğunlukla yeni istek açmaz. Müşteri Bulma, onay,
 * rapor ve portal tabloları yalnızca o sayfalar açılınca çekilir.
 */
export const CORE_COLLECTIONS: Collection[] = [...DASHBOARD_COLLECTIONS, "brands", "projects", "leads", "contacts"];

/**
 * Sayfa (yol öneki) → `useHydrated` koleksiyonları. En uzun önek kazanır. Testte her sayfanın
 * useHydrated listesinin bu eşlemenin alt kümesi olduğu doğrulanır (eksik olsa da çalışır: sayfa
 * eksik koleksiyonu kendisi ister — yalnızca bir tur kaybedilir).
 */
const ROUTES: [prefix: string, collections: Collection[]][] = [
  ["/", DASHBOARD_COLLECTIONS],
  ["/teklifler", ["proposals", "proposal_items", "clients", "projects"]],
  ["/content", ["contents", "clients", "brands", "content_approvals"]],
  ["/crm/clients", ["clients", "brands", "contacts", "client_portal_tokens"]],
  ["/crm/leads", ["leads", "tasks"]],
  ["/crm/pipeline", ["leads"]],
  ["/crm/contacts", ["contacts", "clients", "brands"]],
  ["/crm/brands", ["brands", "clients"]],
  ["/finance/invoices", ["invoices", "payments", "clients", "jobs"]],
  ["/finance/expenses", ["expenses"]],
  ["/musteri-bulma", ["prospects", "outreach_sequences", "outreach_messages", "suppression_list", "leads", "tasks"]],
  ["/raporlar", ["clients", "brands", "contents", "shoots", "content_approvals", "client_reports"]],
  ["/tasks", ["tasks", "projects"]],
  ["/projects", ["projects", "clients", "tasks", "brands"]],
  ["/jobs", ["jobs"]],
  ["/shoots", ["shoots", "clients", "brands"]],
  ["/equipment", ["equipment"]],
  ["/settings/islem-gecmisi", ["activity_logs"]],
  ["/settings", []],
  ["/import", ["clients", "leads", "contacts", "brands", "jobs", "equipment", "expenses", "invoices"]],
  ["/ads", []],
  ["/files", []],
];

const matches = (path: string, prefix: string) =>
  prefix === "/" ? path === "/" : path === prefix || path.startsWith(prefix + "/");

/** Yolun sayfasının koleksiyonları (bilinmeyen yol → boş). */
export function routeCollections(pathname: string): Collection[] {
  const path = (pathname.split(/[?#]/)[0] || "/").replace(/\/+$/, "") || "/";
  let best: [string, Collection[]] | null = null;
  for (const r of ROUTES) {
    if (matches(path, r[0]) && (!best || r[0].length > best[0].length)) best = r;
  }
  return best ? [...best[1]] : [];
}

/** Sıra korunarak tekrarsız birleşim. */
export function unionCollections(...lists: (readonly Collection[] | undefined)[]): Collection[] {
  const out: Collection[] = [];
  const seen = new Set<Collection>();
  for (const list of lists) for (const c of list ?? []) if (!seen.has(c)) { seen.add(c); out.push(c); }
  return out;
}

/** İlk açılışta istenecek küme: çekirdek + açılan sayfanınkiler. */
export function bootCollections(pathname: string): Collection[] {
  return unionCollections(CORE_COLLECTIONS, routeCollections(pathname));
}

// ---------------------------------------------------------------------------
// RPC yanıtı
// ---------------------------------------------------------------------------

export interface BootstrapProfile {
  organization_id: string | null;
  role: string | null;
  full_name: string | null;
}

/** Org hedefleri (0014) — orgSettings ayrı istek atmadan buradan okur. */
export interface BootstrapOrganization {
  mrr_target: number | null;
  mrr_target_label: string | null;
}

export interface BootstrapResult {
  profile: BootstrapProfile | null;
  organization: BootstrapOrganization | null;
  rows: Partial<Record<Collection, Row[]>>;
}

const str = (v: unknown) => (typeof v === "string" && v !== "" ? v : null);
const isObj = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);

/**
 * `app_bootstrap` yanıtını doğrular ve store biçimine çevirir. İstenen koleksiyonlardan biri dizi
 * değilse (bozuk / beklenmeyen yanıt) null döner — çağıran eski tablo-tablo yola düşer.
 */
export function parseBootstrap(data: unknown, requested: readonly Collection[]): BootstrapResult | null {
  if (!isObj(data)) return null;
  const p = data.profile;
  const profile: BootstrapProfile | null = isObj(p)
    ? { organization_id: str(p.organization_id), role: str(p.role), full_name: str(p.full_name) }
    : null;
  const o = data.organization;
  let organization: BootstrapOrganization | null = null;
  if (isObj(o)) {
    const t = o.mrr_target;
    const n = t === null || t === undefined || t === "" ? NaN : Number(t);
    organization = { mrr_target: Number.isFinite(n) ? n : null, mrr_target_label: str(o.mrr_target_label) };
  }
  const rows: Partial<Record<Collection, Row[]>> = {};
  for (const c of requested) {
    const list = data[c];
    if (!Array.isArray(list)) return null;
    rows[c] = list.filter((r): r is Row => isObj(r) && typeof r.id === "string");
  }
  return { profile, organization, rows };
}

/** PostgREST "fonksiyon yok" (0020 henüz uygulanmadı): eski tablo-tablo yola düşülür. */
export function isRpcMissing(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return error.code === "PGRST202" || (error.code === "42883" && /app_bootstrap/.test(error.message ?? ""));
}

// ---------------------------------------------------------------------------
// Birleştirme (yenileme sırasında yapılan yerel değişiklikler ezilmesin)
// ---------------------------------------------------------------------------

/**
 * Sunucudan gelen listeyi (`fetched`) yerel listeyle birleştirir. `changedSinceFetch(id)`: kayıt bu
 * çekim BAŞLADIKTAN sonra yerelde eklendi / güncellendi / silindi mi (add/update/remove/mergeLocal)?
 *
 * - Sunucuda olan, yerelde dokunulmamış kayıt → sunucu sürümü (başka kullanıcının değişikliği gelir).
 * - Sunucuda olan ama çekimden sonra yerelde değişen kayıt → yerel sürüm; yerelde silindiyse hiç.
 * - Yalnız yerelde olan kayıt → çekimden sonra eklendiyse korunur (iyimser ekleme), değilse atılır
 *   (başka yerde silinmiş ya da bayat anlık görüntüden kalmış).
 * Sıra: korunan yerel eklemeler başta, ardından sunucu sırası (created_at desc).
 */
export function mergeRows<R extends Row>(local: readonly R[], fetched: readonly R[], changedSinceFetch: (id: string) => boolean): R[] {
  const localById = new Map(local.map((r) => [r.id, r]));
  const fetchedIds = new Set(fetched.map((r) => r.id));
  const out: R[] = local.filter((r) => !fetchedIds.has(r.id) && changedSinceFetch(r.id));
  for (const r of fetched) {
    if (!changedSinceFetch(r.id)) {
      out.push(r);
      continue;
    }
    const mine = localById.get(r.id);
    if (mine) out.push(mine);
  }
  return out;
}

// ---------------------------------------------------------------------------
// sessionStorage anlık görüntüsü (stale-while-revalidate)
// ---------------------------------------------------------------------------

export const SNAPSHOT_VERSION = 1;
/** 2 MB üstü anlık görüntü yazılmaz (sessionStorage kotası ~5 MB; JSON.stringify ana iş parçacığını da bekletir). */
export const SNAPSHOT_MAX_BYTES = 2 * 1024 * 1024;
/** Bu süreden eski anlık görüntü gösterilmez (aynı sekmede uzun ara → doğrudan taze veri). */
export const SNAPSHOT_MAX_AGE_MS = 12 * 60 * 60 * 1000;

export interface Snapshot {
  v: number;
  userId: string;
  orgId: string;
  savedAt: number;
  profile: BootstrapProfile | null;
  organization: BootstrapOrganization | null;
  collections: Partial<Record<Collection, Row[]>>;
}

/** UTF-8 bayt sayısı ≤ maxBytes ise JSON, değilse (veya serileştirilemezse) null. */
export function serializeSnapshot(snap: Snapshot, maxBytes: number = SNAPSHOT_MAX_BYTES): string | null {
  let json: string;
  try {
    json = JSON.stringify(snap);
  } catch {
    return null;
  }
  // Her UTF-16 birimi en az 1, en çok 3 UTF-8 baytı: ucuz alt/üst sınırlar, gerekirse tam sayım.
  if (json.length > maxBytes) return null;
  if (json.length * 3 <= maxBytes) return json;
  return new TextEncoder().encode(json).length <= maxBytes ? json : null;
}

/**
 * Ham değeri doğrular: sürüm, kullanıcı, yaş, biçim. Uymayan her şey → null (gösterilmez).
 * `allowed` dışındaki koleksiyon anahtarları atlanır (eski sürümden kalan / bilinmeyen anahtar store'a girmez).
 */
export function parseSnapshot(
  raw: string | null | undefined,
  userId: string,
  now: number,
  allowed: readonly Collection[],
  maxAgeMs: number = SNAPSHOT_MAX_AGE_MS,
): Snapshot | null {
  if (!raw) return null;
  let d: unknown;
  try {
    d = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObj(d) || d.v !== SNAPSHOT_VERSION || d.userId !== userId || typeof d.orgId !== "string" || !d.orgId) return null;
  if (typeof d.savedAt !== "number" || now - d.savedAt > maxAgeMs || d.savedAt - now > 60_000) return null;
  if (!isObj(d.collections)) return null;
  const collections: Partial<Record<Collection, Row[]>> = {};
  for (const [k, v] of Object.entries(d.collections)) {
    if (!Array.isArray(v)) return null;
    if (allowed.includes(k as Collection)) collections[k as Collection] = v as Row[];
  }
  return {
    v: SNAPSHOT_VERSION,
    userId,
    orgId: d.orgId,
    savedAt: d.savedAt,
    profile: isObj(d.profile) ? (d.profile as unknown as BootstrapProfile) : null,
    organization: isObj(d.organization) ? (d.organization as unknown as BootstrapOrganization) : null,
    collections,
  };
}
