"use client";

import { create } from "zustand";

export interface Toast {
  id: number;
  message: string;
  tone: "default" | "danger";
  href?: string;
  hrefLabel?: string;
}

interface ToastState {
  toasts: Toast[];
  push: (t: Omit<Toast, "id" | "tone"> & { tone?: Toast["tone"] }) => void;
  dismiss: (id: number) => void;
}

let nextId = 1;

export const useToasts = create<ToastState>()((set, get) => ({
  toasts: [],
  push: (t) => {
    const id = nextId++;
    const tone = t.tone ?? "default";
    set((s) => ({ toasts: [...s.toasts.slice(-2), { ...t, id, tone }] }));
    setTimeout(() => get().dismiss(id), tone === "danger" ? 6000 : 3500);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));
