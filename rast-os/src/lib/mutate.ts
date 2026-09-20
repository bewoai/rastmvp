"use client";

import { useStore } from "./store";
import type { MutationResult } from "./store";
import { useToasts } from "./toast";
import type { RastData } from "./types";

type Collections = keyof RastData;

/**
 * Satır içi (inline) alan güncellemesi: store.update iyimser yazar ve hata olursa eski değere döner;
 * burada kullanıcıya hatayı gösteririz (önceden sessizce geri dönüyordu). Liste yeniden çekilmez.
 */
export function patchRecord<K extends Collections>(
  key: K,
  id: string,
  patch: Partial<RastData[K][number]>,
  failMessage = "Güncellenemedi",
): void {
  useStore
    .getState()
    .update(key, id, patch)
    .catch((e: unknown): MutationResult => ({ ok: false, error: e instanceof Error ? e.message : String(e) }))
    .then((r) => {
      if (!r.ok) useToasts.getState().push({ message: r.error ? `${failMessage}: ${r.error}` : failMessage, tone: "danger" });
    });
}
