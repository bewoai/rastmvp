"use client";

import { create } from "zustand";
import { useEffect } from "react";
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
  init: () => Promise<void>;
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

  init: async () => {
    // Supabase yoksa: bellek içi örnek verilerle çalış (demo modu)
    if (!isSupabaseConfigured) {
      set({ ...seed, loaded: true, supabase: false });
      return;
    }

    const sb = createClient();
    const { data: { user } } = await sb.auth.getUser();

    // Supabase is configured but there is no active session: stay in demo mode
    // instead of attempting RLS-protected writes with a null organization.
    if (!user) {
      set({ ...seed, loaded: true, supabase: false, orgId: null });
      return;
    }

    let orgId: string | null = null;
    if (user) {
      const { data: profile } = await sb
        .from("profiles")
        .select("organization_id")
        .eq("id", user.id)
        .single();
      orgId = profile?.organization_id ?? null;
    }

    // Tüm koleksiyonları çek
    const next: Partial<RastData> = {};
    await Promise.all(
      COLLECTIONS.map(async (c) => {
        const { data } = await sb.from(c).select("*").order("created_at", { ascending: false });
        (next as Record<string, unknown>)[c] = data ?? [];
      }),
    );

    if (!orgId) {
      set({ ...emptyData, loaded: true, supabase: true, orgId: null });
      return;
    }

    set({ ...(next as RastData), loaded: true, supabase: true, orgId });
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
export function useHydrated() {
  const loaded = useStore((s) => s.loaded);

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

  return loaded;
}
