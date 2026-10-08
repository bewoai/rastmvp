"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { Currency } from "./types";

interface FxState {
  usd: number;
  eur: number;
  updated: string;
  setRate: (k: "usd" | "eur", v: number) => void;
}

// Döviz kurları — tarayıcıda tutulur (yerel ayar). Ayarlar'dan güncellenir.
export const useFx = create<FxState>()(
  persist(
    (set) => ({
      usd: 46,
      eur: 50,
      updated: "",
      setRate: (k, v) => {
        if (!Number.isFinite(v) || v <= 0) return;
        set({ [k]: v, updated: new Date().toISOString().slice(0, 10) } as Partial<FxState>);
      },
    }),
    { name: "rast-fx", storage: createJSONStorage(() => localStorage) },
  ),
);

// Çevrim mantığı saf modülde (testli): src/lib/finance.ts
export { toTRY } from "./finance";

export const CURRENCIES: Currency[] = ["TRY", "USD", "EUR"];
export const currencySymbol: Record<Currency, string> = { TRY: "₺", USD: "$", EUR: "€" };

export function money(amount: number | undefined, currency: Currency = "TRY"): string {
  return new Intl.NumberFormat("tr-TR", {
    style: "currency",
    currency,
    maximumFractionDigits: currency === "TRY" ? 0 : 2,
  }).format(amount ?? 0);
}
