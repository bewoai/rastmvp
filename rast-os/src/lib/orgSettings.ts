"use client";

// Organizasyon hedefleri (0014): MRR eşiği (mrr_target) ve adı (mrr_target_label).
// - Supabase modu: organizations satırından okunur / yalnızca admin yazar (RLS + kolon yetkisi).
// - Demo modu: tarayıcıda (localStorage) tutulur; varsayılan eşik 90.000 TL.
import { create } from "zustand";
import { useEffect } from "react";
import { createClient } from "./supabase/client";
import { useStore } from "./store";

export const DEFAULT_MRR_LABEL = "Hastaneden ayrılma eşiği";
const DEMO_KEY = "rast-org-targets";
const DEMO_DEFAULT = { target: 90000 as number | null, label: DEFAULT_MRR_LABEL };

interface OrgSettingsState {
  loaded: boolean;
  target: number | null;
  label: string;
  /** Düzenleme yetkisi: demo'da herkes, Supabase'de yalnızca profiles.role = 'admin'. */
  canEdit: boolean;
  load: () => Promise<void>;
  save: (target: number | null, label: string) => Promise<{ ok: boolean; error?: string }>;
}

function readDemo(): { target: number | null; label: string } {
  try {
    const raw = localStorage.getItem(DEMO_KEY);
    if (raw) {
      const p = JSON.parse(raw) as { target?: unknown; label?: unknown };
      const t = Number(p.target);
      return {
        target: p.target === null ? null : Number.isFinite(t) && t > 0 ? t : DEMO_DEFAULT.target,
        label: typeof p.label === "string" && p.label.trim() ? p.label : DEFAULT_MRR_LABEL,
      };
    }
  } catch {
    /* localStorage kapalı/bozuk: varsayılan */
  }
  return { ...DEMO_DEFAULT };
}

export const useOrgSettings = create<OrgSettingsState>()((set) => ({
  loaded: false,
  target: null,
  label: DEFAULT_MRR_LABEL,
  canEdit: false,

  load: async () => {
    const { supabase, orgId, profile, orgTargets, orgTargetsKnown } = useStore.getState();
    if (!supabase || !orgId) {
      set({ ...readDemo(), canEdit: true, loaded: true });
      return;
    }
    // Açılış isteği (0020 app_bootstrap) hedefleri ve rolü zaten getirdiyse ek istek yok.
    if (orgTargetsKnown) {
      set({
        target: orgTargets?.mrr_target ?? null,
        label: orgTargets?.mrr_target_label?.trim() || DEFAULT_MRR_LABEL,
        canEdit: profile?.role === "admin",
        loaded: true,
      });
      return;
    }
    const sb = createClient();
    const { data: sess } = await sb.auth.getSession();
    const uid = sess.session?.user.id;
    const [org, prof] = await Promise.all([
      sb.from("organizations").select("mrr_target, mrr_target_label").eq("id", orgId).maybeSingle(),
      uid ? sb.from("profiles").select("role").eq("id", uid).maybeSingle() : Promise.resolve({ data: null }),
    ]);
    // 0014 uygulanmadıysa org.error olur: hedef yok say (kart "Eşik belirle" gösterir).
    const t = org.data?.mrr_target;
    const target = t === null || t === undefined || !Number.isFinite(Number(t)) ? null : Number(t);
    const label = (org.data?.mrr_target_label as string | null | undefined)?.trim() || DEFAULT_MRR_LABEL;
    set({ target, label, canEdit: (prof.data as { role?: string } | null)?.role === "admin", loaded: true });
  },

  save: async (target, label) => {
    const clean = label.trim() || DEFAULT_MRR_LABEL;
    if (target !== null && (!Number.isFinite(target) || target < 0)) return { ok: false, error: "Geçersiz tutar." };
    const { supabase, orgId } = useStore.getState();
    if (!supabase || !orgId) {
      try {
        localStorage.setItem(DEMO_KEY, JSON.stringify({ target, label: clean }));
      } catch {
        /* yazılamadı: yalnızca bellekte güncellenir */
      }
      set({ target, label: clean });
      return { ok: true };
    }
    if (!useOrgSettings.getState().canEdit) return { ok: false, error: "Yalnızca yönetici hedefi değiştirebilir." };
    const sb = createClient();
    const { error } = await sb
      .from("organizations")
      .update({ mrr_target: target, mrr_target_label: clean })
      .eq("id", orgId);
    if (error) return { ok: false, error: error.message };
    set({ target, label: clean });
    // Store'daki açılış kopyası da güncellenir (sayfa yeniden açılınca eski değer görünmesin).
    useStore.setState({ orgTargets: { mrr_target: target, mrr_target_label: clean } });
    return { ok: true };
  },
}));

/** Org hedeflerini (oturum/mod hazır olunca) yükler. Çağıran sayfa `useHydrated` kullanmalıdır. */
export function useOrgTargets(hydrated: boolean) {
  const supabase = useStore((s) => s.supabase);
  const orgId = useStore((s) => s.orgId);
  const orgTargets = useStore((s) => s.orgTargets);
  const load = useOrgSettings((s) => s.load);
  useEffect(() => {
    if (hydrated) void load();
  }, [hydrated, supabase, orgId, orgTargets, load]);
  return useOrgSettings();
}
