// Müşteri Bulma — işletmenin KENDİ web sitesinden iletişim bilgisi çıkarma (saf fonksiyonlar):
//   e-posta (mailto + düz metin), Instagram kullanıcı adı, telefon (tel:), site kalite sinyalleri,
//   robots.txt ayrıştırma / yol izni. Ağ erişimi YOK (bkz. fetcher.ts). Instagram / Facebook asla çekilmez.
// Testler: scripts/growth-logic.test.mjs
// Not: Node type-stripping ile test edilir; çalışma zamanı import'u yok.

export const USER_AGENT = "RastBot/1.0 (+rastcreative.com)";
export const ROBOT_TOKEN = "rastbot";
/** Zenginleştirmede denenen yollar (ana sayfa + iletişim). */
export const CONTACT_PATHS = ["/", "/iletisim", "/contact"];

/** Bu alan adlarına (ve alt alan adlarına) hiçbir istek yapılmaz. */
export const NEVER_FETCH_HOSTS = [
  "instagram.com", "facebook.com", "fb.com", "fb.me", "wa.me", "whatsapp.com", "threads.net", "tiktok.com",
  "twitter.com", "x.com", "linkedin.com", "youtube.com", "youtu.be", "google.com", "goo.gl", "g.page",
];

export function isNeverFetchHost(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, "");
  return NEVER_FETCH_HOSTS.some((b) => h === b || h.endsWith(`.${b}`));
}

// ---------------------------------------------------------------------------
// HTML yardımcıları
// ---------------------------------------------------------------------------

const ENTITY: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

export function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d{1,6});/g, (_, n: string) => String.fromCodePoint(Math.min(Number(n), 0x10ffff)))
    .replace(/&#x([0-9a-f]{1,6});/gi, (_, n: string) => String.fromCodePoint(Math.min(parseInt(n, 16), 0x10ffff)))
    .replace(/&([a-z]+);/gi, (m, n: string) => ENTITY[n.toLowerCase()] ?? m);
}

const EMAIL_RE = /[a-z0-9][a-z0-9._%+-]{0,63}@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*\.[a-z]{2,24}/gi;
const ASSET_EXT = /\.(png|jpe?g|gif|webp|svg|avif|css|js|ico|woff2?)$/i;
const JUNK_DOMAINS = ["example.com", "example.org", "domain.com", "sentry.io", "sentry-next.wixpress.com", "wixpress.com", "email.com", "mail.com", "yourdomain.com", "adresiniz.com"];

/**
 * Sayfadaki e-posta adresleri: mailto: bağlantıları + düz metin ("[at]"/"(at)" biçimleri dahil).
 * Görsel dosya adları (logo@2x.png), örnek / izleme alan adları elenir. Sitenin alan adıyla eşleşenler önce gelir.
 */
export function extractEmails(html: string, siteHost?: string | null): string[] {
  const text = decodeEntities(html)
    .replace(/%40/g, "@")
    .replace(/\s*[[(]\s*(?:at|et)\s*[\])]\s*/gi, "@")
    .replace(/\s*[[(]\s*(?:dot|nokta)\s*[\])]\s*/gi, ".");
  const found = new Set<string>();
  for (const m of text.matchAll(/mailto:([^"'?\s>]+)/gi)) {
    for (const part of decodeURIComponent(m[1]).split(",")) {
      const e = part.trim().toLowerCase();
      if (/^[^@\s]+@[^@\s]+\.[a-z]{2,24}$/.test(e)) found.add(e);
    }
  }
  for (const m of text.matchAll(EMAIL_RE)) found.add(m[0].toLowerCase());
  const host = (siteHost ?? "").toLowerCase().replace(/^www\./, "");
  const list = [...found].filter((e) => {
    const dom = e.split("@")[1];
    if (ASSET_EXT.test(e)) return false;
    if (JUNK_DOMAINS.some((j) => dom === j || dom.endsWith(`.${j}`))) return false;
    return e.length <= 160;
  });
  const own = (e: string) => (host && (e.endsWith(`@${host}`) || e.split("@")[1].endsWith(`.${host}`)) ? 0 : 1);
  return list.sort((a, b) => own(a) - own(b) || a.localeCompare(b)).slice(0, 10);
}

const IG_RESERVED = new Set(["p", "reel", "reels", "explore", "stories", "accounts", "tv", "about", "developer", "legal", "direct", "sharer", "share", "web", "challenge", "privacy"]);

/** Sayfadaki instagram.com/<kullanıcı> bağlantılarından kullanıcı adları (Instagram'a istek YAPILMAZ). */
export function extractInstagramHandles(html: string): string[] {
  const out = new Set<string>();
  for (const m of decodeEntities(html).matchAll(/instagram\.com\/([A-Za-z0-9._]{1,30})(?=[/?#"'\s<]|$)/gi)) {
    const h = m[1].replace(/\.+$/, "");
    if (!h || IG_RESERVED.has(h.toLowerCase())) continue;
    out.add(h);
  }
  return [...out].slice(0, 5);
}

/** tel: bağlantılarındaki telefonlar (yalnızca rakam/+ korunur). */
export function extractPhones(html: string): string[] {
  const out = new Set<string>();
  for (const m of decodeEntities(html).matchAll(/href\s*=\s*["']tel:([^"']{5,40})["']/gi)) {
    const p = decodeURIComponent(m[1]).replace(/[^\d+]/g, "");
    const digits = p.replace(/\D/g, "");
    if (digits.length >= 10 && digits.length <= 13) out.add(p);
  }
  return [...out].slice(0, 5);
}

/** Site kalite sinyalleri (puanlama): https, <title>, og: etiketleri. */
export function siteSignals(html: string, finalUrl: string): { https: boolean; hasTitle: boolean; hasOg: boolean } {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return {
    https: /^https:\/\//i.test(finalUrl),
    hasTitle: Boolean(title && decodeEntities(title[1]).trim().length >= 3),
    hasOg: /<meta[^>]+property\s*=\s*["']og:(title|description|image)["']/i.test(html),
  };
}

// ---------------------------------------------------------------------------
// robots.txt (RFC 9309, sade uygulama)
// ---------------------------------------------------------------------------

export interface RobotsGroup {
  agents: string[];
  rules: { allow: boolean; path: string }[];
}

export function parseRobots(txt: string): RobotsGroup[] {
  const groups: RobotsGroup[] = [];
  let cur: RobotsGroup | null = null;
  let lastWasAgent = false;
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const val = line.slice(idx + 1).trim();
    if (key === "user-agent") {
      if (!cur || !lastWasAgent) {
        cur = { agents: [], rules: [] };
        groups.push(cur);
      }
      cur.agents.push(val.toLowerCase());
      lastWasAgent = true;
    } else if ((key === "allow" || key === "disallow") && cur) {
      lastWasAgent = false;
      if (key === "disallow" && val === "") continue; // boş Disallow = her şeye izin
      cur.rules.push({ allow: key === "allow", path: val });
    } else {
      lastWasAgent = false;
    }
  }
  return groups;
}

function ruleMatches(rulePath: string, path: string): boolean {
  const anchored = rulePath.endsWith("$");
  const body = anchored ? rulePath.slice(0, -1) : rulePath;
  const re = new RegExp(
    "^" + body.split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*") + (anchored ? "$" : ""),
  );
  return re.test(path);
}

/**
 * Yol bizim için (RastBot) serbest mi? Önce "rastbot" grubu, yoksa "*". En uzun eşleşen kural kazanır;
 * eşitlikte Allow. Hiç eşleşme yoksa izin var.
 */
export function isPathAllowed(groups: RobotsGroup[], path: string, agent = ROBOT_TOKEN): boolean {
  const a = agent.toLowerCase();
  const specific = groups.filter((g) => g.agents.some((x) => x !== "*" && a.includes(x)));
  const chosen = specific.length ? specific : groups.filter((g) => g.agents.includes("*"));
  let best: { allow: boolean; len: number } | null = null;
  for (const g of chosen) {
    for (const r of g.rules) {
      if (!ruleMatches(r.path, path)) continue;
      const len = r.path.length;
      if (!best || len > best.len || (len === best.len && r.allow)) best = { allow: r.allow, len };
    }
  }
  return best ? best.allow : true;
}

/** robots.txt yanıt durumuna göre karar (RFC 9309): 2xx → kurallar; 4xx → serbest; 5xx / ağ hatası → tamamen yasak. */
export function robotsFromResponse(status: number | null, body: string): RobotsGroup[] | "allow-all" | "disallow-all" {
  if (status === null || status >= 500) return "disallow-all";
  if (status >= 400) return "allow-all";
  if (status >= 200 && status < 300) return parseRobots(body);
  return "allow-all";
}

export interface EnrichResult {
  emails: string[];
  instagram: string[];
  phones: string[];
  signals: { https: boolean; hasTitle: boolean; hasOg: boolean } | null;
  fetched: string[];
  skipped: { path: string; reason: "robots" | "error" | "blocked-host" }[];
}

/** Sayfa çekme işlevi (fetcher.ts sağlar; testte sahte). */
export type FetchText = (url: string) => Promise<{ ok: boolean; status: number | null; url: string; text: string }>;

/**
 * Bir sitenin ana sayfası + /iletisim + /contact sayfalarından e-posta / Instagram / telefon çıkarır.
 * robots.txt'e uyar; Instagram / Facebook vb. alan adlarına asla istek yapmaz.
 */
export async function enrichWebsite(website: string, fetchText: FetchText): Promise<EnrichResult> {
  const res: EnrichResult = { emails: [], instagram: [], phones: [], signals: null, fetched: [], skipped: [] };
  let base: URL;
  try {
    base = new URL(website);
  } catch {
    return res;
  }
  if (!/^https?:$/.test(base.protocol)) return res;
  if (isNeverFetchHost(base.hostname)) {
    // Örn. "web sitesi" alanına Instagram profili yazılmış: istek yok, kullanıcı adını URL'den al.
    res.instagram = extractInstagramHandles(website);
    res.skipped.push({ path: "/", reason: "blocked-host" });
    return res;
  }

  const robotsRes = await fetchText(new URL("/robots.txt", base.origin).toString()).catch(() => ({ ok: false, status: null, url: "", text: "" }));
  const robots = robotsFromResponse(robotsRes.status, robotsRes.text);

  const emails = new Set<string>();
  const ig = new Set<string>();
  const phones = new Set<string>();
  for (const path of CONTACT_PATHS) {
    const allowed = robots === "allow-all" ? true : robots === "disallow-all" ? false : isPathAllowed(robots, path);
    if (!allowed) {
      res.skipped.push({ path, reason: "robots" });
      continue;
    }
    const page = await fetchText(new URL(path, base.origin).toString()).catch(() => null);
    if (!page || !page.ok) {
      res.skipped.push({ path, reason: "error" });
      continue;
    }
    res.fetched.push(path);
    const host = (() => {
      try {
        return new URL(page.url).hostname;
      } catch {
        return base.hostname;
      }
    })();
    extractEmails(page.text, host).forEach((e) => emails.add(e));
    extractInstagramHandles(page.text).forEach((h) => ig.add(h));
    extractPhones(page.text).forEach((p) => phones.add(p));
    if (path === "/") res.signals = siteSignals(page.text, page.url);
  }
  const own = base.hostname.replace(/^www\./, "");
  res.emails = extractEmails([...emails].map((e) => `mailto:${e}`).join(" "), own);
  res.instagram = [...ig];
  res.phones = [...phones];
  return res;
}
