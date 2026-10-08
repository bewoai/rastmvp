// /api/leads için SUNUCU yardımcıları: sabit-zamanlı sır karşılaştırma, bellek içi hız sınırı,
// sınırlı gövde okuma ve gövde çözümleme. Next'e bağımlı değildir (Node'da doğrudan test edilir).
// Testler: scripts/lead-logic.test.mjs
// Not: yalnızca `import type` + node: modülleri kullanın (type-stripping).
import { createHash, timingSafeEqual } from "node:crypto";

// ---------------------------------------------------------------------------
// Sır karşılaştırma
// ---------------------------------------------------------------------------

/**
 * İki sırrı sabit sürede karşılaştırır. Her ikisi de SHA-256'dan geçirilir (eşit uzunluk), böylece
 * uzunluk bilgisi sızmaz ve timingSafeEqual uzunluk hatası vermez. Boş / eksik değer her zaman false.
 */
export function secretsMatch(provided: string | null | undefined, expected: string | null | undefined): boolean {
  if (!provided || !expected) return false;
  const a = createHash("sha256").update(provided, "utf8").digest();
  const b = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(a, b);
}

// ---------------------------------------------------------------------------
// Hız sınırı (kayan pencere, bellek içi)
// ---------------------------------------------------------------------------

export interface RateLimitResult {
  ok: boolean;
  /** Pencere dolduysa kaç saniye sonra tekrar denenebilir. */
  retryAfterSec: number;
  remaining: number;
}

export interface RateLimiter {
  check(key: string, now?: number): RateLimitResult;
  /** Yalnızca test/izleme için: izlenen anahtar sayısı. */
  size(): number;
}

/**
 * Anahtar başına `limit` istek / `windowMs` (kayan pencere). Sunucusuz ortamda her örnek (instance)
 * kendi belleğini tutar: bu bir "hafif" koruma, kesin kota değildir (README-0017'ye bakın).
 * Bellek şişmesin diye anahtar sayısı `maxKeys`'i aşınca süresi dolmuş kayıtlar temizlenir.
 */
export function createRateLimiter(opts: { limit: number; windowMs: number; maxKeys?: number }): RateLimiter {
  const { limit, windowMs, maxKeys = 5000 } = opts;
  const hits = new Map<string, number[]>();

  const prune = (arr: number[], now: number) => {
    const cutoff = now - windowMs;
    let i = 0;
    while (i < arr.length && arr[i] <= cutoff) i++;
    if (i > 0) arr.splice(0, i);
  };

  return {
    check(key, now = Date.now()) {
      if (hits.size > maxKeys) {
        for (const [k, arr] of hits) {
          prune(arr, now);
          if (arr.length === 0) hits.delete(k);
        }
      }
      const arr = hits.get(key) ?? [];
      prune(arr, now);
      if (arr.length >= limit) {
        hits.set(key, arr);
        return { ok: false, retryAfterSec: Math.max(1, Math.ceil((arr[0] + windowMs - now) / 1000)), remaining: 0 };
      }
      arr.push(now);
      hits.set(key, arr);
      return { ok: true, retryAfterSec: 0, remaining: limit - arr.length };
    },
    size: () => hits.size,
  };
}

/** İstemci IP'si: Vercel `x-real-ip` / `x-forwarded-for` (ilk adres). Yoksa "unknown". */
export function clientIp(headers: { get(name: string): string | null }): string {
  const real = headers.get("x-real-ip")?.trim();
  if (real) return real;
  const fwd = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return fwd || "unknown";
}

// ---------------------------------------------------------------------------
// Gövde okuma / çözümleme
// ---------------------------------------------------------------------------

export class BodyTooLargeError extends Error {
  constructor() {
    super("Gövde çok büyük.");
    this.name = "BodyTooLargeError";
  }
}

/** Gövdeyi en fazla `maxBytes` olacak şekilde okur; aşılırsa akışı keser ve BodyTooLargeError fırlatır. */
export async function readBodyLimited(request: Request, maxBytes: number): Promise<Uint8Array> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw new BodyTooLargeError();
  if (!request.body) return new Uint8Array(0);

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new BodyTooLargeError();
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

/**
 * Gövdeyi düz bir nesneye çevirir: application/json, application/x-www-form-urlencoded veya multipart/form-data.
 * Tanınmayan tür / bozuk gövde için null döner. Dosya alanları yok sayılır (yalnızca metin alanları).
 */
export async function parseLeadBody(contentType: string | null, bytes: Uint8Array): Promise<Record<string, unknown> | null> {
  const type = (contentType ?? "").toLowerCase();
  try {
    if (type.includes("application/json")) {
      const parsed: unknown = JSON.parse(new TextDecoder("utf-8").decode(bytes));
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
    }
    if (type.includes("application/x-www-form-urlencoded")) {
      return Object.fromEntries(new URLSearchParams(new TextDecoder("utf-8").decode(bytes)));
    }
    if (type.includes("multipart/form-data")) {
      const form = await new Response(bytes as BodyInit, { headers: { "content-type": contentType ?? "" } }).formData();
      const out: Record<string, unknown> = {};
      for (const [k, v] of form.entries()) if (typeof v === "string") out[k] = v;
      return out;
    }
  } catch {
    return null;
  }
  return null;
}
