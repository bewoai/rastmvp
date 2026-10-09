"use client";

import { create } from "zustand";
import { useEffect, useMemo } from "react";
import type { RastData, WritableCollection } from "./types";
import { seed } from "./seed";
import { isAuthRequired, isSupabaseConfigured } from "./env";
import { createClient } from "./supabase/client";
import { perfLog, perfStart } from "./perf";

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

/** Tek seferde çekilecek en fazla işlem geçmişi satırı (en yeniler). */
const ACTIVITY_LOG_LIMIT = 500;

const emptyData: RastData = {
  leads: [], jobs: [], clients: [], brands: [], contacts: [], projects: [],
  tasks: [], contents: [], shoots: [], equipment: [], invoices: [], payments: [], expenses: [],
  proposals: [], proposal_items: [], content_approvals: [], client_reports: [], client_portal_tokens: [], activity_logs: [],
  prospects: [], outreach_sequences: [], outreach_messages: [], suppression_list: [],
};

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
  initStarted: boolean;
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

export const useStore = create<StoreState>()((set, get) => ({
  ...emptyData,
  loaded: false,
  supabase: false,
  orgId: null,
  initStarted: false,
  loadedCollections: COLLECTIONS.reduce((acc, c) => ({ ...acc, [c]: false }), {} as Record<Collections, boolean>),

    init: async () => {
    // Supabase yoksa: bellek içi örnek verilerle çalış (demo modu)
    if (!isSupabaseConfigured) {
      set({ ...seed, loaded: true, supabase: false });
      return;
    }

    if (get().loaded && get().orgId !== null) {
      return;
    }

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
      set({ ...(isAuthRequired ? emptyData : seed), loaded: true, supabase: false, orgId: null });
      return;
    }

    const tProfile = perfStart();
    const { data: profile } = await sb
      .from("profiles")
      .select("organization_id")
      .eq("id", user.id)
      .single();
    const orgId = profile?.organization_id ?? null;
    perfLog("init: profiles (1 istek)", tProfile);

    set({ loaded: true, supabase: true, orgId });
    perfLog("init: toplam", tInit, { requests: 1 });
  },

  load: async (collections) => {
    const s = get();
    if (!s.supabase || !s.orgId) return;

    const tLoad = perfStart();
    const sb = createClient();
    const fetched: Partial<Record<Collections, Row[]>> = {};

    await Promise.all(
      collections.map(async (c) => {
        if (s.loadedCollections[c]) return; // Zaten yüklüyse geç
        const tTable = perfStart();
        const query = sb.from(c).select("*").order("created_at", { ascending: false });
        const { data } = await (c === "activity_logs" ? query.limit(ACTIVITY_LOG_LIMIT) : query);
        fetched[c] = (data ?? []) as Row[];
        perfLog(`load: ${c}`, tTable, { rows: fetched[c]!.length });
      }),
    );
    perfLog("load: toplam (paralel)", tLoad, { requests: Object.keys(fetched).length, collections: Object.keys(fetched) });

    const keys = Object.keys(fetched) as Collections[];
    if (keys.length === 0) return;

    // Yükleme sürerken eklenen (iyimser) kayıtlar — ör. başka sayfadan global Hızlı Ekle —
    // gelen listeyle ezilmesin; state en güncel haliyle okunur.
    const cur = get();
    const next: Partial<RastData> = {};
    const nextLoaded = { ...cur.loadedCollections };
    for (const c of keys) {
      const rows = fetched[c]!;
      const ids = new Set(rows.map((r) => r.id));
      const pending = (cur[c] as unknown as Row[]).filter((r) => !ids.has(r.id));
      (next as Record<string, unknown>)[c] = [...pending, ...rows];
      nextLoaded[c] = true;
    }
    set({ ...(next as RastData), loadedCollections: nextLoaded });
  },

  add: async (key, item) => {
    const current = get();
    if (current.supabase && !current.orgId) {
      return { ok: false, error: "Hesabınız bir organizasyona bağlı değil. Lütfen yöneticiyle iletişime geçin." };
    }
    set((s) => ({ [key]: [item, ...(s[key] as unknown[])] } as Partial<StoreState>));
    const { supabase, orgId } = get();
    if (supabase) {
      const sb = createClient();
      const row = clean({ ...(item as unknown as Row), organization_id: orgId });
      const { error } = await sb.from(key).insert(row);
      if (error) {
        set((s) => ({ [key]: (s[key] as unknown as Row[]).filter((it) => it.id !== (item as unknown as Row).id) } as Partial<StoreState>));
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
    set((s) => ({
      [key]: (s[key] as unknown as Row[]).map((it) => (it.id === id ? { ...it, ...patch } : it)),
    } as Partial<StoreState>));
    const { supabase } = get();
    if (supabase) {
      const sb = createClient();
      const { error } = await sb.from(key).update(clean(patch as Record<string, unknown>)).eq("id", id);
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
    set((s) => ({ [key]: (s[key] as unknown as Row[]).filter((it) => it.id !== id) } as Partial<StoreState>));
    const { supabase } = get();
    if (supabase) {
      const sb = createClient();
      const { error } = await sb.from(key).delete().eq("id", id);
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
  const load = useStore((s) => s.load);
  const isSupabase = useStore((s) => s.supabase);

  useEffect(() => {
    const st = useStore.getState();
    if (!st.initStarted) {
      useStore.setState({ initStarted: true });
      st.init();
    }
    if (isSupabaseConfigured) {
      const sb = createClient();
      const { data: sub } = sb.auth.onAuthStateChange(() => {
        useStore.getState().init();
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

  useEffect(() => {
    if (loaded && isSupabase && reqCols) {
      const missing = reqCols.filter((c) => !useStore.getState().loadedCollections[c]);
      if (missing.length > 0) {
        load(missing);
      }
    }
  }, [loaded, isSupabase, reqCols, load]);

  if (!loaded) return false;
  if (!isSupabase) return true; // demo mode
  if (!reqCols) return true;
  return reqCols.every((c) => loadedCollections[c]);
}
