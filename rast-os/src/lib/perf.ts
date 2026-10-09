// Geliştirici zamanlama günlüğü — yalnızca NEXT_PUBLIC_DEBUG_PERF=1 iken (derleme anında sabitlenir).
// Kapalıyken hiçbir şey ölçmez/yazmaz; üretim paketinde ölü kod olarak kalır. Bkz. docs/performans.md.

export const PERF_ENABLED = process.env.NEXT_PUBLIC_DEBUG_PERF === "1";

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

/** Ölçüm başlangıcı (kapalıyken 0). */
export function perfStart(): number {
  return PERF_ENABLED ? now() : 0;
}

/**
 * `[perf] <etiket>: <ms> ms` satırı yazar (console.debug → tarayıcıda "Verbose" düzeyi).
 * `detail`: istek sayısı, koleksiyonlar vb. — kişisel veri / satır içeriği YAZILMAZ.
 */
export function perfLog(label: string, t0: number, detail?: Record<string, unknown>): void {
  if (!PERF_ENABLED) return;
  const ms = Math.round(now() - t0);
  if (detail) console.debug(`[perf] ${label}: ${ms} ms`, detail);
  else console.debug(`[perf] ${label}: ${ms} ms`);
}
