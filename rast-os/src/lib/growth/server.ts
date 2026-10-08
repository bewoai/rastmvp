// Müşteri Bulma — API route'ları için ortak SUNUCU yardımcıları (kimlik, mod, yanıt, hız sınırı).
import { isAuthRequired, isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { clientIp, createRateLimiter } from "@/lib/lead-intake";

export type ServerSupabase = Awaited<ReturnType<typeof createClient>>;

export type GrowthContext =
  /** Supabase yok ve giriş açıkça kapalı (NEXT_PUBLIC_REQUIRE_AUTH=false): demo — DB'ye yazılmaz, sahte istemciler. */
  | { demo: true; key: string }
  | { demo: false; key: string; supabase: ServerSupabase; userId: string; orgId: string | null };

/**
 * İmzası sunucuda doğrulanan kullanıcı (content-files/extract deseni). Supabase yoksa: giriş zorunluyken
 * fail-closed (null), giriş kapalıysa demo bağlamı.
 */
export async function growthContext(request: Request): Promise<GrowthContext | null> {
  if (!isSupabaseConfigured) {
    return isAuthRequired ? null : { demo: true, key: `demo:${clientIp(request.headers)}` };
  }
  try {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return null;
    const { data: profile } = await supabase.from("profiles").select("organization_id").eq("id", user.id).single();
    return { demo: false, key: `user:${user.id}`, supabase, userId: user.id, orgId: (profile?.organization_id as string | null) ?? null };
  } catch {
    return null;
  }
}

export const json = (body: unknown, status = 200, headers?: Record<string, string>) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });

export const unauthorized = () => json({ ok: false, error: "Oturum gerekli." }, 401);

/** Kullanıcı / IP başına hız sınırlayıcılar (bellek içi — "hafif" fren; bkz. README-0017). */
export const limiters = {
  discover: createRateLimiter({ limit: 10, windowMs: 60_000 }),
  places: createRateLimiter({ limit: 60, windowMs: 60_000 }),
  enrich: createRateLimiter({ limit: 10, windowMs: 60_000 }),
  unsubscribe: createRateLimiter({ limit: 30, windowMs: 60_000 }),
};

export function rateLimited(retryAfterSec: number) {
  return json({ ok: false, error: "Çok fazla istek. Biraz sonra tekrar deneyin." }, 429, { "Retry-After": String(retryAfterSec) });
}

/** JSON gövdesini en fazla `maxBytes` olarak okur; bozuksa null. */
export async function readJson(request: Request, maxBytes = 32 * 1024): Promise<Record<string, unknown> | null> {
  const len = Number(request.headers.get("content-length"));
  if (Number.isFinite(len) && len > maxBytes) return null;
  try {
    const text = await request.text();
    if (text.length > maxBytes) return null;
    const v: unknown = JSON.parse(text);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export const str = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[\u0000-\u001F\u007F]/g, " ").trim().slice(0, max) : "");
