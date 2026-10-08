// Herkese açık onay sayfasının (/onay/[token]) sunucu tarafı veri okuması.
// Supabase varsa: anon anahtarla approval_get RPC'si (oturum / çerez kullanılmaz).
// Supabase yoksa (demo): seed'den okunur.
import { createAnonClient } from "./supabase/anon";
import { isSupabaseConfigured } from "./env";
import { seed } from "./seed";
import { effectiveStatus, isValidToken } from "./approval-logic";
import type { PublicApproval } from "./types";

export const DEMO_AGENCY_NAME = "Rast Creative";

export type PublicApprovalResult =
  | { kind: "ok"; approval: PublicApproval }
  | { kind: "not_found" }
  | { kind: "error" };

/** Demo modu: seed'deki talebi approval_get ile aynı biçime çevirir. */
export function demoPublicApproval(token: string, now: Date | number = Date.now()): PublicApproval | null {
  const a = seed.content_approvals.find((x) => x.token === token);
  if (!a) return null;
  const content = seed.contents.find((c) => c.id === a.content_id);
  const newer = seed.content_approvals.some((x) => x.content_id && x.content_id === a.content_id && x.version > a.version);
  return {
    title: a.title || content?.title || "İçerik",
    version: a.version,
    status: effectiveStatus(a, now, newer),
    script_snapshot: a.script_snapshot ?? null,
    checklist: a.checklist,
    note: a.note ?? null,
    sent_at: a.sent_at,
    expires_at: a.expires_at,
    decided_at: a.decided_at ?? null,
    decided_by_name: a.decided_by_name ?? null,
    client_name: seed.clients.find((c) => c.id === content?.client_id)?.name ?? null,
    brand_name: seed.brands.find((b) => b.id === content?.brand_id)?.name ?? null,
    agency_name: DEMO_AGENCY_NAME,
  };
}

export async function getPublicApproval(token: string): Promise<PublicApprovalResult> {
  if (!isValidToken(token)) return { kind: "not_found" };

  if (!isSupabaseConfigured) {
    const approval = demoPublicApproval(token);
    return approval ? { kind: "ok", approval } : { kind: "not_found" };
  }

  try {
    const { data, error } = await createAnonClient().rpc("approval_get", { p_token: token });
    if (error) {
      console.error("[onay] approval_get hatası:", error.message);
      return { kind: "error" };
    }
    if (!data || typeof data !== "object") return { kind: "not_found" };
    const approval = data as PublicApproval;
    return { kind: "ok", approval: { ...approval, checklist: Array.isArray(approval.checklist) ? approval.checklist : [] } };
  } catch (e) {
    console.error("[onay] approval_get bağlantı hatası:", e instanceof Error ? e.message : e);
    return { kind: "error" };
  }
}
