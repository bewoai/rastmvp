"use client";

import { create } from "zustand";
import { useEffect, useMemo } from "react";
import type { RastData } from "./types";
import { seed } from "./seed";
import { isSupabaseConfigured } from "./env";
import { createClient } from "./supabase/client";

type Collections = keyof RastData;
type Row = { id: string } & Record<string, unknown>;
type MutationResult = { ok: boolean; error?: string };

export const COLLECTIONS: Collections[] = [
  "leads", "jobs", "clients", "brands", "contacts", "projects",
  "tasks", "contents", "shoots", "equipment", "invoices", "expenses",
];

const emptyData: RastData = {
  leads: [], jobs: [], clients: [], brands: [], contacts: [], projects: [],
  tasks: [], contents: [], shoots: [], equipment: [], invoices: [], expenses: [],
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
  add: <K extends Collections>(key: K, item: RastData[K][number]) => Promise<MutationResult>;
  update: <K extends Collections>(key: K, id: string, patch: Partial<RastData[K][number]>) => Promise<MutationResult>;
  remove: <K extends Collections>(key: K, id: string) => Promise<void>;
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

    const sb = createClient();
    const { data: { session } } = await sb.auth.getSession();
    const user = session?.user;

    // Supabase is configured but there is no active session: stay in demo mode
    if (!user) {
      set({ ...seed, loaded: true, supabase: false, orgId: null });
      return;
    }

    const { data: profile } = await sb
      .from("profiles")
      .select("organization_id")
      .eq("id", user.id)
      .single();
    const orgId = profile?.organization_id ?? null;

    set({ loaded: true, supabase: true, orgId });
  },

  load: async (collections) => {
    const s = get();
    if (!s.supabase || !s.orgId) return;

    const sb = createClient();
    const next: Partial<RastData> = {};
    const nextLoaded = { ...s.loadedCollections };

    await Promise.all(
      collections.map(async (c) => {
        if (s.loadedCollections[c]) return; // Zaten yüklüyse geç
        const { data } = await sb.from(c).select("*").order("created_at", { ascending: false });
        (next as Record<string, unknown>)[c] = data ?? [];
        nextLoaded[c] = true;
      }),
    );

    if (Object.keys(next).length > 0) {
      set({ ...(next as RastData), loadedCollections: nextLoaded });
    }
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
    set((s) => ({ [key]: (s[key] as unknown as Row[]).filter((it) => it.id !== id) } as Partial<StoreState>));
    const { supabase } = get();
    if (supabase) {
      const sb = createClient();
      const { error } = await sb.from(key).delete().eq("id", id);
      if (error) console.error(`[${key}] delete hatası:`, error.message);
    }
  },

  reset: () => set({ ...seed }),

  // Örnek veriyi (seed) Supabase'e yükler — canlı DB boşken denemek için
  seedToSupabase: async () => {
    const { orgId } = get();
    if (!isSupabaseConfigured || !orgId) return { ok: false, error: "Supabase/oturum yok" };
    const sb = createClient();
    for (const c of COLLECTIONS) {
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

  const reqStr = requiredCollections?.join(",") || "";
  const reqCols = useMemo(() => requiredCollections, [reqStr]);

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
