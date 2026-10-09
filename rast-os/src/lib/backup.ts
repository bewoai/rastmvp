"use client";

// Yedek indirme (istemci): oturumdaki kullanıcının Supabase istemcisiyle (RLS altında) tüm koleksiyonları
// çekip tek JSON dosyası olarak indirir. "Son yedek" zamanı yalnızca bu tarayıcıda (localStorage) tutulur.
import { useSyncExternalStore } from "react";
import { COLLECTIONS, useStore } from "./store";
import { createClient } from "./supabase/client";
import { useNowMs } from "./useNowMs";
import {
  LAST_BACKUP_KEY,
  backupAgeLabel,
  backupFileName,
  buildBackup,
  isBackupStale,
  type BackupClient,
} from "./backup-logic";

const CHANGE_EVENT = "rast-backup-changed";

/** Yedeklenen tablolar: ekip listesi (profiles) auth.users'a bağlı, yedekten geri yüklenemez — dışarıda. */
const BACKUP_COLLECTIONS = COLLECTIONS.filter((c) => c !== "profiles");

function readLastBackup(): string | null {
  try {
    return localStorage.getItem(LAST_BACKUP_KEY);
  } catch {
    return null; // localStorage kapalı/erişilemez
  }
}

function writeLastBackup(iso: string) {
  try {
    localStorage.setItem(LAST_BACKUP_KEY, iso);
  } catch {
    /* yazılamadı: uyarı bir sonraki açılışta yine görünür */
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function subscribe(cb: () => void) {
  window.addEventListener(CHANGE_EVENT, cb);
  window.addEventListener("storage", cb); // başka sekmede yedek alındıysa
  return () => {
    window.removeEventListener(CHANGE_EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

/** Son yedek zamanı (ISO) ve yaş bilgisi. SSR'da null döner; hidrasyonda yeniden okunur. */
export function useLastBackup() {
  const iso = useSyncExternalStore(subscribe, readLastBackup, () => null);
  const nowMs = useNowMs(60 * 60 * 1000);
  return { iso, label: backupAgeLabel(iso, nowMs), stale: isBackupStale(iso, nowMs) };
}

export interface BackupResult {
  ok: boolean;
  /** Çekilemeyen tablolar varsa (dosya yine de indirilir; "son yedek" tarihi güncellenmez). */
  failed: string[];
  rowCount: number;
  error?: string;
}

/** Tüm koleksiyonları çeker ve rast-os-yedek-YYYY-MM-DD.json olarak indirir. */
export async function downloadBackup(onProgress?: (done: number, total: number, table: string) => void): Promise<BackupResult> {
  const { supabase, orgId } = useStore.getState();
  if (!supabase || !orgId) {
    return { ok: false, failed: [], rowCount: 0, error: "Yedek yalnızca Supabase oturumu açıkken alınabilir." };
  }
  try {
    const client = createClient() as unknown as BackupClient;
    const now = new Date();
    const payload = await buildBackup(client, BACKUP_COLLECTIONS, orgId, now, onProgress);
    const failed = Object.keys(payload.errors ?? {});
    // Hiçbir tablo çekilemediyse (ör. ağ yok) boş bir dosya indirmeyelim.
    if (failed.length === BACKUP_COLLECTIONS.length) {
      return { ok: false, failed, rowCount: 0, error: "Veriler okunamadı. Bağlantını ve yetkini kontrol edip tekrar dene." };
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = backupFileName(now);
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    if (failed.length === 0) writeLastBackup(now.toISOString());
    const rowCount = Object.values(payload.tables).reduce((n, rows) => n + rows.length, 0);
    return { ok: failed.length === 0, failed, rowCount };
  } catch (e) {
    return { ok: false, failed: [], rowCount: 0, error: e instanceof Error ? e.message : "Yedek alınamadı." };
  }
}
