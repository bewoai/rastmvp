"use client";

import { useStore, uid, nowISO } from "./store";
import type { MutationResult } from "./store";
import type { Content, ContentApproval } from "./types";
import { createClient } from "./supabase/client";
import { expiresAtFrom, generateToken, newChecklist, nextVersion } from "./approval-logic";

const fail = (e: unknown): MutationResult => ({ ok: false, error: e instanceof Error ? e.message : String(e) });

// Eşzamanlı gönderimde aynı sürüm (content_approvals_content_version_unique) → sıradakiyle dene.
const isDuplicateVersion = (message?: string) => /content_version_unique|duplicate key|23505/i.test(message ?? "");

/**
 * İçeriği onaya gönderir: yeni sürüm (v1, v2…) + gizli token oluşturur. Senaryo ve başlık gönderim
 * anındaki halleriyle kaydedilir; kontrol listesi işaretsiz başlar. Aynı içeriğin bekleyen eski
 * sürümleri geri çekilir (expired) — hekim yalnızca en son metni onaylayabilir.
 *
 * Supabase: token, kontrol listesi ve tarihleri veritabanı üretir (0013 guard trigger); satır
 * `insert … select` ile geri okunur. Demo: aynı değerler tarayıcıda üretilir (yalnızca bellekte).
 */
export async function sendForApproval(content: Pick<Content, "id" | "title" | "script">): Promise<MutationResult & { approval?: ContentApproval }> {
  const { supabase, orgId } = useStore.getState();
  if (supabase && !orgId) {
    return { ok: false, error: "Hesabınız bir organizasyona bağlı değil. Lütfen yöneticiyle iletişime geçin." };
  }

  const now = nowISO();
  const base = {
    content_id: content.id,
    title: content.title.trim(),
    script_snapshot: content.script?.trim() ? content.script : null,
    status: "pending" as const,
  };
  let approval: ContentApproval | undefined;

  if (supabase) {
    const sb = createClient();
    let version = nextVersion(useStore.getState().content_approvals, content.id);
    let lastError = "Onay talebi oluşturulamadı.";
    for (let attempt = 0; attempt < 3 && !approval; attempt++) {
      const { data, error } = await sb
        .from("content_approvals")
        .insert({ ...base, id: uid(), version, organization_id: orgId })
        .select("*")
        .single();
      if (!error && data) {
        approval = data as ContentApproval;
        break;
      }
      lastError = error?.message ?? lastError;
      if (!isDuplicateVersion(lastError)) break;
      version++;
    }
    if (!approval) {
      console.error("[content_approvals] insert hatası:", lastError);
      return { ok: false, error: /content_approvals|relation .* does not exist/i.test(lastError) ? `${lastError} (0013_content_approvals.sql uygulanmış mı?)` : lastError };
    }
  } else {
    approval = {
      ...base,
      id: uid(),
      version: nextVersion(useStore.getState().content_approvals, content.id),
      token: generateToken(),
      checklist: newChecklist(),
      note: null,
      sent_at: now,
      expires_at: expiresAtFrom(now),
      created_at: now,
    };
  }

  const created = approval;
  const older = useStore
    .getState()
    .content_approvals.filter((a) => a.content_id === content.id && a.status === "pending" && a.id !== created.id);
  useStore.setState((s) => ({ content_approvals: [created, ...s.content_approvals.filter((a) => a.id !== created.id)] }));

  // Eski bekleyen sürümleri geri çek (başarısız olsa da sorun değil: RPC yeni sürüm varken eskisini kabul etmez).
  await Promise.all(older.map((a) => useStore.getState().update("content_approvals", a.id, { status: "expired" }).catch(fail)));

  return { ok: true, approval: created };
}

/** Bekleyen talebi geri çeker (bağlantı artık karar kabul etmez). */
export function withdrawApproval(id: string): Promise<MutationResult> {
  return useStore.getState().update("content_approvals", id, { status: "expired" }).catch(fail);
}
