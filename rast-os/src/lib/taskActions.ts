"use client";

import { useStore } from "./store";
import type { MutationResult } from "./store";
import { useToasts } from "./toast";
import type { Task } from "./types";

const failMessage = (r: MutationResult, fallback: string) => r.error || fallback;

/**
 * Görevi iyimser ekler: store.add görevi state'e ANINDA yazar, Supabase insert'ü arkadan gider.
 * Hata olursa store kaydı geri alır; burada yalnızca kullanıcıyı bilgilendiririz.
 * Oturum henüz başlatılmadıysa (Q ile herhangi bir sayfadan) önce init beklenir; aksi halde
 * kayıt yalnızca bellekte kalırdı. Liste yeniden çekilmez.
 */
export function createTask(task: Task): Promise<MutationResult> {
  const st = useStore.getState();
  const run = () => useStore.getState().add("tasks", task);
  const started = st.loaded ? run() : st.init().then(run);
  return started
    .catch((e: unknown) => ({ ok: false, error: e instanceof Error ? e.message : String(e) }))
    .then((r) => {
      if (!r.ok) useToasts.getState().push({ message: failMessage(r, "Görev eklenemedi."), tone: "danger" });
      return r;
    });
}

/** Tek görev alanı güncelle (iyimser; hata olursa store geri alır, biz uyarırız). */
export function patchTask(id: string, patch: Partial<Task>): void {
  useStore
    .getState()
    .update("tasks", id, patch)
    .catch((e: unknown) => ({ ok: false, error: e instanceof Error ? e.message : String(e) }))
    .then((r) => {
      if (!r.ok) useToasts.getState().push({ message: failMessage(r, "Görev güncellenemedi."), tone: "danger" });
    });
}
