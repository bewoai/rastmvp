"use client";

// Son yüklenen verinin sekme oturumu boyunca saklanan anlık görüntüsü (stale-while-revalidate).
// - sessionStorage: yalnızca bu sekme; sekme kapanınca silinir (localStorage'a hassas veri yazılmaz).
// - Anahtar kullanıcıya göre; içinde org kimliği var, okurken ikisi de doğrulanır (bootstrap-logic → parseSnapshot).
// - 2 MB üstü yazılmaz (varsa eskisi de silinir). Çıkışta / giriş sayfasında silinir.
import { parseSnapshot, serializeSnapshot } from "./bootstrap-logic";
import type { Collection, Snapshot } from "./bootstrap-logic";

const PREFIX = "rast-os:snapshot:v1:";

export function readSnapshot(userId: string, allowed: readonly Collection[]): Snapshot | null {
  try {
    return parseSnapshot(sessionStorage.getItem(PREFIX + userId), userId, Date.now(), allowed);
  } catch {
    return null;
  }
}

/** Yazar; sığmazsa (> 2 MB / kota) mevcut kaydı siler ve false döner. */
export function writeSnapshot(snap: Snapshot): boolean {
  const key = PREFIX + snap.userId;
  const json = serializeSnapshot(snap);
  try {
    if (json === null) {
      sessionStorage.removeItem(key);
      return false;
    }
    sessionStorage.setItem(key, json);
    return true;
  } catch {
    try {
      sessionStorage.removeItem(key);
    } catch {
      /* depolama kapalı */
    }
    return false;
  }
}

/** Bu sekmedeki tüm anlık görüntüleri siler (çıkış, giriş sayfası, oturum düşmesi). */
export function clearSnapshots(): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k?.startsWith(PREFIX)) keys.push(k);
    }
    for (const k of keys) sessionStorage.removeItem(k);
  } catch {
    /* depolama kapalı */
  }
}
