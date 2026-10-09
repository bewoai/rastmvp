"use client";

import { create } from "zustand";
import { useEffect, useMemo } from "react";
import type { RastData, WritableCollection } from "./types";
import { seed } from "./seed";
import { isAuthRequired, isSupabaseConfigured } from "./env";
import { createClient } from "./supabase/client";
import { perfLog, perfStart } from "./perf";
import { isRpcMissing, mergeRows, parseBootstrap } from "./bootstrap-logic";
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
];

/** seedToSupabase'in atladığı koleksiyonlar (demo Müşteri Bulma verisi sahte Places kimlikleri içerir). */
const SEED_SKIP = new Set<Collections>(["activity_logs", "content_approvals", "client_portal_tokens", "prospects", "outreach_sequences", "outreach_messages", "suppression_list"]);

/** Tek seferde çekilecek en fazla işlem geçmişi satırı (en yeniler). 0020 app_bootstrap ile aynı. */
const ACTIVITY_LOG_LIMIT = 500;

const emptyData: RastData = {
  leads: [], jobs: [], clients: [], brands: [], contacts: [], projects: [],
  tasks: [], contents: [], shoots: [], equipment: [], invoices: [], payments: [], expenses: [],
  proposals: [], proposal_items: [], content_approvals: [], client_reports: [], client_portal_tokens: [], activity_logs: [],
  prospects: [], outreach_sequences: [], outreach_messages: [], suppression_list: [],
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

interface Fetched {
  rows: Partial<Record<Collections, Row[]>>;
  /** undefined: bu çekimde profil istenmedi. */
  profile?: BootstrapProfile | null;
  /** undefined: bilinmiyor (eski yol). */
  organization?: BootstrapOrganization | null;
  startSeq: number;
}

/** Eski yol: tablo başına `select *` (paralel). Profil istenirse o da aynı turda. */
async function fetchLegacy(cols: Collections[], userId: string | null, startSeq: number): Promise<Fetched> {
  const sb = createClient();
  const t0 = perfStart();
  const rows: Partial<Record<Collections, Row[]>> = {};
  const profileQuery = userId
    ? sb.from("profiles").select("organization_id, role, full_name").eq("id", userId).single()
    : null;
  await Promise.all(
    cols.map(async (c) => {
      const tTable = perfStart();
      const query = sb.from(c).select("*").order("created_at", { ascending: false });
      const { data } = await (c === "activity_logs" ? query.limit(ACTIVITY_LOG_LIMIT) : query);
      rows[c] = (data ?? []) as Row[];
      perfLog(`load: ${c}`, tTable, { rows: rows[c]!.length });
    }),
  );
  let profile: BootstrapProfile | null | undefined;
  if (profileQuery) {
    const { data } = await profileQuery;
    const p = data as { organization_id?: string | null; role?: string | null; full_name?: string | null } | null;
    profile = p ? { organization_id: p.organization_id ?? null, role: p.role ?? null, full_name: p.full_name ?? null } : null;
  }
  perfLog("load: eski yol toplam (paralel)", t0, { requests: cols.length + (userId ? 1 : 0), collections: cols });
  return { rows, profile, startSeq };
}

/** Koleksiyonları (ve istenirse profili) çeker: önce 0020 RPC (1 istek), olmazsa eski yol. */
async function fetchRemote(cols: Collections[], userId: string | null): Promise<Fetched> {
  const startSeq = changeSeq;
  if (rpcEnabled()) {
    const t0 = perfStart();
    const { data, error } = await createClient().rpc("app_bootstrap", { p_collections: cols });
    if (!error) {
      const parsed = parseBootstrap(data, cols);
      if (parsed) {
        perfLog("bootstrap: app_bootstrap (1 istek)", t0, { collections: cols });
        return { rows: parsed.rows, profile: parsed.profile, organization: parsed.organization, startSeq };
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

/** `fetchRemote` + uçuştaki istek kaydı (aynı koleksiyon iki kez istenmez). */
async function runFetch(cols: Collections[], userId: string | null, onDone: (f: Fetched) => void): Promise<void> {
  activeFetches++;
  const job = fetchRemote(cols, userId).then(onDone);
  const tracked = job.catch(() => undefined);
  for (const c of cols) inflight.set(c, tracked);
  try {
    await job;
  } finally {
    for (const c of cols) if (inflight.get(c) === tracked) inflight.delete(c);
    activeFetches--;
    // Uçuşta çekim yoksa eski işaretler artık hiçbir birleştirmeyi etkilemez.
    if (activeFetches === 0) touched.clear();
  }
}

async function runInit(): Promise<void> {
  const tInit = perfStart();
  const sb = createClient();
  const { data: { session } } = await sb.auth.getSession();
  perfLog("init: getSession (yerel; süresi dolmuşsa yenileme ağ çağrısı)", tInit);
  const user = session?.user;

  // Supabase yapılandırılmış ama oturum yok. Giriş zorunluyken (varsayılan) proxy bu
  // sayfalara oturumsuz erişime izin vermez; buraya yalnızca istemci tarafında oturum
  // düşerse gelinir — gerçek veri gibi görünen örnek veriyi göstermek yerine boş kal.
  // Örnek (demo) veri yalnızca açıkça NEXT_PUBLIC_REQUIRE_AUTH=false iken gösterilir.
  if (!user) {
    pending.clear();
    useStore.setState({ ...(isAuthRequired ? emptyData : seed), loaded: true, supabase: false, orgId: null });
    return;
  }

  // O ana kadar sayfaların istediği tüm koleksiyonlar + profil: TEK istek.
  const cols = [...pending];
  pending.clear();
  await runFetch(cols, user.id, (f) => {
    const orgId = f.profile?.organization_id ?? null;
    applyRows(f, {
      loaded: true,
      supabase: true,
      orgId,
      profile: f.profile ?? null,
      orgTargets: f.organization ?? null,
      orgTargetsKnown: f.organization !== undefined,
    });
  });
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
  const cols = [...pending].filter((c) => !useStore.getState().loadedCollections[c] && !inflight.has(c));
  pending.clear();
  if (cols.length === 0) return;
  if (!st.supabase || !st.orgId) {
    // Org'a bağlı olmayan oturum: RLS hiçbir satır döndürmez — boş ama "yüklendi" say (sonsuz iskelet olmasın).
    applyRows({ rows: Object.fromEntries(cols.map((c) => [c, []])), startSeq: changeSeq });
    return;
  }
  await runFetch(cols, null, (f) => applyRows(f));
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
    flushScheduled ??= Promise.resolve().then(() => {
      flushScheduled = null;
      return flushPending();
    });
    waits.push(flushScheduled);
  }
  return Promise.all(waits).then(() => undefined);
}

export const useStore = create<StoreState>()((set, get) => ({
  ...emptyData,
  loaded: false,
  supabase: false,
  orgId: null,
  profile: null,
  orgTargets: null,
  orgTargetsKnown: false,
  loadedCollections: noneLoaded(),

  init: async () => {
    // Supabase yoksa: bellek içi örnek verilerle çalış (demo modu)
    if (!isSupabaseConfigured) {
      set({ ...seed, loaded: true, supabase: false });
      return;
    }

    if (get().loaded && get().orgId !== null) {
      return;
    }

    initPromise ??= runInit().finally(() => {
      initPromise = null;
    });
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
      const { data: sub } = sb.auth.onAuthStateChange(() => {
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
