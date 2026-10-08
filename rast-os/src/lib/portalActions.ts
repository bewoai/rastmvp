"use client";

import { useStore, uid, nowISO } from "./store";
import type { MutationResult } from "./store";
import type { ClientPortalToken } from "./types";
import { createClient } from "./supabase/client";
import { generateToken } from "./approval-logic";

const fail = (e: unknown): MutationResult => ({ ok: false, error: e instanceof Error ? e.message : String(e) });

const migrationHint = (message: string) =>
  /client_portal_tokens|relation .* does not exist|schema cache/i.test(message) ? `${message} (0018_client_portal.sql uygulanmış mı?)` : message;

/**
 * Müşteri için yeni portal bağlantısı oluşturur. Supabase: token, oluşturan ve tarih veritabanında
 * üretilir (0018 guard trigger); satır `insert … select` ile geri okunur. Demo: token tarayıcıda
 * kriptografik olarak üretilir (yalnızca bellekte; herkese açık sayfada açılmaz).
 */
export async function createPortalLink(
  clientId: string,
  opts: { label?: string; contactLine?: string } = {},
): Promise<MutationResult & { link?: ClientPortalToken }> {
  const { supabase, orgId } = useStore.getState();
  if (supabase && !orgId) {
    return { ok: false, error: "Hesabınız bir organizasyona bağlı değil. Lütfen yöneticiyle iletişime geçin." };
  }
  const base = {
    client_id: clientId,
    label: opts.label?.trim() || null,
    contact_line: opts.contactLine?.trim() || null,
  };

  let link: ClientPortalToken;
  if (supabase) {
    try {
      const { data, error } = await createClient()
        .from("client_portal_tokens")
        .insert({ ...base, id: uid(), organization_id: orgId })
        .select("*")
        .single();
      if (error || !data) {
        const message = error?.message ?? "Portal bağlantısı oluşturulamadı.";
        console.error("[client_portal_tokens] insert hatası:", message);
        return { ok: false, error: migrationHint(message) };
      }
      link = data as ClientPortalToken;
    } catch (e) {
      return fail(e);
    }
  } else {
    link = { ...base, id: uid(), token: generateToken(), created_at: nowISO(), revoked_at: null, last_seen_at: null, expires_at: null };
  }

  useStore.setState((s) => ({ client_portal_tokens: [link, ...s.client_portal_tokens.filter((t) => t.id !== link.id)] }));
  return { ok: true, link };
}

/** Bağlantıyı iptal eder (geri alınamaz; portal "bulunamadı" gösterir). */
export async function revokePortalLink(id: string): Promise<MutationResult> {
  const r = await useStore.getState().update("client_portal_tokens", id, { revoked_at: nowISO() }).catch(fail);
  return r.ok ? r : { ok: false, error: migrationHint(r.error ?? "İptal edilemedi") };
}
