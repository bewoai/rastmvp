// Müşteri Bulma — işletme sitesini çeken SUNUCU yardımcıları (zenginleştirme).
//   - yalnızca http(s), 80/443, kimlik bilgisiz URL; özel / yerel IP'lere istek yok (SSRF)
//   - en fazla 2 yönlendirme (her adım yeniden doğrulanır), toplam 8 sn zaman aşımı, en fazla 300 KB
//   - User-Agent: RastBot/1.0 (+rastcreative.com); Instagram / Facebook vb. asla (isBlockedHost)
// Bağımlılıklar enjekte edilir (fetch, DNS) → scripts/growth-logic.test.mjs ağsız test eder.
// Not: yalnızca `import type` + node: modülleri (type-stripping).
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export const FETCH_TIMEOUT_MS = 8_000;
export const MAX_PAGE_BYTES = 300 * 1024;
export const MAX_REDIRECTS = 2;

export interface FetchedPage {
  ok: boolean;
  status: number | null;
  url: string;
  text: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// Adres güvenliği
// ---------------------------------------------------------------------------

function v4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, o) => (acc << 8) + Number(o), 0) >>> 0;
}

const V4_BLOCKS: [string, number][] = [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15],
  ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
];

/** Özel / yerel / ayrılmış adres mi? (IPv4, IPv6, IPv4-eşlemeli IPv6) */
export function isPrivateAddress(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) {
    const n = v4ToInt(ip);
    return V4_BLOCKS.some(([base, bits]) => {
      const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
      return (n & mask) === (v4ToInt(base) & mask);
    });
  }
  if (kind === 6) {
    const s = ip.toLowerCase();
    const mapped = s.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]);
    if (s === "::" || s === "::1") return true;
    if (/^f[cd]/.test(s)) return true; // fc00::/7
    if (/^fe[89ab]/.test(s)) return true; // fe80::/10
    if (/^ff/.test(s)) return true; // multicast
    if (s.startsWith("2001:db8")) return true;
    return false;
  }
  return true; // tanınmayan → güvenli değil
}

/** URL yapısal olarak çekilebilir mi? (protokol, port, kimlik bilgisi, yerel ad) */
export function checkUrlShape(raw: string): { ok: true; url: URL } | { ok: false; reason: string } {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return { ok: false, reason: "invalid-url" };
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return { ok: false, reason: "protocol" };
  if (u.username || u.password) return { ok: false, reason: "credentials" };
  if (u.port && u.port !== "80" && u.port !== "443") return { ok: false, reason: "port" };
  const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    return { ok: false, reason: "local-host" };
  }
  if (isIP(host) && isPrivateAddress(host)) return { ok: false, reason: "private-ip" };
  return { ok: true, url: u };
}

export type Resolver = (host: string) => Promise<string[]>;

export const dnsResolver: Resolver = async (host) => {
  if (isIP(host)) return [host];
  const res = await lookup(host, { all: true, verbatim: true });
  return res.map((r) => r.address);
};

// ---------------------------------------------------------------------------
// Çekici
// ---------------------------------------------------------------------------

async function readLimited(res: Response, maxBytes: number): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const room = maxBytes - total;
    if (value.byteLength >= room) {
      chunks.push(value.subarray(0, room));
      total += room;
      await reader.cancel().catch(() => undefined);
      break;
    }
    chunks.push(value);
    total += value.byteLength;
  }
  const buf = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    buf.set(c, off);
    off += c.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(buf);
}

export interface HttpFetcherOptions {
  fetchImpl?: typeof fetch;
  resolve?: Resolver;
  isBlockedHost?: (host: string) => boolean;
  userAgent?: string;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
}

/** Güvenli metin çekici (zenginleştirme için). Hata fırlatmaz; `{ok:false}` döner. */
export function createHttpFetcher(opts: HttpFetcherOptions = {}) {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const resolve = opts.resolve ?? dnsResolver;
  const ua = opts.userAgent ?? "RastBot/1.0 (+rastcreative.com)";
  const timeoutMs = opts.timeoutMs ?? FETCH_TIMEOUT_MS;
  const maxBytes = opts.maxBytes ?? MAX_PAGE_BYTES;
  const maxRedirects = opts.maxRedirects ?? MAX_REDIRECTS;

  return async function fetchText(start: string): Promise<FetchedPage> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let current = start;
    try {
      for (let hop = 0; hop <= maxRedirects; hop++) {
        const shape = checkUrlShape(current);
        if (!shape.ok) return { ok: false, status: null, url: current, text: "", error: shape.reason };
        const host = shape.url.hostname.replace(/^\[|\]$/g, "");
        if (opts.isBlockedHost?.(host)) return { ok: false, status: null, url: current, text: "", error: "blocked-host" };
        let addrs: string[];
        try {
          addrs = await resolve(host);
        } catch {
          return { ok: false, status: null, url: current, text: "", error: "dns" };
        }
        if (addrs.length === 0 || addrs.some(isPrivateAddress)) {
          return { ok: false, status: null, url: current, text: "", error: "private-ip" };
        }
        const res = await fetchImpl(shape.url.toString(), {
          redirect: "manual",
          signal: ctrl.signal,
          headers: { "User-Agent": ua, Accept: "text/html,text/plain;q=0.9,*/*;q=0.1", "Accept-Language": "tr,en;q=0.5" },
        });
        if (res.status >= 300 && res.status < 400) {
          const loc = res.headers.get("location");
          await res.body?.cancel().catch(() => undefined);
          if (!loc) return { ok: false, status: res.status, url: current, text: "", error: "redirect-without-location" };
          if (hop === maxRedirects) return { ok: false, status: res.status, url: current, text: "", error: "too-many-redirects" };
          current = new URL(loc, shape.url).toString();
          continue;
        }
        const type = (res.headers.get("content-type") ?? "").toLowerCase();
        if (type && !type.includes("text/html") && !type.includes("text/plain") && !type.includes("application/xhtml")) {
          await res.body?.cancel().catch(() => undefined);
          return { ok: false, status: res.status, url: current, text: "", error: "content-type" };
        }
        const text = await readLimited(res, maxBytes);
        return { ok: res.status >= 200 && res.status < 300, status: res.status, url: current, text };
      }
      return { ok: false, status: null, url: current, text: "", error: "too-many-redirects" };
    } catch (e) {
      const aborted = e instanceof Error && e.name === "AbortError";
      return { ok: false, status: null, url: current, text: "", error: aborted ? "timeout" : "network" };
    } finally {
      clearTimeout(timer);
    }
  };
}

// ---------------------------------------------------------------------------
// Sahte çekici (demo modu ve testler — ağ erişimi YOK)
// ---------------------------------------------------------------------------

/**
 * `.example` alan adları için örnek bir iletişim sayfası üretir; diğer her şey 404. Demo modunda
 * (Supabase yok) ve testlerde gerçek sitelere istek atılmaz.
 */
export function createMockFetcher(pages: Record<string, { status: number; body: string }> = {}) {
  return async function fetchText(url: string): Promise<FetchedPage> {
    if (pages[url]) return { ok: pages[url].status < 300, status: pages[url].status, url, text: pages[url].body };
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      return { ok: false, status: null, url, text: "" };
    }
    if (!u.hostname.endsWith(".example")) return { ok: false, status: 404, url, text: "" };
    if (u.pathname === "/robots.txt") return { ok: true, status: 200, url, text: "User-agent: *\nDisallow: /admin\n" };
    const slug = u.hostname.replace(/\.example$/, "").replace(/[^a-z0-9]/g, "");
    if (u.pathname === "/") {
      return {
        ok: true, status: 200, url,
        text: `<html><head><title>${slug} (demo)</title><meta property="og:title" content="${slug}"></head>` +
          `<body><a href="https://www.instagram.com/${slug}/">Instagram</a><a href="tel:+905550000000">Ara</a></body></html>`,
      };
    }
    if (u.pathname === "/iletisim") {
      return { ok: true, status: 200, url, text: `<p>E-posta: <a href="mailto:info@${u.hostname}">info@${u.hostname}</a></p>` };
    }
    return { ok: false, status: 404, url, text: "" };
  };
}
