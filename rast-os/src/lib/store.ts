"use client";

import { create } from "zustand";
import { useEffect, useMemo } from "react";
import type { RastData, WritableCollection } from "./types";
import { DEMO_USER_ID, seed } from "./seed";
import { isAuthRequired, isSupabaseConfigured } from "./env";
import { createClient } from "./supabase/client";
import { perfLog, perfStart } from "./perf";
import {
  bootCollections, isProfilesRejected, isRpcMissing, mergeRows, parseBootstrap, routeCollections, shouldRefreshOnFocus, unionCollections,
} from "./bootstrap-logic";
import { clearSnapshots, readSnapshot, writeSnapshot } from "./snapshot";
import type { BootstrapOrganization, BootstrapProfile } from "./bootstrap-logic";

type Collections = keyof RastData;
type Row = { id: string } & Record<string, unknown>;
export type MutationResult = { ok: boolean; error?: string };

export const COLLECTIONS: Collections[] = [
  "leads", "jobs", "clients", "brands", "contacts", "projects",
  "tasks", "contents", "shoots", "equipment", "invoices", "payments", "expenses",
  // proposal_items, proposals'tan SONRA (seedToSupabase sırayla ekler; FK)
  "proposals", "proposal_items",
  // İçerik onayları (0013): token sunucuda üretilir → approvalActions.ts ile eklenir.
  "content_approvals",
  // Aylık müşteri raporu notları (0015), clients'tan SONRA (FK).
  "client_reports",
  // Müşteri portalı bağlantıları (0018), clients'tan SONRA (FK). Token sunucuda üretilir → portalActions.ts.
  "client_portal_tokens",
  // Salt okunur: yalnızca DB trigger'ı yazar (0012). add/update/remove ve seedToSupabase dışında.
  "activity_logs",
  // Müşteri Bulma (0019): prospects ve outreach_sequences, outreach_messages'tan ÖNCE (FK).
  "prospects", "outreach_sequences", "outreach_messages", "suppression_list",
  // Ekip (0021): görev atama listesi. Salt okunur; yalnız id, ad, rol, aktiflik gelir.
  "profiles",
];

/** seedToSupabase'in atladığı koleksiyonlar (demo Müşteri Bulma verisi sahte Places kimlikleri içerir). */
const SEED_SKIP = new Set<Collections>(["activity_logs", "content_approvals", "client_portal_tokens", "prospects", "outreach_sequences", "outreach_messages", "suppression_list", "profiles"]);

/** Ekip listesinde istemciye gelen alanlar (0021 ile aynı; telefon / avatar gelmez). */
const PROFILE_COLUMNS = "id, full_name, role, is_active";

/** Tek seferde çekilecek en fazla işlem geçmişi satırı (en yeniler). 0020 app_bootstrap ile aynı. */
const ACTIVITY_LOG_LIMIT = 500;

const emptyData: RastData = {
  leads: [], jobs: [], clients: [], brands: [], contacts: [], projects: [],
  tasks: [], contents: [], shoots: [], equipment: [], invoices: [], payments: [], expenses: [],
  proposals: [], proposal_items: [], content_approvals: [], client_reports: [], client_portal_tokens: [], activity_logs: [],
  prospects: [], outreach_sequences: [], outreach_messages: [], suppression_list: [],
  profiles: [],
};

const noneLoaded = () => COLLECTIONS.reduce((acc, c) => ({ ...acc, [c]: false }), {} as Record<Collections, boolean>);

export const uid = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : "id-" + Math.random().toString(36).slice(2, 10);

export const nowISO = () => new Date().toISOString();

// Boş string -> null, undefined alanları at (Postgres date/numeric/uuid için)
function clean<T extends Record<string, unknown>>(obj: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    out[k] = v === "" ? null : v;
  }
  return out;
}

interface StoreState extends RastData {
  loaded: boolean;
  supabase: boolean;
  orgId: string | null;
  /** Oturumdaki kullanıcının id'si (auth.uid; demo modunda DEMO_USER_ID). "Bana atanan" filtresi için. */
  userId: string | null;
  /** Oturumdaki kullanıcının profili (rol, görünen ad) — açılış isteğinden gelir. */
  profile: BootstrapProfile | null;
  /** Org hedefleri (0014); `orgTargetsKnown` false ise bilinmiyor (orgSettings kendisi çeker). */
  orgTargets: BootstrapOrganization | null;
  orgTargetsKnown: boolean;
  loadedCollections: Record<Collections, boolean>;
  init: () => Promise<void>;
  load: (collections: Collections[]) => Promise<void>;
  add: <K extends WritableCollection>(key: K, item: RastData[K][number]) => Promise<MutationResult>;
  update: <K extends WritableCollection>(key: K, id: string, patch: Partial<RastData[K][number]>) => Promise<MutationResult>;
  remove: <K extends WritableCollection>(key: K, id: string) => Promise<MutationResult>;
  /** Sunucudan dönen satırları (ör. /api/growth/discover upsert'i) yerel listeye id'ye göre birleştirir; DB'ye yazmaz. */
  mergeLocal: <K extends WritableCollection>(key: K, rows: RastData[K][number][]) => void;
  reset: () => void;
  seedToSupabase: () => Promise<{ ok: boolean; error?: string }>;
}

// ---------------------------------------------------------------------------
// Veri yükleme (Supabase modu) — bkz. docs/performans.md
//
// Açılış: getSession (yerel) → TEK istek `app_bootstrap` (0020): profil + org hedefleri + o ana kadar
// istenen tüm koleksiyonlar. Sonradan istenen koleksiyonlar aynı mikro-görevde toplanıp yine tek istekle
// çekilir. 0020 uygulanmadıysa (PGRST202) eski yola düşülür: profil + tablolar paralel `select *`.
// ---------------------------------------------------------------------------

/** İstenmiş ama henüz istek atılmamış koleksiyonlar (aynı commit'teki tüm sayfa/bileşen istekleri birleşir). */
const pending = new Set<Collections>();
/** Uçuştaki istekler: aynı koleksiyon ikinci kez istenmez, bekleyen çağıran aynı promise'i bekler. */
const inflight = new Map<Collections, Promise<void>>();
let initPromise: Promise<void> | null = null;
let flushScheduled: Promise<void> | null = null;
let activeFetches = 0;
/** Son başarılı çekimin zamanı (pencereye dönüş yenilemesi için; 0 = henüz yok). */
let lastFetchAt = 0;
/** Oturum sıfırlanınca (çıkış / yeni giriş) artar: eski oturumun geç gelen yanıtları uygulanmaz. */
let epoch = 0;
/** Oturumdaki kullanıcı (anlık görüntü anahtarı). */
let currentUserId: string | null = null;

/**
 * Yerel değişiklik sırası: add/update/remove/mergeLocal her kaydı `${koleksiyon}:${id}` → artan sayı ile
 * işaretler. Bir çekim başladığında o anki sayı saklanır; çekimden SONRA değişen kayıtlar birleştirmede
 * yerel haliyle korunur (bkz. bootstrap-logic.ts → mergeRows).
 */
let changeSeq = 0;
const touched = new Map<string, number>();
const touch = (c: Collections, id: string) => {
  touched.set(`${c}:${id}`, ++changeSeq);
};

const RPC_MISSING_KEY = "rast-os:bootstrap-rpc-missing";
let rpcAvailable = true;
function rpcEnabled(): boolean {
  if (!rpcAvailable) return false;
  try {
    if (sessionStorage.getItem(RPC_MISSING_KEY) === "1") rpcAvailable = false;
  } catch {
    /* depolama kapalı: her açılışta denenir */
  }
  return rpcAvailable;
}
function markRpcMissing() {
  rpcAvailable = false;
  try {
    sessionStorage.setItem(RPC_MISSING_KEY, "1");
  } catch {
    /* yok say */
  }
}

/**
 * 0021 uygulanmamışsa `app_bootstrap` `profiles`'ı reddeder (22023): bu sekmede bir daha RPC'ye
 * eklenmez, ekip ayrı bir sorguyla RPC ile PARALEL çekilir (ek tur yok, yalnız +1 istek).
 */
const PROFILES_RPC_MISSING_KEY = "rast-os:bootstrap-profiles-missing";
let profilesInRpc = true;
function profilesRpcEnabled(): boolean {
  if (!profilesInRpc) return false;
  try {
    if (sessionStorage.getItem(PROFILES_RPC_MISSING_KEY) === "1") profilesInRpc = false;
  } catch {
    /* depolama kapalı */
  }
  return profilesInRpc;
}
function markProfilesRpcMissing() {
  profilesInRpc = false;
  try {
    sessionStorage.setItem(PROFILES_RPC_MISSING_KEY, "1");
  } catch {
    /* yok say */
  }
}

/** Ekip listesi (0021 yokken): RLS aynı org'u gösterir (0001 profiles_self); yalnız gerekli kolonlar. */
async function fetchProfilesTable(): Promise<Row[] | null> {
  const t0 = perfStart();
  const { data, error } = await createClient().from("profiles").select(PROFILE_COLUMNS).order("created_at", { ascending: true });
  perfLog("load: profiles (ayrı, 0021 yok)", t0, { rows: data?.length ?? 0 });
  if (error) {
    console.error("[profiles] ekip listesi alınamadı:", error.message);
    return null;
  }
  return (data ?? []) as unknown as Row[];
}

interface Fetched {
  rows: Partial<Record<Collections, Row[]>>;
  /** undefined: bu çekimde profil istenmedi. */
  profile?: BootstrapProfile | null;
  /** undefined: bilinmiyor (eski yol). */
  organization?: BootstrapOrganization | null;
  startSeq: number;
  /** Eski yolda hata veren tablolar (rows'ta boş dizi). Tazelemede uygulanmaz — eldeki veri silinmez. */
  failed?: Collections[];
  /** Eski yolda profil sorgusu hata verdi (ağ vb.; "satır yok" değil). */
  profileFailed?: boolean;
}

/** Eski yol: tablo başına `select *` (paralel). Profil istenirse o da aynı turda. */
async function fetchLegacy(cols: Collections[], userId: string | null, startSeq: number): Promise<Fetched> {
  const sb = createClient();
  const t0 = perfStart();
  const rows: Partial<Record<Collections, Row[]>> = {};
  const failed: Collections[] = [];
  // Sorgu oluşturucu tembeldir (await'e kadar istek gitmez): `.then` ile HEMEN başlatılır → tablolarla aynı turda.
  const profileQuery = userId
    ? sb.from("profiles").select("organization_id, role, full_name").eq("id", userId).single().then((r) => r)
    : null;
  await Promise.all(
    cols.map(async (c) => {
      const tTable = perfStart();
      const query = c === "profiles"
        ? sb.from(c).select(PROFILE_COLUMNS).order("created_at", { ascending: true })
        : sb.from(c).select("*").order("created_at", { ascending: false });
      const { data, error } = await (c === "activity_logs" ? query.limit(ACTIVITY_LOG_LIMIT) : query);
      if (error) failed.push(c);
      rows[c] = (data ?? []) as Row[];
      perfLog(`load: ${c}`, tTable, { rows: rows[c]!.length });
    }),
  );
  let profile: BootstrapProfile | null | undefined;
  let profileFailed = false;
  if (profileQuery) {
    const { data, error } = await profileQuery;
    // PGRST116 = profil satırı yok (geçerli durum: org'suz say); diğer hatalar = alınamadı.
    profileFailed = Boolean(error) && error?.code !== "PGRST116";
    const p = data as { organization_id?: string | null; role?: string | null; full_name?: string | null } | null;
    profile = p ? { organization_id: p.organization_id ?? null, role: p.role ?? null, full_name: p.full_name ?? null } : null;
  }
  perfLog("load: eski yol toplam (paralel)", t0, { requests: cols.length + (userId ? 1 : 0), collections: cols });
  return { rows, profile, startSeq, failed, profileFailed };
}

/** Koleksiyonları (ve istenirse profili) çeker: önce 0020/0021 RPC (1 istek), olmazsa eski yol. */
async function fetchRemote(cols: Collections[], userId: string | null): Promise<Fetched> {
  const startSeq = changeSeq;
  if (rpcEnabled()) {
    const t0 = perfStart();
    const wantProfiles = cols.includes("profiles");
    let rpcCols = wantProfiles && !profilesRpcEnabled() ? cols.filter((c) => c !== "profiles") : cols;
    // 0021 yoksa ekip RPC ile aynı turda (paralel) ayrı sorguyla gelir.
    let side: Promise<Row[] | null> | null = rpcCols === cols ? null : fetchProfilesTable();
    let { data, error } = await createClient().rpc("app_bootstrap", { p_collections: rpcCols });
    if (error && rpcCols.includes("profiles") && isProfilesRejected(error)) {
      // 0020 var, 0021 yok: bu sekmede profiles RPC'ye bir daha eklenmez (yalnız ilk açılışta +1 tur).
      markProfilesRpcMissing();
      perfLog("bootstrap: app_bootstrap profiles'ı tanımıyor (0021 yok) → ekip ayrı sorguyla", t0);
      rpcCols = cols.filter((c) => c !== "profiles");
      side = fetchProfilesTable();
      ({ data, error } = await createClient().rpc("app_bootstrap", { p_collections: rpcCols }));
    }
    if (!error) {
      const parsed = parseBootstrap(data, rpcCols);
      if (parsed) {
        perfLog("bootstrap: app_bootstrap (1 istek)", t0, { collections: rpcCols, profilesSeparate: Boolean(side) });
        const rows = parsed.rows;
        let failed: Collections[] | undefined;
        if (side) {
          const team = await side;
          if (team) rows.profiles = team;
          else {
            rows.profiles = [];
            failed = ["profiles"];
          }
        }
        return { rows, profile: parsed.profile, organization: parsed.organization, startSeq, failed };
      }
      console.error("[bootstrap] app_bootstrap beklenmeyen yanıt döndü; tablo tablo yükleniyor.");
    } else if (isRpcMissing(error)) {
      // 0020 henüz uygulanmadı: bu sekmede bir daha denenmez.
      markRpcMissing();
      perfLog("bootstrap: app_bootstrap yok (PGRST202) → eski yol", t0);
    } else {
      console.error("[bootstrap] app_bootstrap hatası:", error.message);
    }
  }
  return fetchLegacy(cols, userId, startSeq);
}

/** Çekilen satırları store'a yazar (yerel değişiklikler korunur). */
function applyRows(f: Fetched, extra: Partial<StoreState> = {}) {
  const cur = useStore.getState();
  const next: Record<string, unknown> = {};
  const nextLoaded = { ...cur.loadedCollections };
  for (const [c, rows] of Object.entries(f.rows) as [Collections, Row[]][]) {
    next[c] = mergeRows(cur[c] as unknown as Row[], rows, (id) => (touched.get(`${c}:${id}`) ?? 0) > f.startSeq);
    nextLoaded[c] = true;
  }
  useStore.setState({ ...(next as Partial<RastData>), ...extra, loadedCollections: nextLoaded });
}

/**
 * Açılış / yenileme yanıtını uygular. Profil geldiyse org değişmiş olabilir (anlık görüntü başka org'a
 * aitse): o durumda yerel veri tamamen atılır, yalnızca gelen koleksiyonlar yüklü sayılır.
 */
function applyBootstrap(input: Fetched) {
  const cur = useStore.getState();
  let f = input;
  // Tazeleme (veri zaten ekranda) sırasında hata veren parçalar uygulanmaz: geçici ağ hatası ekrandaki
  // (ör. anlık görüntüden gelen) veriyi silmesin. İlk açılışta eski davranış: boş liste.
  if (cur.loaded && (f.failed?.length || f.profileFailed)) {
    const rows = { ...f.rows };
    for (const c of f.failed ?? []) delete rows[c];
    f = { ...f, rows, profile: f.profileFailed ? undefined : f.profile };
  }
  const orgId = f.profile === undefined ? cur.orgId : (f.profile?.organization_id ?? null);
  const meta: Partial<StoreState> = { loaded: true, supabase: true, orgId };
  if (f.profile !== undefined) meta.profile = f.profile;
  if (f.organization !== undefined) {
    meta.orgTargets = f.organization;
    meta.orgTargetsKnown = true;
  }
  if (cur.loaded && cur.orgId !== orgId) {
    const flags = noneLoaded();
    for (const c of Object.keys(f.rows) as Collections[]) flags[c] = true;
    useStore.setState({ ...emptyData, ...(f.rows as Partial<RastData>), ...meta, loadedCollections: flags });
    return;
  }
  applyRows(f, meta);
}

/** `fetchRemote` + uçuştaki istek kaydı (aynı koleksiyon iki kez istenmez). */
async function runFetch(cols: Collections[], userId: string | null, onDone: (f: Fetched) => void): Promise<void> {
  const myEpoch = epoch;
  activeFetches++;
  const job = fetchRemote(cols, userId).then((f) => {
    if (myEpoch !== epoch) return;
    onDone(f);
    lastFetchAt = Date.now();
  });
  const tracked = job.catch(() => undefined);
  for (const c of cols) inflight.set(c, tracked);
  try {
    await job;
  } finally {
    if (myEpoch === epoch) {
      for (const c of cols) if (inflight.get(c) === tracked) inflight.delete(c);
      activeFetches--;
      // Uçuşta çekim yoksa eski işaretler artık hiçbir birleştirmeyi etkilemez.
      if (activeFetches === 0) touched.clear();
    }
  }
}

async function runInit(): Promise<void> {
  const tInit = perfStart();
  const myEpoch = epoch;
  const sb = createClient();
  const { data: { session } } = await sb.auth.getSession();
  perfLog("init: getSession (yerel; süresi dolmuşsa yenileme ağ çağrısı)", tInit);
  if (myEpoch !== epoch) return;
  const user = session?.user;

  // Supabase yapılandırılmış ama oturum yok. Giriş zorunluyken (varsayılan) proxy bu
  // sayfalara oturumsuz erişime izin vermez; buraya yalnızca istemci tarafında oturum
  // düşerse gelinir — gerçek veri gibi görünen örnek veriyi göstermek yerine boş kal.
  // Örnek (demo) veri yalnızca açıkça NEXT_PUBLIC_REQUIRE_AUTH=false iken gösterilir.
  if (!user) {
    pending.clear();
    currentUserId = null;
    clearSnapshots();
    useStore.setState({
      ...(isAuthRequired ? emptyData : seed), loaded: true, supabase: false, orgId: null,
      userId: isAuthRequired ? null : DEMO_USER_ID,
    });
    return;
  }
  currentUserId = user.id;
  useStore.setState({ userId: user.id });

  // Stale-while-revalidate: bu sekmede son görülen veri varsa HEMEN göster, arka planda tek istekle tazele.
  const snap = readSnapshot(user.id, COLLECTIONS);
  if (snap) {
    const flags = noneLoaded();
    for (const c of Object.keys(snap.collections) as Collections[]) flags[c] = true;
    useStore.setState({
      ...(snap.collections as Partial<RastData>),
      loaded: true,
      supabase: true,
      orgId: snap.orgId,
      profile: snap.profile,
      orgTargets: snap.organization,
      orgTargetsKnown: snap.organization !== null,
      loadedCollections: flags,
    });
    perfLog("init: anlık görüntü gösterildi (0 istek)", tInit, { collections: Object.keys(snap.collections).length });
    const cols = unionCollections(Object.keys(snap.collections) as Collections[], [...pending]);
    pending.clear();
    const tRefresh = perfStart();
    void runFetch(cols, user.id, applyBootstrap).then(() => {
      perfLog("init: arka plan tazeleme", tRefresh, { collections: cols.length });
      if (pending.size) void flushPending();
    });
    return;
  }

  // O ana kadar sayfaların istediği tüm koleksiyonlar + profil: TEK istek.
  const cols = [...pending];
  pending.clear();
  await runFetch(cols, user.id, applyBootstrap);
  perfLog("init: toplam (profil + ilk koleksiyonlar)", tInit, { collections: cols.length });

  // İstek uçarken istenen koleksiyonlar (ör. sonradan açılan bileşen) → bir tur daha.
  if (pending.size) await flushPending();
}

async function flushPending(): Promise<void> {
  if (!isSupabaseConfigured) {
    pending.clear();
    return;
  }
  const st = useStore.getState();
  if (!st.loaded) {
    // Açılış henüz bitmedi: init bekleyen koleksiyonları kendisi çeker.
    await st.init();
    return;
  }
  const asked = [...pending];
  pending.clear();
  // Oturumsuz (supabase: false — boş ya da açıkça istenmiş örnek veri): yüklenecek bir şey yok.
  if (!st.supabase) return;
  // Uçuştaki (ör. arka plan tazelemesi) koleksiyonlar yeniden istenmez; onların bitişi beklenir.
  const waits = asked.map((c) => inflight.get(c)).filter((p): p is Promise<void> => Boolean(p));
  const cols = asked.filter((c) => !useStore.getState().loadedCollections[c] && !inflight.has(c));
  if (cols.length === 0) {
    await Promise.all(waits);
    return;
  }
  if (!st.orgId) {
    // Org'a bağlı olmayan oturum: RLS hiçbir satır döndürmez — boş ama "yüklendi" say (sonsuz iskelet olmasın).
    applyRows({ rows: Object.fromEntries(cols.map((c) => [c, []])), startSeq: changeSeq });
    return;
  }
  await Promise.all([...waits, runFetch(cols, null, (f) => applyRows(f))]);
}

/**
 * Koleksiyonları ister; hepsi yüklendiğinde (ya da yüklenemeyeceği anlaşıldığında) çözülür.
 * Aynı mikro-görevdeki tüm istekler tek `app_bootstrap` çağrısında birleşir.
 */
function requestCollections(cols: readonly Collections[]): Promise<void> {
  if (!isSupabaseConfigured) {
    if (!useStore.getState().loaded) void useStore.getState().init();
    return Promise.resolve();
  }
  const st = useStore.getState();
  const waits: Promise<void>[] = [];
  for (const c of cols) {
    if (st.loadedCollections[c]) continue;
    const running = inflight.get(c);
    if (running) waits.push(running);
    else pending.add(c);
  }
  if (pending.size || !st.loaded) {
    if (!flushScheduled) {
      const p: Promise<void> = Promise.resolve().then(() => {
        if (flushScheduled === p) flushScheduled = null;
        return flushPending();
      });
      flushScheduled = p;
    }
    waits.push(flushScheduled);
  }
  return Promise.all(waits).then(() => undefined);
}

/**
 * Açılış isteğini sayfa bileşenleri mount olmadan, olabildiğince erken başlatır (AppShell modülü
 * yüklenirken, giriş başarılı olunca). İstenen küme: çekirdek (dashboard + CRM) + açılan sayfa —
 * böylece sayfalar arası gezinti çoğunlukla yeni istek açmaz. Demo modunda hiçbir şey yapmaz.
 */
export function prefetchBootstrap(pathname: string): void {
  if (!isSupabaseConfigured) return;
  void requestCollections(bootCollections(pathname));
}

/**
 * Bağlantı üzerine gelinince / odaklanınca hedef sayfanın eksik koleksiyonlarını önceden ister
 * (tıklamadan önce tek RPC). Açılış bitmeden ya da demo modunda hiçbir şey yapmaz.
 */
export function prefetchRoute(pathname: string): void {
  const st = useStore.getState();
  if (!isSupabaseConfigured || !st.loaded || !st.supabase || !st.orgId) return;
  const missing = routeCollections(pathname).filter((c) => !st.loadedCollections[c] && !inflight.has(c));
  if (missing.length) void requestCollections(missing);
}

/**
 * Pencereye / sekmeye dönüşte: son çekimden 60 sn'den fazla geçtiyse yüklü TÜM koleksiyonları tek
 * `app_bootstrap` ile tazeler (profil + org hedefleri dahil). Çekim sürerken ya da açılış bitmeden no-op.
 * Yerel değişiklikler korunur (mergeRows); başka kullanıcıların ekleme / güncelleme / silmeleri gelir.
 */
export function refreshIfStale(): void {
  const st = useStore.getState();
  if (!isSupabaseConfigured || !st.loaded || !st.supabase || !st.orgId) return;
  if (!shouldRefreshOnFocus(lastFetchAt, Date.now(), activeFetches > 0 || initPromise !== null)) return;
  const cols = COLLECTIONS.filter((c) => st.loadedCollections[c]);
  if (cols.length === 0) return;
  const t0 = perfStart();
  void runFetch(cols, currentUserId, applyBootstrap).then(() =>
    perfLog("odak: yüklü koleksiyonlar tazelendi", t0, { collections: cols.length }),
  );
}

/** Oturum değişti (çıkış / giriş sayfası): bellekteki veriyi, bekleyen istekleri ve anlık görüntüyü sıfırlar. */
export function resetSession(): void {
  epoch++;
  currentUserId = null;
  cancelSnapshotSave();
  clearSnapshots();
  pending.clear();
  inflight.clear();
  touched.clear();
  initPromise = null;
  flushScheduled = null;
  activeFetches = 0;
  lastFetchAt = 0;
  useStore.setState({
    ...emptyData,
    loaded: false,
    supabase: false,
    orgId: null,
    userId: null,
    profile: null,
    orgTargets: null,
    orgTargetsKnown: false,
    loadedCollections: noneLoaded(),
  });
}

export const useStore = create<StoreState>()((set, get) => ({
  ...emptyData,
  loaded: false,
  supabase: false,
  orgId: null,
  userId: null,
  profile: null,
  orgTargets: null,
  orgTargetsKnown: false,
  loadedCollections: noneLoaded(),

  init: async () => {
    // Supabase yoksa: bellek içi örnek verilerle çalış (demo modu; oturumdaki kullanıcı = demo Bewo)
    if (!isSupabaseConfigured) {
      set({ ...seed, loaded: true, supabase: false, userId: DEMO_USER_ID });
      return;
    }

    if (get().loaded && get().orgId !== null) {
      return;
    }

    if (!initPromise) {
      const p: Promise<void> = runInit().finally(() => {
        if (initPromise === p) initPromise = null;
      });
      initPromise = p;
    }
    return initPromise;
  },

  load: (collections) => requestCollections(collections),

  add: async (key, item) => {
    const current = get();
    if (current.supabase && !current.orgId) {
      return { ok: false, error: "Hesabınız bir organizasyona bağlı değil. Lütfen yöneticiyle iletişime geçin." };
    }
    const itemId = (item as unknown as Row).id;
    touch(key, itemId);
    set((s) => ({ [key]: [item, ...(s[key] as unknown[])] } as Partial<StoreState>));
    const { supabase, orgId } = get();
    if (supabase) {
      const sb = createClient();
      const row = clean({ ...(item as unknown as Row), organization_id: orgId });
      const { error } = await sb.from(key).insert(row);
      touch(key, itemId);
      if (error) {
        set((s) => ({ [key]: (s[key] as unknown as Row[]).filter((it) => it.id !== itemId) } as Partial<StoreState>));
        console.error(`[${key}] insert hatası:`, error.message);
        return { ok: false, error: error.message };
      }
    }
    return { ok: true };
  },

  update: async (key, id, patch) => {
    const current = get();
    if (current.supabase && !current.orgId) {
      return { ok: false, error: "Hesabınız bir organizasyona bağlı değil. Lütfen yöneticiyle iletişime geçin." };
    }
    const previous = (get()[key] as unknown as Row[]).find((item) => item.id === id);
    touch(key, id);
    set((s) => ({
      [key]: (s[key] as unknown as Row[]).map((it) => (it.id === id ? { ...it, ...patch } : it)),
    } as Partial<StoreState>));
    const { supabase } = get();
    if (supabase) {
      const sb = createClient();
      const { error } = await sb.from(key).update(clean(patch as Record<string, unknown>)).eq("id", id);
      touch(key, id);
      if (error) {
        if (previous) {
          set((s) => ({
            [key]: (s[key] as unknown as Row[]).map((item) => item.id === id ? previous : item),
          } as Partial<StoreState>));
        }
        console.error(`[${key}] update hatası:`, error.message);
        return { ok: false, error: error.message };
      }
    }
    return { ok: true };
  },

  remove: async (key, id) => {
    const previous = (get()[key] as unknown as Row[]).find((it) => it.id === id);
    touch(key, id);
    set((s) => ({ [key]: (s[key] as unknown as Row[]).filter((it) => it.id !== id) } as Partial<StoreState>));
    const { supabase } = get();
    if (supabase) {
      const sb = createClient();
      const { error } = await sb.from(key).delete().eq("id", id);
      touch(key, id);
      if (error) {
        // Silme başarısız: kayıt listeye geri konur (iyimser silmenin geri alınması)
        if (previous) {
          set((s) => ({ [key]: [previous, ...(s[key] as unknown as Row[])] } as Partial<StoreState>));
        }
        console.error(`[${key}] delete hatası:`, error.message);
        return { ok: false, error: error.message };
      }
    }
    return { ok: true };
  },

  mergeLocal: (key, rows) => {
    for (const r of rows as unknown as Row[]) touch(key, r.id);
    set((s) => {
      const incoming = rows as unknown as Row[];
      const byId = new Map(incoming.map((r) => [r.id, r]));
      const kept = (s[key] as unknown as Row[]).map((r) => (byId.has(r.id) ? { ...r, ...byId.get(r.id)! } : r));
      const existing = new Set(kept.map((r) => r.id));
      const added = incoming.filter((r) => !existing.has(r.id));
      return { [key]: [...added, ...kept] } as Partial<StoreState>;
    });
  },

  reset: () => set({ ...seed }),

  // Örnek veriyi (seed) Supabase'e yükler — canlı DB boşken denemek için
  seedToSupabase: async () => {
    const { orgId } = get();
    if (!isSupabaseConfigured || !orgId) return { ok: false, error: "Supabase/oturum yok" };
    const sb = createClient();
    for (const c of COLLECTIONS) {
      // activity_logs: istemci yazamaz (RLS); content_approvals: karar verilmiş kayıt yazılamaz (0013 guard);
      // client_portal_tokens: örnek bağlantılar canlıya taşınmaz (0018); Müşteri Bulma: demo verisi sahte Places kimlikleri içerir.
      if (SEED_SKIP.has(c)) continue;
      const rows = (seed[c] as unknown as Row[]).map((r) => clean({ ...r, organization_id: orgId }));
      if (rows.length) {
        const { error } = await sb.from(c).insert(rows);
        if (error) return { ok: false, error: `${c}: ${error.message}` };
      }
    }
    await get().init();
    return { ok: true };
  },
}));

// ---------------------------------------------------------------------------
// Anlık görüntü yazımı: store değiştikçe (yükleme / ekleme / güncelleme) ~1 sn sonra sessionStorage'a.
// Yalnızca Supabase modunda, oturum + org varken; yalnız yüklenmiş koleksiyonlar. Sayfa kapanırken
// (pagehide) bekleyen yazım hemen yapılır. 2 MB üstü yazılmaz (snapshot.ts).
// ---------------------------------------------------------------------------

let saveTimer: ReturnType<typeof setTimeout> | undefined;

function cancelSnapshotSave() {
  clearTimeout(saveTimer);
  saveTimer = undefined;
}

/**
 * Çıkış yapılırken (form gönderilmeden hemen önce): anlık görüntüyü siler ve bu sayfa kapanana kadar
 * yeniden yazılmasını engeller. Ekrandaki veri yönlendirmeye kadar görünür kalır.
 */
export function forgetSessionSnapshot(): void {
  currentUserId = null;
  cancelSnapshotSave();
  clearSnapshots();
}

function saveSnapshotNow() {
  cancelSnapshotSave();
  const st = useStore.getState();
  if (!st.loaded || !st.supabase || !st.orgId || !currentUserId) return;
  const collections: Partial<Record<Collections, Row[]>> = {};
  for (const c of COLLECTIONS) if (st.loadedCollections[c]) collections[c] = st[c] as unknown as Row[];
  const tSave = perfStart();
  const ok = writeSnapshot({
    v: 1,
    userId: currentUserId,
    orgId: st.orgId,
    savedAt: Date.now(),
    profile: st.profile,
    organization: st.orgTargetsKnown ? st.orgTargets : null,
    collections,
  });
  perfLog(ok ? "snapshot: yazıldı" : "snapshot: atlandı (> 2 MB / depolama kapalı)", tSave);
}

if (typeof window !== "undefined" && isSupabaseConfigured) {
  useStore.subscribe((st) => {
    if (!st.loaded || !st.supabase || !st.orgId || !currentUserId) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveSnapshotNow, 1000);
  });
  window.addEventListener("pagehide", () => {
    if (saveTimer !== undefined) saveSnapshotNow();
  });
}

/**
 * Veriyi yükler (Supabase veya demo) ve oturum değişiminde yeniler.
 * Sayfalar `loaded` true olana kadar iskelet/boş gösterir.
 */
export function useHydrated(requiredCollections?: Collections[]) {
  const loaded = useStore((s) => s.loaded);
  const loadedCollections = useStore((s) => s.loadedCollections);
  const isSupabase = useStore((s) => s.supabase);

  useEffect(() => {
    if (isSupabaseConfigured) {
      const sb = createClient();
      const { data: sub } = sb.auth.onAuthStateChange((event) => {
        // Çıkış (bu ya da başka sekmede): bellekteki veri ve sekme anlık görüntüsü silinir.
        if (event === "SIGNED_OUT") resetSession();
        void useStore.getState().init();
      });
      return () => sub.subscription.unsubscribe();
    }
  }, []);

  // Çağıranlar her render'da yeni dizi geçebilir; içerik (reqStr) değişmedikçe aynı referansı koru.
  // Boş dizi ile undefined aynı sonucu verir (aşağıda ikisi de "hazır" sayılır).
  const reqStr = requiredCollections?.join(",") || "";
  const reqCols = useMemo(
    () => (reqStr ? (reqStr.split(",") as Collections[]) : undefined),
    [reqStr],
  );

  // Açılışı başlatır ve eksik koleksiyonları ister. Aynı commit'teki tüm istekler (sayfa + bileşenler)
  // tek açılış isteğinde birleşir; yüklü olanlar için istek atılmaz.
  useEffect(() => {
    void requestCollections(reqCols ?? []);
  }, [reqCols]);

  if (!loaded) return false;
  if (!isSupabase) return true; // demo mode
  if (!reqCols) return true;
  return reqCols.every((c) => loadedCollections[c]);
}
