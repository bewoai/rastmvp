"use client";

// Bildirim zili verisi: store'daki koleksiyonlardan türetilir (ek istek yok — hepsi açılış isteğinin
// çekirdek kümesinde), okundu durumu bu tarayıcıda localStorage'da. Sekme başlığına "(n) " öneki.
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { useStore } from "./store";
import { NOTIFICATION_COLLECTIONS } from "./bootstrap-logic";
import { countUnread, deriveNotices, mergeReadIds, parseReadIds, titleWithCount, type Notice } from "./notifications";
import { useNowMs } from "./useNowMs";

const READ_KEY = "rast:notifications-read";
const EMPTY: string[] = [];
const listeners = new Set<() => void>();
let cache: string[] | null = null;

function readIds(): string[] {
  if (cache === null) {
    try {
      cache = parseReadIds(window.localStorage.getItem(READ_KEY));
    } catch {
      cache = []; // localStorage kapalı (gizli pencere / engelli): yalnız bu sayfa ömrü boyunca hatırlanır
    }
  }
  return cache;
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key === READ_KEY) {
      cache = null; // başka sekmede okundu işaretlendi
      cb();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}

function markRead(ids: readonly string[]) {
  if (!ids.length) return;
  const next = mergeReadIds(readIds(), ids);
  cache = next;
  try {
    window.localStorage.setItem(READ_KEY, JSON.stringify(next));
  } catch {
    /* yazılamadı: bellekte kalır */
  }
  for (const l of listeners) l();
}

export interface NotificationsState {
  /** Bildirimlerin türetildiği koleksiyonlar yüklendi mi (değilse liste boş, sayı 0). */
  ready: boolean;
  notices: Notice[];
  unread: number;
  isRead: (id: string) => boolean;
  markRead: (ids: readonly string[]) => void;
  /** Bildirim zamanlarını göstermek için "şimdi" (dakikada bir tazelenir). */
  nowMs: number;
}

export function useNotifications(): NotificationsState {
  const ready = useStore((s) => s.loaded && (!s.supabase || NOTIFICATION_COLLECTIONS.every((c) => s.loadedCollections[c])));
  const invoices = useStore((s) => s.invoices);
  const expenses = useStore((s) => s.expenses);
  const tasks = useStore((s) => s.tasks);
  const contents = useStore((s) => s.contents);
  const leads = useStore((s) => s.leads);
  const approvals = useStore((s) => s.content_approvals);
  const proposals = useStore((s) => s.proposals);
  const clients = useStore((s) => s.clients);
  const nowMs = useNowMs(60_000);
  const read = useSyncExternalStore(subscribe, readIds, () => EMPTY);

  // Koleksiyonları iste: hepsi çekirdekte olduğundan açılış isteğine katılır / uçuştakini bekler (yeni tur yok).
  useEffect(() => {
    void useStore.getState().load(NOTIFICATION_COLLECTIONS);
  }, []);

  const notices = useMemo(
    () => (ready && nowMs
      ? deriveNotices({ invoices, expenses, tasks, contents, leads, content_approvals: approvals, proposals, clients }, new Date(nowMs))
      : []),
    [ready, invoices, expenses, tasks, contents, leads, approvals, proposals, clients, nowMs],
  );
  const readSet = useMemo(() => new Set(read), [read]);
  const unread = countUnread(notices, readSet);

  // Sekme başlığı: "(n) Görevler · Rast OS". Next sayfa geçişinde başlığı yeniden yazar → gözlemci öneki geri koyar.
  useEffect(() => {
    const apply = () => {
      const next = titleWithCount(document.title, unread);
      if (next !== document.title) document.title = next;
    };
    apply();
    const obs = new MutationObserver(apply);
    obs.observe(document.head, { subtree: true, childList: true, characterData: true });
    return () => obs.disconnect();
  }, [unread]);

  return { ready, notices, unread, isRead: (id) => readSet.has(id), markRead, nowMs };
}
