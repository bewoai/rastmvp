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
  /** Görevler ekranı "Bana atanan" görünümündeyken oturumdaki kullanıcı (yeni görev listeden kaybolmasın). Boş = atanmamış. */
  defaultAssignee: string;
  openComposer: () => void;
  closeComposer: () => void;
  setDefaultDue: (due: string) => void;
  setDefaultAssignee: (id: string) => void;
}

export const useQuickAdd = create<QuickAddState>()((set) => ({
  open: false,
  defaultDue: "",
  defaultAssignee: "",
  openComposer: () => set({ open: true }),
  closeComposer: () => set({ open: false }),
  setDefaultDue: (defaultDue) => set({ defaultDue }),
  setDefaultAssignee: (defaultAssignee) => set({ defaultAssignee }),
}));
