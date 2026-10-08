// Çalıştırma: npm test  (Node'un yerleşik test runner'ı + type stripping)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CALL_TASK_PREFIX, MAX_BODY_BYTES, NEW_LEAD_WINDOW_MS, callTaskTitle, emailKey, isCallTask, isSameLead,
  leadDedupeKeys, leadNeedsFirstCall, leadSourceKind, leadsNeedingFirstCall, normalizeLeadPayload, phoneKey, sourceLabelFor,
} from "../src/lib/lead-logic.ts";
import {
  BodyTooLargeError, clientIp, createRateLimiter, parseLeadBody, readBodyLimited, secretsMatch,
} from "../src/lib/lead-intake.ts";

const enc = (s) => new TextEncoder().encode(s);
const form = { name: "Ayşe Kaya", company: "Kaya Klinik", phone: "0532 111 22 33", email: "Ayse@Kaya.com", project_type: "Hekim İçerik Sistemi", message: "Merhaba", kaynak: "hekim", paket: "standart" };

/* ---------------- Payload normalizasyonu ---------------- */

test("normalizes the contact-form field names", () => {
  const r = normalizeLeadPayload({ ...form, access_key: "x", subject: "y", utm_source: "ig", utm_campaign: " bahar " });
  assert.equal(r.ok, true);
  assert.deepEqual(r.value, {
    name: "Ayşe Kaya", company: "Kaya Klinik", phone: "0532 111 22 33", phone_key: "5321112233", email: "ayse@kaya.com",
    project_type: "Hekim İçerik Sistemi", message: "Merhaba", kaynak: "hekim", paket: "standart",
    utm: { utm_source: "ig", utm_campaign: "bahar" },
  });
});

test("name is required (>=2 chars) and one valid contact (phone or email) is required", () => {
  assert.equal(normalizeLeadPayload({ phone: "05321112233" }).ok, false);
  assert.equal(normalizeLeadPayload({ name: "A", phone: "05321112233" }).ok, false);
  assert.equal(normalizeLeadPayload({ name: "Ali Veli" }).ok, false);
  assert.equal(normalizeLeadPayload({ name: "Ali Veli", phone: "12345", email: "not-an-email" }).ok, false);
  assert.equal(normalizeLeadPayload({ name: "Ali Veli", email: "ali@x.io" }).ok, true);
  assert.equal(normalizeLeadPayload({ name: "Ali Veli", phone: 5321112233 }).ok, true); // JSON sayı
  for (const bad of [null, undefined, "x", 5, []]) assert.equal(normalizeLeadPayload(bad).ok, false);
});

test("invalid email is dropped when a valid phone exists; invalid phone dropped when email exists", () => {
  const a = normalizeLeadPayload({ name: "Ali Veli", phone: "0532 111 22 33", email: "bozuk" });
  assert.equal(a.value.email, null);
  const b = normalizeLeadPayload({ name: "Ali Veli", phone: "123", email: "a@b.co" });
  assert.equal(b.value.phone, null);
  assert.equal(b.value.phone_key, null);
});

test("honeypot (botcheck) is flagged as spam, falsy values are not", () => {
  const spam = normalizeLeadPayload({ ...form, botcheck: "on" });
  assert.equal(spam.ok, false);
  assert.equal(spam.spam, true);
  assert.equal(normalizeLeadPayload({ ...form, botcheck: "true" }).spam, true);
  for (const v of ["", "false", "0", "off", undefined]) assert.equal(normalizeLeadPayload({ ...form, botcheck: v }).ok, true);
});

test("kaynak / paket are allow-listed slugs; utm only known keys; long text is capped", () => {
  const r = normalizeLeadPayload({ ...form, kaynak: "HEKİM", paket: "x y", utm_source: "a".repeat(500), utm_evil: "1", message: "m".repeat(9000), name: "n".repeat(500) });
  assert.equal(r.value.kaynak, null); // TR büyük İ slug kuralına uymaz → yok sayılır
  assert.equal(r.value.paket, null);
  assert.equal(r.value.utm.utm_source.length, 120);
  assert.equal("utm_evil" in r.value.utm, false);
  assert.equal(r.value.message.length, 4000);
  assert.equal(r.value.name.length, 120);
  assert.equal(normalizeLeadPayload({ ...form, kaynak: "Hekim" }).value.kaynak, "hekim");
});

test("control characters are stripped", () => {
  const r = normalizeLeadPayload({ ...form, name: "Ali\u0000 Veli\u0007" });
  assert.equal(r.value.name, "Ali Veli");
});

test("source label and call-task title", () => {
  assert.equal(sourceLabelFor("hekim"), "Hekim sistemi (web sitesi)");
  assert.equal(sourceLabelFor(null), "Web sitesi");
  assert.equal(callTaskTitle("Ayşe Kaya"), "Lead'i 24 saat içinde ara: Ayşe Kaya");
});

/* ---------------- Tekilleştirme anahtarı ---------------- */

test("phoneKey: same number in any format maps to the same key", () => {
  const variants = ["0532 111 22 33", "+90 (532) 111 22 33", "905321112233", "5321112233", "0090 532 111-22-33"];
  for (const v of variants) assert.equal(phoneKey(v), "5321112233", v);
  assert.equal(phoneKey("0212 123 45 67"), "2121234567");
  assert.equal(phoneKey("123 45 67"), "1234567"); // 7 hane: olduğu gibi
  assert.equal(phoneKey("12345"), null);
  assert.equal(phoneKey(""), null);
  assert.equal(phoneKey(undefined), null);
});

test("emailKey lowercases/trims and rejects malformed addresses", () => {
  assert.equal(emailKey("  Ayse@Kaya.COM "), "ayse@kaya.com");
  for (const bad of ["", "a@b", "a b@c.de", "@x.io", null, undefined]) assert.equal(emailKey(bad), null);
});

test("isSameLead matches on email OR phone, never on two empty keys", () => {
  assert.equal(isSameLead({ email: "A@x.io" }, { email: "a@x.io" }), true);
  assert.equal(isSameLead({ phone: "0532 111 22 33" }, { phone: "+905321112233" }), true);
  assert.equal(isSameLead({ email: "a@x.io", phone: "0532 111 22 33" }, { email: "b@x.io", phone: "0533 000 00 00" }), false);
  assert.equal(isSameLead({}, {}), false);
  assert.equal(isSameLead({ phone: "123" }, { phone: "123" }), false);
  assert.deepEqual(leadDedupeKeys({ email: "A@x.io", phone: "0532 111 22 33" }), { email: "a@x.io", phone: "5321112233" });
});

/* ---------------- Sır karşılaştırma ---------------- */

test("secretsMatch: equal secrets match; different, empty and missing do not", () => {
  const s = "k".repeat(32);
  assert.equal(secretsMatch(s, s), true);
  assert.equal(secretsMatch(s + "x", s), false);
  assert.equal(secretsMatch(s.slice(1), s), false);
  assert.equal(secretsMatch("", s), false);
  assert.equal(secretsMatch(null, s), false);
  assert.equal(secretsMatch(s, ""), false);
  assert.equal(secretsMatch(undefined, undefined), false);
  assert.equal(secretsMatch("é".repeat(20), "é".repeat(20)), true); // çok baytlı karakterler
});

/* ---------------- Hız sınırı ---------------- */

test("rate limiter: 30 per minute per key, sliding window, keys independent", () => {
  const rl = createRateLimiter({ limit: 30, windowMs: 60_000 });
  const t0 = 1_000_000;
  for (let i = 0; i < 30; i++) assert.equal(rl.check("1.1.1.1", t0 + i * 10).ok, true);
  const blocked = rl.check("1.1.1.1", t0 + 400);
  assert.equal(blocked.ok, false);
  assert.equal(blocked.remaining, 0);
  assert.ok(blocked.retryAfterSec >= 59 && blocked.retryAfterSec <= 60);
  assert.equal(rl.check("2.2.2.2", t0 + 400).ok, true); // başka IP etkilenmez
  // İlk istek penceresinden çıkınca (60 sn sonra) bir hak açılır, ikincisi hâlâ doludur
  assert.equal(rl.check("1.1.1.1", t0 + 60_001).ok, true);
  assert.equal(rl.check("1.1.1.1", t0 + 60_002).ok, false);
  // Pencere tamamen geçince hepsi serbest
  assert.equal(rl.check("1.1.1.1", t0 + 130_000).remaining, 29);
});

test("rate limiter: blocked attempts are not counted and stale keys are pruned", () => {
  const rl = createRateLimiter({ limit: 2, windowMs: 1000, maxKeys: 3 });
  assert.equal(rl.check("a", 0).ok, true);
  assert.equal(rl.check("a", 1).ok, true);
  for (let i = 0; i < 10; i++) assert.equal(rl.check("a", 2 + i).ok, false);
  assert.equal(rl.check("a", 1001).ok, true); // yalnız ilk iki istek sayıldı; ilki düştü
  for (const k of ["b", "c", "d", "e"]) rl.check(k, 5000);
  rl.check("f", 9000); // maxKeys aşıldı → süresi dolanlar temizlenir
  assert.ok(rl.size() <= 3);
});

test("clientIp prefers x-real-ip, then first x-forwarded-for hop", () => {
  const h = (o) => ({ get: (k) => o[k] ?? null });
  assert.equal(clientIp(h({ "x-real-ip": "9.9.9.9", "x-forwarded-for": "1.1.1.1" })), "9.9.9.9");
  assert.equal(clientIp(h({ "x-forwarded-for": "1.1.1.1, 2.2.2.2" })), "1.1.1.1");
  assert.equal(clientIp(h({})), "unknown");
});

/* ---------------- Gövde sınırı ve çözümleme ---------------- */

test("readBodyLimited accepts <= 20 KB and rejects larger bodies (declared or streamed)", async () => {
  assert.equal(MAX_BODY_BYTES, 20 * 1024);
  const ok = new Request("http://x/api/leads", { method: "POST", body: "a".repeat(MAX_BODY_BYTES) });
  assert.equal((await readBodyLimited(ok, MAX_BODY_BYTES)).byteLength, MAX_BODY_BYTES);
  const big = new Request("http://x/api/leads", { method: "POST", body: "a".repeat(MAX_BODY_BYTES + 1) });
  await assert.rejects(() => readBodyLimited(big, MAX_BODY_BYTES), BodyTooLargeError);
  // Content-Length yalan söylese de (başlık küçük, gövde büyük) akış kesilir
  const stream = new ReadableStream({ start(c) { c.enqueue(enc("a".repeat(15_000))); c.enqueue(enc("a".repeat(15_000))); c.close(); } });
  const sneaky = new Request("http://x/api/leads", { method: "POST", body: stream, duplex: "half" });
  await assert.rejects(() => readBodyLimited(sneaky, MAX_BODY_BYTES), BodyTooLargeError);
});

test("parseLeadBody handles json, urlencoded and multipart; rejects the rest", async () => {
  assert.deepEqual(await parseLeadBody("application/json; charset=utf-8", enc(JSON.stringify({ name: "Ayşe", phone: 1 }))), { name: "Ayşe", phone: 1 });
  assert.equal(await parseLeadBody("application/json", enc("[1,2]")), null);
  assert.equal(await parseLeadBody("application/json", enc("{bozuk")), null);
  assert.deepEqual(await parseLeadBody("application/x-www-form-urlencoded", enc("name=Ay%C5%9Fe&phone=0532&kaynak=hekim")), { name: "Ayşe", phone: "0532", kaynak: "hekim" });
  const fd = new FormData();
  fd.set("name", "Ayşe");
  fd.set("message", "Merhaba");
  const req = new Request("http://x", { method: "POST", body: fd });
  const bytes = new Uint8Array(await req.arrayBuffer());
  assert.deepEqual(await parseLeadBody(req.headers.get("content-type"), bytes), { name: "Ayşe", message: "Merhaba" });
  assert.equal(await parseLeadBody("text/plain", enc("name=x")), null);
  assert.equal(await parseLeadBody(null, enc("{}")), null);
});

test("end to end: form body → normalized lead", async () => {
  const body = new URLSearchParams({ ...form, botcheck: "", access_key: "secret" }).toString();
  const parsed = await parseLeadBody("application/x-www-form-urlencoded", enc(body));
  const r = normalizeLeadPayload(parsed);
  assert.equal(r.ok, true);
  assert.equal(r.value.phone_key, "5321112233");
  assert.equal(JSON.stringify(r.value).includes("secret"), false);
});

/* ---------------- CRM görünümü ---------------- */

test("leadSourceKind: hekim / site / manuel from the source text", () => {
  const k = (source) => leadSourceKind({ source });
  assert.equal(k("Hekim sistemi (web sitesi)"), "hekim");
  assert.equal(k("Hekim hedef listesi (2026-10)"), "hekim");
  assert.equal(k("HEKİM"), "hekim");
  assert.equal(k("Web sitesi"), "site");
  assert.equal(k("web"), "site");
  for (const m of ["Referans", "Instagram", "Reklam", "LinkedIn", "Organik", "", undefined]) assert.equal(k(m), "manuel", String(m));
});

const NOW = Date.parse("2026-10-08T12:00:00Z");
const HOUR = 3_600_000;
const lead = (id, hoursAgo, status = "new") => ({ id, status, created_at: new Date(NOW - hoursAgo * HOUR).toISOString() });
const call = (lead_id, status = "todo", title = callTaskTitle("X")) => ({ lead_id, status, title });

test("isCallTask needs a lead link and the call-task prefix", () => {
  assert.equal(isCallTask(call("l1")), true);
  assert.equal(isCallTask({ lead_id: "l1", title: "lead'i 24 SAAT içinde ara: x" }), true);
  assert.equal(isCallTask({ lead_id: null, title: callTaskTitle("X") }), false);
  assert.equal(isCallTask({ lead_id: "l1", title: "Başka görev" }), false);
  assert.equal(CALL_TASK_PREFIX, "Lead'i 24 saat içinde ara");
});

test("badge: lead < 48h old with an open call task, none completed", () => {
  assert.equal(leadNeedsFirstCall(lead("l1", 1), [call("l1")], NOW), true);
  assert.equal(leadNeedsFirstCall(lead("l1", 47.9), [call("l1", "in_progress")], NOW), true);
  assert.equal(leadNeedsFirstCall(lead("l1", 48.1), [call("l1")], NOW), false); // 48 saati geçti
  assert.equal(NEW_LEAD_WINDOW_MS, 48 * HOUR);
  assert.equal(leadNeedsFirstCall(lead("l1", 1), [call("l1", "done")], NOW), false); // tamamlanmış arama
  assert.equal(leadNeedsFirstCall(lead("l1", 1), [call("l1", "done"), call("l1", "todo")], NOW), false);
  assert.equal(leadNeedsFirstCall(lead("l1", 1, "won"), [call("l1")], NOW), false);
  assert.equal(leadNeedsFirstCall(lead("l1", 1, "lost"), [call("l1")], NOW), false);
  assert.equal(leadNeedsFirstCall(lead("l1", 1), [call("l2")], NOW), false); // başka lead'in görevi
  assert.equal(leadNeedsFirstCall(lead("l1", 1), [{ lead_id: "l1", status: "todo", title: "Toplantı" }], NOW), false);
  assert.equal(leadNeedsFirstCall({ id: "l1", status: "new", created_at: "bozuk" }, [call("l1")], NOW), false);
  assert.equal(leadNeedsFirstCall(lead("l1", -2), [call("l1")], NOW), false); // gelecek tarih
});

test("badge: leads without a linked call task (manual / imported) get no badge", () => {
  assert.equal(leadNeedsFirstCall(lead("l1", 1), [], NOW), false);
});

test("leadsNeedingFirstCall returns the badged ids in one pass", () => {
  const leads = [lead("a", 2), lead("b", 5), lead("c", 100), lead("d", 3), lead("e", 1)];
  const tasks = [call("a"), call("b", "done"), call("c"), call("e", "todo", "Başka")];
  assert.deepEqual([...leadsNeedingFirstCall(leads, tasks, NOW)], ["a"]);
});

/* ---------------- SQL ile uyum ---------------- */

test("migration 0017 uses the same call-task prefix and phone-key rule as the TS code", () => {
  const sql = readFileSync(new URL("../supabase/migrations/0017_lead_intake_rpc.sql", import.meta.url), "utf8");
  assert.ok(sql.includes(CALL_TASK_PREFIX.replace("'", "''")), "arama görevi öneki");
  assert.ok(sql.includes("length(d) >= 10 then right(d, 10)"), "10+ hanede son 10 hane");
  assert.ok(sql.includes("length(d) >= 7 then d"), "7-9 hane olduğu gibi");
  assert.ok(sql.includes("'Hekim sistemi (web sitesi)'") && sourceLabelFor("hekim") === "Hekim sistemi (web sitesi)");
  assert.ok(sql.includes("v_hash <> encode(sha256("), "RPC sırrı doğrular");
});
