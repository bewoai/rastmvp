// Müşteri Bulma testleri — çalıştırma: npm test  (Node test runner + type stripping). Ağ erişimi YOK:
// Places, site çekici ve SMTP hep sahte / enjekte.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHmac } from "node:crypto";
import {
  CONTACT_COOLDOWN_DAYS, DAILY_LIST_SIZE, DEFAULT_SEQUENCES, MANUAL_SCRIPTS, SECTORS, allowedFieldSource, approvalPatch,
  clinicCsvToProspects, contactStats, emailSendingEnabled, emailsSentToday, firstStepDraft, instagramLink, isSuppressed,
  isWithinSendWindow, manualContactRecord, nextSendSlot, nextStepDraft, normalizeInstagram, parseCsv, parseDailyCap,
  planSendBatch, prospectToLeadDraft, prospectView, remainingCap, renderTemplate, scoreProspect, sectorKeyOf,
  selectDailyList, snoozePatch, suppressionValue, telLink, templateContext, waNumber, whatsappLink, istanbulDay,
} from "../src/lib/growth/logic.ts";
import {
  enrichWebsite, extractEmails, extractInstagramHandles, extractPhones, isNeverFetchHost, isPathAllowed, parseRobots,
  robotsFromResponse, siteSignals,
} from "../src/lib/growth/enrich.ts";
import { checkUrlShape, createHttpFetcher, createMockFetcher, isPrivateAddress } from "../src/lib/growth/fetcher.ts";
import { GooglePlacesClient, MockPlacesClient, buildTextQuery, createPlacesClient, mapGooglePlace } from "../src/lib/growth/places.ts";
import { isUnsubTokenShape, signUnsubToken, unsubKeyFromSecret, verifyUnsubToken } from "../src/lib/growth/unsubscribe.ts";
import { NoopMailer, SENDER_IDENTITY, addressOf, buildOutgoingEmail, createMailerFromEnv, smtpConfigFromEnv } from "../src/lib/growth/mailer.ts";
import { HEDEF_KLINIKLER_CSV } from "../src/lib/growth/hedef-klinikler.ts";

const DAY = 86_400_000;
// 2026-10-08 Perşembe 11:00 İstanbul (08:00Z)
const NOW = Date.parse("2026-10-08T08:00:00Z");
const ago = (d) => new Date(NOW - d * DAY).toISOString();

/* ---------------- Puanlama ---------------- */

test("score: toplam 100, döküm açıklamalı ve Places ham değerini içermez", () => {
  const full = scoreProspect({
    sector: "diş kliniği", rating: 4.83, reviewsCount: 312, website: "https://a.com",
    site: { https: true, hasTitle: true, hasOg: true }, instagram: "a", email: "a@a.com", city: "Sakarya",
  });
  assert.equal(full.score, 100);
  assert.equal(full.breakdown.reduce((s, i) => s + i.max, 0), 100);
  const text = JSON.stringify(full.breakdown);
  assert.ok(!text.includes("4.83") && !text.includes("4,83") && !text.includes("312"), "ham puan/yorum sayısı dökümde olmamalı");
  assert.equal(full.breakdown.find((i) => i.key === "rating").detail, "≥ 4,5");
  assert.equal(full.breakdown.find((i) => i.key === "reviews").detail, "200+");

  const empty = scoreProspect({ sector: "kuaför" });
  assert.equal(empty.score, SECTORS.diger.weight);
  assert.ok(empty.breakdown.every((i) => i.points <= i.max && i.points >= 0));
});

test("score: bantlar, site kalitesi, şehir uyumu", () => {
  const s = (x) => scoreProspect(x).breakdown;
  assert.equal(s({ rating: 4.2 }).find((i) => i.key === "rating").points, 7);
  assert.equal(s({ rating: 3.6 }).find((i) => i.key === "rating").points, 3);
  assert.equal(s({ reviewsCount: 60 }).find((i) => i.key === "reviews").points, 10);
  assert.equal(s({ reviewsCount: 9 }).find((i) => i.key === "reviews").points, 0);
  assert.equal(s({ website: "https://x.com", site: { https: true, hasTitle: false, hasOg: true } }).find((i) => i.key === "site_quality").points, 6);
  assert.equal(s({ website: "http://x.com" }).find((i) => i.key === "site_quality").points, 0);
  assert.equal(s({ city: "Kocaeli" }).find((i) => i.key === "city").points, 5);
  assert.equal(s({ city: "Ankara", targetCity: "ankara" }).find((i) => i.key === "city").points, 10);
  assert.equal(s({ city: "Ankara" }).find((i) => i.key === "city").points, 0);
});

test("sectorKeyOf: Türkçe sorgular", () => {
  assert.equal(sectorKeyOf("Diş Kliniği"), "hekim");
  assert.equal(sectorKeyOf("Uzm. Dr. Selin"), "hekim");
  assert.equal(sectorKeyOf("MOBİLYA mağazası"), "mobilya");
  assert.equal(sectorKeyOf("gayrimenkul ofisi"), "insaat");
  assert.equal(sectorKeyOf("kuaför"), "diger");
  assert.equal(sectorKeyOf(null, undefined), "diger");
});

/* ---------------- Şablon belirteçleri ---------------- */

test("renderTemplate: belirteçler, yedekler, bilinmeyenler, noktalama toparlama", () => {
  const r = renderTemplate("Merhaba {{isim}}, {{ sehir }} bölgesi · {{site}} · {{rast_vaka_link}} {{foo}}", {
    isim: "Demo Klinik", sehir: "Serdivan / Sakarya", site: "", rast_vaka_link: "https://rastcreative.com",
  });
  assert.equal(r.text, "Merhaba Demo Klinik, Serdivan / Sakarya bölgesi · web siteniz · https://rastcreative.com {{foo}}");
  assert.deepEqual(r.missing, ["site"]);
  assert.deepEqual(r.unknown, ["foo"]);
  assert.equal(renderTemplate("Merhaba {{isim}},", {}).text, "Merhaba,");
});

test("templateContext + varsayılan diziler: 3 sektör, 3 adım, hekim şablonu reklam önermiyor", () => {
  const ctx = templateContext({ name: "Demo", sector: "Diş Kliniği", city: "Sakarya", district: "Serdivan", website: "https://demo.com/" });
  assert.deepEqual(ctx, { isim: "Demo", sektor: "diş kliniği", sehir: "Serdivan / Sakarya", site: "demo.com", rast_vaka_link: "https://rastcreative.com" });
  assert.deepEqual(DEFAULT_SEQUENCES.map((s) => s.sector), ["hekim", "mobilya", "insaat"]);
  for (const seq of DEFAULT_SEQUENCES) {
    assert.equal(seq.steps.length, 3);
    assert.deepEqual(seq.steps.map((s) => s.day), [0, 4, 10]);
    for (const st of seq.steps) assert.deepEqual(renderTemplate(st.subject + st.body, ctx).unknown, []);
  }
  const hekim = JSON.stringify([DEFAULT_SEQUENCES[0], MANUAL_SCRIPTS.hekim]).toLocaleLowerCase("tr");
  assert.ok(hekim.includes("reklam yasağı") && hekim.includes("bilgilendirme"));
  for (const banned of ["google ads", "meta reklam", "sponsorlu", "ücretli reklam", "reklam kampanyası yönet", "hasta kazan"]) {
    assert.ok(!hekim.includes(banned), `hekim şablonu "${banned}" içermemeli`);
  }
});

/* ---------------- Adım planlama, gönderim penceresi ---------------- */

test("isWithinSendWindow / nextSendSlot: hafta içi 09-18 İstanbul", () => {
  assert.equal(isWithinSendWindow(NOW), true); // Perşembe 11:00
  assert.equal(isWithinSendWindow(Date.parse("2026-10-08T16:00:00Z")), false); // 19:00
  assert.equal(isWithinSendWindow(Date.parse("2026-10-10T08:00:00Z")), false); // Cumartesi
  assert.equal(nextSendSlot(NOW), new Date(NOW).toISOString());
  assert.equal(nextSendSlot("2026-10-08T16:00:00Z"), "2026-10-09T07:00:00.000Z"); // Cuma 10:00
  assert.equal(nextSendSlot("2026-10-09T16:30:00Z"), "2026-10-12T07:00:00.000Z"); // Cuma akşam → Pazartesi 10:00
  assert.equal(nextSendSlot("2026-10-10T03:00:00Z"), "2026-10-12T07:00:00.000Z"); // Cumartesi
  assert.equal(nextSendSlot("2026-10-12T04:00:00Z"), "2026-10-12T07:00:00.000Z"); // Pazartesi 07:00 → 10:00
});

test("nextStepDraft: gün farkı kadar sonra, şablon olarak; son adımdan sonra null", () => {
  const steps = DEFAULT_SEQUENCES[0].steps;
  const d = nextStepDraft(steps, 1, new Date(NOW));
  assert.equal(d.step_no, 2);
  assert.equal(d.subject, steps[1].subject); // belirteçler DOLDURULMAZ (Places adı DB'ye kopyalanmaz)
  assert.equal(d.scheduled_for, "2026-10-12T08:00:00.000Z"); // +4 gün = Pazartesi 11:00
  const d2 = nextStepDraft(steps, 2, "2026-10-12T08:00:00Z");
  assert.equal(d2.step_no, 3);
  assert.equal(d2.scheduled_for, "2026-10-19T07:00:00.000Z"); // +6 gün = Pazar → Pazartesi 10:00
  assert.equal(nextStepDraft(steps, 3, new Date(NOW)), null);
  assert.equal(nextStepDraft(null, 1, new Date(NOW)), null);
  assert.equal(nextStepDraft([{ day: 0, subject: "a", body: "b" }, { day: 0, subject: "c", body: "d" }], 1, new Date(NOW)).scheduled_for, "2026-10-09T08:00:00.000Z"); // en az 1 gün
});

/* ---------------- E-posta bayrağı ---------------- */

test("emailSendingEnabled: varsayılan KAPALI; yalnızca true / 1", () => {
  assert.equal(emailSendingEnabled({}), false);
  assert.equal(emailSendingEnabled({ OUTREACH_EMAIL_ENABLED: "" }), false);
  assert.equal(emailSendingEnabled({ OUTREACH_EMAIL_ENABLED: "false" }), false);
  assert.equal(emailSendingEnabled({ OUTREACH_EMAIL_ENABLED: "yes" }), false);
  assert.equal(emailSendingEnabled({ OUTREACH_EMAIL_ENABLED: "TRUE" }), true);
  assert.equal(emailSendingEnabled({ OUTREACH_EMAIL_ENABLED: "1" }), true);
});

test("approvalPatch: bayrak kapalıyken planlama YOK; açıkken gelecek plan korunur / ilk uygun an", () => {
  assert.deepEqual(approvalPatch({ scheduled_for: "2026-10-20T08:00:00Z" }, { emailEnabled: false, now: NOW }), { status: "approved", scheduled_for: null });
  assert.deepEqual(approvalPatch({ scheduled_for: null }, { emailEnabled: false, now: NOW }), { status: "approved", scheduled_for: null });
  assert.equal(approvalPatch({ scheduled_for: "2026-10-20T08:00:00Z" }, { emailEnabled: true, now: NOW }).scheduled_for, "2026-10-20T08:00:00.000Z");
  assert.equal(approvalPatch({ scheduled_for: ago(1) }, { emailEnabled: true, now: NOW }).scheduled_for, new Date(NOW).toISOString());
  assert.equal(approvalPatch({ scheduled_for: null }, { emailEnabled: true, now: Date.parse("2026-10-10T08:00:00Z") }).scheduled_for, "2026-10-12T07:00:00.000Z");
});

/* ---------------- Günlük limit + gönderim seçimi ---------------- */

const em = (id, extra = {}) => ({
  id, prospect_id: `p-${id}`, status: "approved", channel: "email", manual: false, to_email: `${id}@firma.com`,
  scheduled_for: ago(1), created_at: ago(2), ...extra,
});

test("parseDailyCap / remainingCap", () => {
  assert.equal(parseDailyCap(undefined), 20);
  assert.equal(parseDailyCap(""), 20);
  assert.equal(parseDailyCap("35"), 35);
  assert.equal(parseDailyCap("0"), 0);
  assert.equal(parseDailyCap("-3"), 20);
  assert.equal(parseDailyCap("2.5"), 20);
  assert.equal(parseDailyCap("abc"), 20);
  assert.equal(parseDailyCap("5000"), 200);
  assert.equal(remainingCap(20, 18), 2);
  assert.equal(remainingCap(20, 25), 0);
});

test("planSendBatch: limit, sıra, ret listesi, planlanmamış/vadesi gelmemiş; bayrak kapalıyken HİÇBİR ŞEY", () => {
  const msgs = [
    em("a", { scheduled_for: ago(3) }), em("b", { scheduled_for: ago(2) }), em("c"), em("d"),
    em("late", { scheduled_for: new Date(NOW + DAY).toISOString() }),
    em("unsched", { scheduled_for: null }),
    em("sup", { to_email: "x@engelli.com" }),
    em("draft", { status: "draft" }),
    em("wa", { channel: "whatsapp", manual: true }),
    em("closed"),
  ];
  const opts = { now: NOW, cap: 20, sentToday: 18, emailEnabled: true, suppression: [{ kind: "domain", value: "engelli.com" }], closedProspectIds: new Set(["p-closed"]) };
  const r = planSendBatch(msgs, opts);
  assert.deepEqual(r.send, ["a", "b"]); // limit: 20 - 18 = 2, en eski önce
  const reason = Object.fromEntries(r.skipped.map((s) => [s.id, s.reason]));
  assert.deepEqual(reason, { late: "not_due", unsched: "unscheduled", sup: "suppressed", wa: "not_email", closed: "prospect_closed", c: "cap", d: "cap" });
  assert.equal(r.send.includes("draft"), false);

  const off = planSendBatch(msgs, { ...opts, emailEnabled: false });
  assert.deepEqual(off.send, []);
  assert.ok(off.skipped.every((s) => s.reason === "disabled"));
});

test("emailsSentToday: yalnızca bugünkü (İstanbul) e-postalar, manuel temas sayılmaz", () => {
  const msgs = [
    { channel: "email", manual: false, sent_at: "2026-10-07T21:30:00Z" }, // 8 Eki 00:30 İstanbul
    { channel: "email", manual: false, sent_at: "2026-10-07T20:30:00Z" }, // 7 Eki 23:30
    { channel: "whatsapp", manual: true, sent_at: ago(0) },
    { channel: "email", manual: false, sent_at: null },
  ];
  assert.equal(emailsSentToday(msgs, NOW), 1);
  assert.equal(istanbulDay("2026-10-07T21:30:00Z"), "2026-10-08");
});

/* ---------------- Ret listesi ---------------- */

test("isSuppressed: e-posta, alan adı (+alt alan adı), telefon anahtarı", () => {
  const list = [
    { kind: "email", value: "ali@firma.com" }, { kind: "domain", value: "kapali.com" }, { kind: "phone", value: "5321112233" },
  ];
  assert.equal(isSuppressed(list, { email: "ALI@firma.com " }), true);
  assert.equal(isSuppressed(list, { email: "veli@firma.com" }), false);
  assert.equal(isSuppressed(list, { email: "x@mail.kapali.com" }), true);
  assert.equal(isSuppressed(list, { email: "x@kapali.com.tr" }), false);
  assert.equal(isSuppressed(list, { phone: "+90 (532) 111 22 33" }), true);
  assert.equal(isSuppressed(list, { phone: "0532 111 22 34" }), false);
  assert.equal(isSuppressed([], { email: "a@b.co" }), false);
  assert.equal(suppressionValue("domain", "https://www.Firma.com/iletisim"), "firma.com");
  assert.equal(suppressionValue("email", " Ali@Firma.com "), "ali@firma.com");
  assert.equal(suppressionValue("phone", "0532 111 22 33"), "5321112233");
  assert.equal(suppressionValue("email", "bozuk"), null);
});

/* ---------------- Ret token'ı ---------------- */

test("unsubscribe token: imzala / doğrula / kurcalama; SQL ile aynı biçim", () => {
  const key = unsubKeyFromSecret("test-sırrı-en-az-16");
  assert.match(key, /^[0-9a-f]{64}$/);
  const id = "3f0c2a5e-1b2c-4d3e-8f90-123456789abc";
  const t = signUnsubToken(id, key);
  assert.equal(t, `${id}.${createHmac("sha256", key).update(id).digest("hex")}`); // outreach_unsub_token() ile aynı
  assert.equal(isUnsubTokenShape(t), true);
  assert.equal(verifyUnsubToken(t, key), id);
  assert.equal(verifyUnsubToken(t, unsubKeyFromSecret("başka-sır-başka-sır")), null);
  const tampered = t.slice(0, -1) + (t.endsWith("0") ? "1" : "0");
  assert.equal(verifyUnsubToken(tampered, key), null);
  assert.equal(verifyUnsubToken(`3f0c2a5e-1b2c-4d3e-8f90-123456789abd.${t.split(".")[1]}`, key), null);
  for (const bad of [null, "", "abc", `${id}.`, `${id}.${"z".repeat(64)}`, t.toUpperCase()]) assert.equal(isUnsubTokenShape(bad), false);
  assert.throws(() => signUnsubToken("not-a-uuid", key));
});

/* ---------------- Site zenginleştirme ---------------- */

const SAMPLE_HTML = `<!doctype html><html><head><title>Demo Diş Polikliniği</title>
<meta property="og:title" content="Demo"></head><body>
<a href="mailto:Randevu@Demodis.com.tr?subject=Merhaba">Yaz</a>
<p>Bilgi: info&#64;demodis.com.tr · destek [at] demodis.com.tr</p>
<img src="/img/logo@2x.png"> <span>user@example.com</span> <span>x@sentry.io</span> <span>ortak@gmail.com</span>
<a href="https://www.instagram.com/demodis/">IG</a> <a href="https://instagram.com/p/ABC123/">gönderi</a>
<a href="https://www.instagram.com/reel/XYZ">reel</a>
<a href="tel:+90 (264) 000 00 00">Ara</a> <a href='tel:12'>kısa</a>
</body></html>`;

test("extractEmails: mailto + düz metin + [at]; görsel/örnek/izleme elenir; sitenin alan adı önce", () => {
  const e = extractEmails(SAMPLE_HTML, "www.demodis.com.tr");
  assert.deepEqual(e, ["destek@demodis.com.tr", "info@demodis.com.tr", "randevu@demodis.com.tr", "ortak@gmail.com"]);
  assert.deepEqual(extractEmails("<p>yok</p>"), []);
});

test("extractInstagramHandles / extractPhones / siteSignals", () => {
  assert.deepEqual(extractInstagramHandles(SAMPLE_HTML), ["demodis"]);
  assert.deepEqual(extractPhones(SAMPLE_HTML), ["+902640000000"]);
  assert.deepEqual(siteSignals(SAMPLE_HTML, "https://demodis.com.tr/"), { https: true, hasTitle: true, hasOg: true });
  assert.deepEqual(siteSignals("<html></html>", "http://x.com"), { https: false, hasTitle: false, hasOg: false });
});

test("robots.txt: grup seçimi, en uzun eşleşme, joker, $; durum koduna göre karar", () => {
  const g = parseRobots(`# yorum
User-agent: *
Disallow: /iletisim
Allow: /iletisim/harita
Disallow: /*.pdf$

User-agent: Googlebot
Disallow: /`);
  assert.equal(isPathAllowed(g, "/"), true);
  assert.equal(isPathAllowed(g, "/iletisim"), false);
  assert.equal(isPathAllowed(g, "/iletisim/harita"), true);
  assert.equal(isPathAllowed(g, "/dosya.pdf"), false);
  assert.equal(isPathAllowed(g, "/dosya.pdf?x=1"), true);
  const specific = parseRobots("User-agent: RastBot\nDisallow: /\n\nUser-agent: *\nDisallow:\n");
  assert.equal(isPathAllowed(specific, "/"), false);
  assert.equal(isPathAllowed(parseRobots("User-agent: *\nDisallow:\n"), "/contact"), true);
  assert.equal(robotsFromResponse(404, ""), "allow-all");
  assert.equal(robotsFromResponse(503, ""), "disallow-all");
  assert.equal(robotsFromResponse(null, ""), "disallow-all");
  assert.ok(Array.isArray(robotsFromResponse(200, "User-agent: *\nDisallow: /x")));
});

test("enrichWebsite: robots'a uyar, iletişim sayfalarını tarar, Instagram/Facebook'a asla istek atmaz", async () => {
  const calls = [];
  const fetchText = async (url) => {
    calls.push(url);
    const p = new URL(url).pathname;
    if (p === "/robots.txt") return { ok: true, status: 200, url, text: "User-agent: *\nDisallow: /contact\n" };
    if (p === "/") return { ok: true, status: 200, url, text: SAMPLE_HTML };
    if (p === "/iletisim") return { ok: true, status: 200, url, text: '<a href="mailto:iletisim@demodis.com.tr">x</a>' };
    return { ok: false, status: 404, url, text: "" };
  };
  const r = await enrichWebsite("https://demodis.com.tr", fetchText);
  assert.deepEqual(calls, ["https://demodis.com.tr/robots.txt", "https://demodis.com.tr/", "https://demodis.com.tr/iletisim"]);
  assert.deepEqual(r.skipped, [{ path: "/contact", reason: "robots" }]);
  assert.ok(r.emails.includes("iletisim@demodis.com.tr") && r.emails[0].endsWith("@demodis.com.tr"));
  assert.deepEqual(r.instagram, ["demodis"]);
  assert.deepEqual(r.signals, { https: true, hasTitle: true, hasOg: true });

  const igCalls = [];
  const ig = await enrichWebsite("https://www.instagram.com/demoklinik/", async (u) => (igCalls.push(u), { ok: true, status: 200, url: u, text: "" }));
  assert.deepEqual(igCalls, []);
  assert.deepEqual(ig.instagram, ["demoklinik"]);
  assert.equal(isNeverFetchHost("m.facebook.com"), true);
  assert.equal(isNeverFetchHost("instagram.com.example"), false);

  const down = await enrichWebsite("https://x.com.tr", async (u) => (new URL(u).pathname === "/robots.txt" ? { ok: false, status: 500, url: u, text: "" } : assert.fail("robots 5xx iken sayfa çekilmemeli")));
  assert.equal(down.skipped.length, 3);
});

/* ---------------- Güvenli çekici (SSRF / boyut / yönlendirme) ---------------- */

test("isPrivateAddress / checkUrlShape", () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.20.0.1", "192.168.1.5", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:10.0.0.1"]) {
    assert.equal(isPrivateAddress(ip), true, ip);
  }
  for (const ip of ["8.8.8.8", "185.1.2.3", "2a00:1450:4001::1"]) assert.equal(isPrivateAddress(ip), false, ip);
  assert.equal(checkUrlShape("ftp://a.com").ok, false);
  assert.equal(checkUrlShape("http://user:pw@a.com").ok, false);
  assert.equal(checkUrlShape("http://a.com:8080").ok, false);
  assert.equal(checkUrlShape("http://localhost/").ok, false);
  assert.equal(checkUrlShape("http://127.0.0.1/").ok, false);
  assert.equal(checkUrlShape("https://a.com/x").ok, true);
});

const resp = (status, body = "", headers = {}) => new Response(body, { status, headers: { "content-type": "text/html", ...headers } });

test("createHttpFetcher: UA başlığı, ≤2 yönlendirme, özel IP ve yasak alan adı, 300 KB sınırı", async () => {
  const seen = [];
  const publicDns = async () => ["93.184.216.34"];
  const f = createHttpFetcher({
    resolve: publicDns,
    isBlockedHost: isNeverFetchHost,
    fetchImpl: async (url, init) => {
      seen.push({ url, ua: init.headers["User-Agent"], redirect: init.redirect });
      const p = new URL(url).pathname;
      if (p === "/r1") return resp(301, "", { location: "/r2" });
      if (p === "/r2") return resp(302, "", { location: "https://b.com/r3" });
      if (p === "/r3") return resp(302, "", { location: "/r4" });
      if (p === "/ig") return resp(302, "", { location: "https://www.instagram.com/x/" });
      if (p === "/big") return resp(200, "a".repeat(400 * 1024));
      if (p === "/pdf") return resp(200, "%PDF", { "content-type": "application/pdf" });
      return resp(200, "<html>ok</html>");
    },
  });
  const ok = await f("https://a.com/");
  assert.equal(ok.ok, true);
  assert.equal(seen[0].ua, "RastBot/1.0 (+rastcreative.com)");
  assert.equal(seen[0].redirect, "manual");

  const two = await f("https://a.com/r1"); // r1 → r2 → b.com/r3 → (3. yönlendirme) reddedilir
  assert.equal(two.ok, false);
  assert.equal(two.error, "too-many-redirects");
  assert.equal((await f("https://a.com/ig")).error, "blocked-host");
  assert.equal((await f("https://a.com/pdf")).error, "content-type");
  const big = await f("https://a.com/big");
  assert.equal(big.text.length, 300 * 1024);

  const priv = createHttpFetcher({ resolve: async () => ["10.0.0.5"], fetchImpl: async () => assert.fail("özel IP'ye istek atılmamalı") });
  assert.equal((await priv("https://ic-ag.example.com/")).error, "private-ip");
});

test("createMockFetcher: yalnızca .example alan adları, ağ yok", async () => {
  const f = createMockFetcher();
  const r = await enrichWebsite("https://demo-hekim-01.example", f);
  assert.deepEqual(r.emails, ["info@demo-hekim-01.example"]);
  assert.deepEqual(r.instagram, ["demohekim01"]);
  assert.equal((await f("https://gercek-site.com/")).status, 404);
});

/* ---------------- Places ---------------- */

test("MockPlacesClient: sektör + il süzme, basic ayrıntı telefonsuz", async () => {
  const c = new MockPlacesClient();
  const r = await c.searchText({ query: "diş kliniği", city: "Sakarya", max: 50 });
  assert.ok(r.length >= 5 && r.every((p) => p.placeId.startsWith("mock-hekim")));
  assert.equal((await c.searchText({ query: "mobilya", city: "Kocaeli", max: 5 })).length, 1);
  assert.equal((await c.searchText({ query: "diş", city: "Sakarya", district: "Serdivan", max: 2 })).length, 2);
  const basic = await c.details(["mock-hekim-01", "yok-boyle"], "basic");
  assert.deepEqual(Object.keys(basic), ["mock-hekim-01"]);
  assert.equal(basic["mock-hekim-01"].phone, undefined);
  assert.ok((await c.details(["mock-hekim-01"], "contact"))["mock-hekim-01"].phone);
  assert.equal(createPlacesClient({}).kind, "mock");
  assert.equal(createPlacesClient({ GOOGLE_PLACES_API_KEY: "k" }, { forceMock: true }).kind, "mock");
  assert.equal(createPlacesClient({ GOOGLE_PLACES_API_KEY: "k" }).kind, "google");
});

test("GooglePlacesClient: alan maskesi, sayfalama, eşleme (sahte fetch, ağ yok)", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith(":searchText")) {
      const body = JSON.parse(init.body);
      const page = body.pageToken ? 2 : 1;
      const places = Array.from({ length: page === 1 ? 20 : 5 }, (_, i) => ({
        id: `ChIJ${page}x${i}`, displayName: { text: `Yer ${page}-${i}` }, rating: 4.5, userRatingCount: 10,
        websiteUri: i === 0 ? "javascript:alert(1)" : "https://yer.com", location: { latitude: 40.7, longitude: 30.4 },
      }));
      return Response.json({ places, ...(page === 1 ? { nextPageToken: "t2" } : {}) });
    }
    return Response.json({ id: "ChIJdetay", displayName: { text: "Detay" }, nationalPhoneNumber: "0264 000 00 00" });
  };
  const g = new GooglePlacesClient("TEST-KEY", fetchImpl);
  const res = await g.searchText({ query: "diş kliniği", city: "Sakarya", district: "Serdivan", max: 30 });
  assert.equal(res.length, 25);
  assert.equal(calls.length, 2);
  const h = calls[0].init.headers;
  assert.equal(h["X-Goog-Api-Key"], "TEST-KEY");
  assert.match(h["X-Goog-FieldMask"], /places\.id/);
  assert.equal(JSON.parse(calls[0].init.body).textQuery, "diş kliniği Serdivan Sakarya");
  assert.equal(JSON.parse(calls[0].init.body).languageCode, "tr");
  assert.equal(res[0].website, undefined); // http(s) olmayan site düşürülür
  const det = await g.details(["ChIJdetay", "ChIJdetay", "../bad"], "contact");
  assert.deepEqual(Object.keys(det), ["ChIJdetay"]);
  assert.equal(calls.length, 3); // tekrar eden kimlik bir kez; geçersiz kimlik hiç
  assert.match(calls[2].init.headers["X-Goog-FieldMask"], /nationalPhoneNumber/);
  assert.equal(buildTextQuery({ query: " mobilya ", city: "Sakarya", max: 1 }), "mobilya Sakarya");
  assert.equal(mapGooglePlace({ displayName: { text: "id yok" } }), null);
});

/* ---------------- Günlük temas listesi (Bugün) ---------------- */

const pr = (id, extra = {}) => ({ id, status: "qualified", score: 50, next_action_at: null, last_contacted_at: null, email: null, phone: null, name: id, ...extra });

test("selectDailyList: puan sırası, ilk 10, 14 gün bekleme, erteleme, ret listesi, durum süzgeci", () => {
  const prospects = [
    ...Array.from({ length: 12 }, (_, i) => pr(`q${i}`, { score: 90 - i })),
    pr("recent", { score: 99, last_contacted_at: ago(13) }),
    pr("old", { score: 98, status: "contacted", last_contacted_at: ago(15) }),
    pr("msgRecent", { score: 97 }),
    pr("snoozed", { score: 96, next_action_at: "2026-10-12" }),
    pr("snoozeOver", { score: 95, next_action_at: "2026-10-08" }),
    pr("supEmail", { score: 94, email: "a@ret.com" }),
    pr("supPhone", { score: 93, phone: "0532 111 22 33" }),
    pr("new", { score: 100, status: "new" }),
    pr("replied", { score: 100, status: "replied" }),
    pr("suppressed", { score: 100, status: "suppressed" }),
  ];
  const messages = [{ prospect_id: "msgRecent", channel: "whatsapp", manual: true, status: "sent", sent_at: ago(3) }];
  const suppression = [{ kind: "domain", value: "ret.com" }, { kind: "phone", value: "5321112233" }];
  const list = selectDailyList(prospects, messages, suppression, { now: NOW });
  assert.equal(list.length, DAILY_LIST_SIZE);
  assert.deepEqual(list.map((x) => x.prospect.id), ["old", "snoozeOver", "q0", "q1", "q2", "q3", "q4", "q5", "q6", "q7"]);
  assert.equal(CONTACT_COOLDOWN_DAYS, 14);
  assert.equal(selectDailyList(prospects, messages, suppression, { now: NOW, limit: 3 }).length, 3);
});

test("selectDailyList: bugün temas edilen kart listede 'yapıldı' olarak kalır (liste gün içinde sabit)", () => {
  const prospects = Array.from({ length: 12 }, (_, i) => pr(`q${i}`, { score: 90 - i }));
  const before = selectDailyList(prospects, [], [], { now: NOW }).map((x) => x.prospect.id);
  const rec = manualContactRecord("q0", "phone", { id: "m1", now: NOW - 3_600_000 });
  const after = selectDailyList(
    prospects.map((p) => (p.id === "q0" ? { ...p, status: "contacted", last_contacted_at: rec.sent_at } : p)),
    [rec], [], { now: NOW },
  );
  assert.deepEqual(after.map((x) => x.prospect.id), before);
  assert.deepEqual(after[0].doneToday, ["phone"]);
  // ertesi gün: 14 gün bekleme başlar, yerine yenisi gelir
  const tomorrow = selectDailyList(prospects.map((p) => (p.id === "q0" ? { ...p, status: "contacted", last_contacted_at: rec.sent_at } : p)), [rec], [], { now: NOW + DAY });
  assert.equal(tomorrow.some((x) => x.prospect.id === "q0"), false);
  assert.equal(tomorrow.at(-1).prospect.id, "q10");
});

test("snoozePatch: bugün + 7 gün (İstanbul)", () => {
  assert.deepEqual(snoozePatch(NOW), { next_action_at: "2026-10-15" });
  assert.deepEqual(snoozePatch(Date.parse("2026-10-08T22:30:00Z")), { next_action_at: "2026-10-16" }); // İstanbul'da 9 Eki
});

/* ---------------- Manuel temas kaydı, sayaç, seri ---------------- */

test("manualContactRecord: kanal, manual=true, sent, e-posta alanları boş, gövde şablon", () => {
  const r = manualContactRecord("p1", "whatsapp", { id: "m1", now: NOW, template: "Merhaba {{isim}}" });
  assert.equal(r.channel, "whatsapp");
  assert.equal(r.manual, true);
  assert.equal(r.status, "sent");
  assert.equal(r.subject, "WhatsApp attım");
  assert.equal(r.body, "Merhaba {{isim}}"); // Places adı kopyalanmaz
  assert.equal(r.to_email, null);
  assert.equal(r.sequence_id, null);
  assert.equal(r.scheduled_for, null);
  assert.equal(r.sent_at, new Date(NOW).toISOString());
  assert.equal(manualContactRecord("p1", "phone", { id: "m2", now: NOW }).subject, "Aradım");
  assert.equal(manualContactRecord("p1", "instagram", { id: "m3", now: NOW }).subject, "DM attım");
});

test("contactStats: bugünkü sayaç ve seri (bugün boşsa dünden geriye)", () => {
  const m = (d, extra = {}) => ({ prospect_id: "p", channel: "phone", manual: true, status: "sent", sent_at: ago(d), ...extra });
  assert.deepEqual(contactStats([], NOW), { today: 0, streak: 0 });
  assert.deepEqual(contactStats([m(0), m(0), m(1), m(2), m(4)], NOW), { today: 2, streak: 3 });
  assert.deepEqual(contactStats([m(1), m(2)], NOW), { today: 0, streak: 2 });
  assert.deepEqual(contactStats([m(2), m(3)], NOW), { today: 0, streak: 0 });
  assert.deepEqual(contactStats([m(0, { manual: false, channel: "email" }), m(0, { status: "cancelled" })], NOW), { today: 0, streak: 0 });
});

/* ---------------- Manuel kanal bağlantıları ---------------- */

test("waNumber / whatsappLink / instagramLink / telLink", () => {
  assert.equal(waNumber("0532 111 22 33"), "905321112233");
  assert.equal(waNumber("+90 532 111 22 33"), "905321112233");
  assert.equal(waNumber("5321112233"), "905321112233");
  assert.equal(waNumber("0264 000 00 00"), "902640000000");
  assert.equal(waNumber("123"), null);
  const text = "Merhaba Demo Gülüş Diş Polikliniği, deneme & test?";
  const link = whatsappLink("0532 111 22 33", text);
  assert.ok(link.startsWith("https://wa.me/905321112233?text="));
  assert.equal(decodeURIComponent(link.split("text=")[1]), text);
  assert.ok(whatsappLink(null, "x").startsWith("https://wa.me/?text="));
  assert.equal(instagramLink("@demo.klinik"), "https://www.instagram.com/demo.klinik/");
  assert.equal(instagramLink("https://instagram.com/demo_klinik/?hl=tr"), "https://www.instagram.com/demo_klinik/");
  assert.equal(instagramLink("geçersiz kullanıcı"), null);
  assert.equal(normalizeInstagram("@dr.muratbulut54"), "dr.muratbulut54");
  assert.equal(telLink("0532 111 22 33"), "tel:+905321112233");
  assert.equal(telLink(""), null);
});

test("MANUAL_SCRIPTS: her sektörde WhatsApp / Instagram / telefon metni, adı içerir", () => {
  for (const [key, s] of Object.entries(MANUAL_SCRIPTS)) {
    for (const kind of ["whatsapp", "instagram", "phone"]) {
      const out = renderTemplate(s[kind], { isim: "Demo İşletme" });
      assert.ok(out.text.includes("Demo İşletme"), `${key}/${kind}`);
      assert.deepEqual(out.unknown, []);
    }
    // ~20 saniyelik konuşma: en fazla ~70 kelime
    assert.ok(s.phone.split(/\s+/).length <= 70, `${key} telefon metni kısa olmalı`);
  }
});

/* ---------------- Aday görünümü, köken, lead taslağı ---------------- */

test("prospectView: saklanan alan önce; Places adayında canlı veri yalnızca gösterim + atıf", () => {
  const p = { id: "x", source: "places", external_id: "pid", email: "info@a.com", phone: "0264 111 11 11", score: 0, score_breakdown: [], status: "qualified", created_at: "" };
  const v = prospectView(p, { placeId: "pid", name: "Canlı Ad", phone: "0264 999 99 99", website: "https://a.com" });
  assert.equal(v.name, "Canlı Ad");
  assert.equal(v.phone, "0264 111 11 11");
  assert.deepEqual(v.fromGoogle, ["name", "website"]);
  const csv = prospectView({ ...p, source: "csv", name: "CSV Ad" }, { placeId: "pid", name: "Canlı" });
  assert.equal(csv.name, "CSV Ad");
  assert.deepEqual(csv.fromGoogle, []);
  const lead = prospectToLeadDraft(v, "whatsapp", "2026-10-08");
  assert.equal(lead.company_name, "Canlı Ad");
  assert.equal(lead.source, "Müşteri Bulma (WhatsApp yanıtı)");
  assert.equal(lead.next_followup_at, "2026-10-09");
});

test("allowedFieldSource: Places adayında ad/adres/site yalnızca manual; telefon/e-posta website|manual", () => {
  assert.equal(allowedFieldSource("places", "name", "manual"), true);
  assert.equal(allowedFieldSource("places", "website", "website"), false);
  assert.equal(allowedFieldSource("places", "phone", "website"), true);
  assert.equal(allowedFieldSource("places", "email", "csv"), false);
  assert.equal(allowedFieldSource("csv", "website", "csv"), true);
});

test("firstStepDraft: ŞABLON taslak, planlanmamış; e-postasız aday için null", () => {
  const seq = { id: "s1", steps: DEFAULT_SEQUENCES[0].steps };
  const d = firstStepDraft(seq, { id: "p1", email: "Info@A.com", status: "qualified" }, { id: "m1", now: NOW });
  assert.equal(d.status, "draft");
  assert.equal(d.to_email, "info@a.com");
  assert.equal(d.scheduled_for, null);
  assert.equal(d.subject, DEFAULT_SEQUENCES[0].steps[0].subject);
  assert.equal(firstStepDraft(seq, { id: "p2", email: null, status: "qualified" }, { id: "m2", now: NOW }), null);
});

/* ---------------- CSV (18 hedef klinik) ---------------- */

test("hedef klinik CSV: gömülü kopya dosyayla aynı; 18 aday, qualified, şehir/ilçe, tekil external_id", () => {
  const onDisk = readFileSync(new URL("./data/hedef-klinikler-2026-10.csv", import.meta.url), "utf8").replace(/^﻿/, "").replace(/\r\n/g, "\n");
  assert.equal(HEDEF_KLINIKLER_CSV, onDisk, "CSV değişti: node scripts/growth-embed-csv.mjs");
  const rows = clinicCsvToProspects(HEDEF_KLINIKLER_CSV);
  assert.equal(rows.length, 18);
  assert.ok(rows.every((r) => r.status === "qualified" && r.source === "csv" && r.name && r.city));
  assert.equal(new Set(rows.map((r) => r.external_id)).size, 18);
  const vatan = rows.find((r) => r.name.startsWith("Vatan"));
  assert.equal(vatan.city, "Sakarya");
  assert.equal(vatan.district, "Serdivan");
  assert.equal(vatan.instagram, "vatandispoliklinigi");
  assert.equal(vatan.external_id, "csv:vatandental.com");
  assert.ok(vatan.score > 0 && vatan.score_breakdown.length === 8);
  assert.equal(rows.filter((r) => r.city === "Kocaeli").length, 7);
});

test("parseCsv: tırnak, kaçış, CRLF, boş satır", () => {
  assert.deepEqual(parseCsv('﻿a,b\r\n"x, y","say ""merhaba"""\r\n\r\nz,\n'), [["a", "b"], ["x, y", 'say "merhaba"'], ["z", ""]]);
});

/* ---------------- E-posta oluşturma / gönderici ---------------- */

test("buildOutgoingEmail: gönderen kimliği, B2B nedeni, ret bağlantısı, List-Unsubscribe başlıkları", () => {
  const url = "https://os.example/api/growth/unsubscribe?t=abc";
  const m = buildOutgoingEmail({ to: "a@b.com\r\nBcc: x@y.com", subject: "Konu\nBcc: z", body: "Merhaba", unsubscribeUrl: url, from: "Rast <hello@rastcreative.com>", unsubscribeMailto: "hello@rastcreative.com" });
  assert.ok(!m.to.includes("\n") && !m.subject.includes("\n"), "başlık enjeksiyonu engellenmeli");
  assert.ok(m.text.includes(SENDER_IDENTITY));
  assert.ok(m.text.includes("kurumsal (B2B)"));
  assert.ok(m.text.includes(url));
  assert.equal(m.headers["List-Unsubscribe"], `<${url}>, <mailto:hello@rastcreative.com?subject=${encodeURIComponent("Listeden çıkar")}>`);
  assert.equal(m.headers["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
  assert.equal(addressOf("Rast <hello@rastcreative.com>"), "hello@rastcreative.com");
});

test("createMailerFromEnv: SMTP_* eksikse NoopMailer (hiçbir şey göndermez)", async () => {
  const noop = createMailerFromEnv({});
  assert.equal(noop.kind, "noop");
  const r = await noop.send({ from: "a", to: "b", subject: "c", text: "d", headers: {} });
  assert.equal(r.ok, false);
  assert.ok(noop instanceof NoopMailer);
  assert.equal(smtpConfigFromEnv({ SMTP_HOST: "h", SMTP_USER: "u", SMTP_PASS: "p" }), null); // FROM yok
  assert.equal(smtpConfigFromEnv({ SMTP_HOST: "h", SMTP_USER: "u", SMTP_PASS: "p", SMTP_FROM: "a@b.co", SMTP_PORT: "x" }), null);
  assert.equal(createMailerFromEnv({ SMTP_HOST: "h", SMTP_USER: "u", SMTP_PASS: "p", SMTP_FROM: "a@b.co" }).kind, "smtp");
});
