"use client";

import { create } from "zustand";

/**
 * Global Hızlı Görev Ekle durumu. Yalnızca "açık mı" ve varsayılan son tarih tutulur;
 * yazılan metin/form alanları composer'ın kendi içinde yaşar (sayfayı render etmez).
 */
interface QuickAddState {
  open: boolean;
  /** Görevler ekranı, aktif görünüme göre ("Bugün" -> bugün) ayarlar. Boş = tarihsiz. */
  defaultDue: string;
  openComposer: () => void;
  closeComposer: () => void;
  setDefaultDue: (due: string) => void;
}

export const useQuickAdd = create<QuickAddState>()((set) => ({
  open: false,
  defaultDue: "",
  openComposer: () => set({ open: true }),
  closeComposer: () => set({ open: false }),
  setDefaultDue: (defaultDue) => set({ defaultDue }),
}));
