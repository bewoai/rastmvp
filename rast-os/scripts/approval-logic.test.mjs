// Çalıştırma: npm test  (Node'un yerleşik test runner'ı + type stripping)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  APPROVAL_CHECKLIST, APPROVAL_TRANSITIONS, APPROVAL_TTL_DAYS, approvalPath, approvalShareText, canTransition,
  checkedCount, daysLeft, decide, effectiveStatus, expiresAtFrom, generateToken, isChecklistComplete, isPastExpiry,
  isValidToken, latestByContent, missingChecks, newChecklist, nextVersion, tokenFromBytes, validateDecision,
  versionsFor, whatsappShareUrl,
} from "../src/lib/approval-logic.ts";

const sql = readFileSync(new URL("../supabase/migrations/0013_content_approvals.sql", import.meta.url), "utf8");
const ALL_KEYS = APPROVAL_CHECKLIST.map((i) => i.key);
const T0 = "2026-10-08T09:00:00.000Z";

const pending = (over = {}) => ({
  id: "a1", content_id: "co1", version: 1, token: "a".repeat(64), title: "Video", checklist: newChecklist(),
  script_snapshot: "Metin", status: "pending", sent_at: T0, expires_at: expiresAtFrom(T0), created_at: T0, ...over,
});

/* ---------------- Token ---------------- */

test("token format: exactly 64 lowercase hex chars", () => {
  assert.equal(isValidToken("0123456789abcdef".repeat(4)), true);
  assert.equal(isValidToken("0123456789ABCDEF".repeat(4)), false); // büyük harf yok
  assert.equal(isValidToken("a".repeat(63)), false);
  assert.equal(isValidToken("a".repeat(65)), false);
  assert.equal(isValidToken("g".repeat(64)), false);
  assert.equal(isValidToken(`${"a".repeat(60)}/../`), false);
  assert.equal(isValidToken(undefined), false);
  assert.equal(isValidToken(null), false);
});

test("generateToken: 256-bit, valid format, never repeats", () => {
  const seen = new Set();
  for (let i = 0; i < 500; i++) {
    const t = generateToken();
    assert.ok(isValidToken(t), t);
    seen.add(t);
  }
  assert.equal(seen.size, 500);
  assert.equal(tokenFromBytes(new Uint8Array(32).fill(255)), "f".repeat(64));
  assert.equal(tokenFromBytes(new Uint8Array(32)), "0".repeat(64));
  assert.throws(() => tokenFromBytes(new Uint8Array(16)));
});

test("DB generates the same token shape (gen_random_bytes(32) → hex, CHECK)", () => {
  assert.match(sql, /encode\(gen_random_bytes\(32\), 'hex'\)/);
  assert.match(sql, /check \(token ~ '\^\[0-9a-f\]\{64\}\$'\)/);
  // İstemci token'ı seçemez: guard trigger insert'te üzerine yazar.
  assert.match(sql, /new\.token\s+:= public\.approval_new_token\(\)/);
});

test("approvalPath / share links", () => {
  const t = "b".repeat(64);
  assert.equal(approvalPath(t), `/onay/${t}`);
  const url = whatsappShareUrl("Merhaba & onay: https://x.test/onay/abc?x=1");
  assert.ok(url.startsWith("https://wa.me/?text="));
  assert.equal(decodeURIComponent(url.slice("https://wa.me/?text=".length)), "Merhaba & onay: https://x.test/onay/abc?x=1");
  const text = approvalShareText({ title: "Kardiyoloji", version: 2, url: "https://x.test/onay/t", expiresAt: "2026-10-22T09:00:00Z" });
  assert.match(text, /"Kardiyoloji"/);
  assert.match(text, /v2/);
  assert.match(text, /https:\/\/x\.test\/onay\/t/);
});

/* ---------------- Süre ---------------- */

test("expiry: 14 days after sending, boundary counts as expired", () => {
  assert.equal(APPROVAL_TTL_DAYS, 14);
  const exp = expiresAtFrom(T0);
  assert.equal(exp, "2026-10-22T09:00:00.000Z");
  const a = { expires_at: exp };
  assert.equal(isPastExpiry(a, "2026-10-22T08:59:59.999Z"), false);
  assert.equal(isPastExpiry(a, exp), true); // DB: expires_at <= now()
  assert.equal(isPastExpiry(a, "2026-11-01T00:00:00Z"), true);
  assert.equal(isPastExpiry({ expires_at: "geçersiz" }, T0), true); // bozuk tarih → kapalı
  assert.equal(daysLeft(a, T0), 14);
  assert.equal(daysLeft(a, "2026-10-21T10:00:00Z"), 1);
  assert.equal(daysLeft(a, "2026-12-01T00:00:00Z"), 0);
  assert.match(sql, /expires_at\s+timestamptz not null default \(now\(\) \+ interval '14 days'\)/);
});

test("effectiveStatus: pending expires by time or when a newer version exists", () => {
  const a = pending();
  assert.equal(effectiveStatus(a, T0), "pending");
  assert.equal(effectiveStatus(a, "2026-10-23T00:00:00Z"), "expired");
  assert.equal(effectiveStatus(a, T0, true), "expired");
  // Kararlar kalıcı: süre dolsa da / yeni sürüm gelse de değişmez
  assert.equal(effectiveStatus({ ...a, status: "approved" }, "2027-01-01T00:00:00Z", true), "approved");
  assert.equal(effectiveStatus({ ...a, status: "changes_requested" }, "2027-01-01T00:00:00Z"), "changes_requested");
});

/* ---------------- Kontrol listesi ---------------- */

test("checklist: 8 items mirroring the vault template, same as the DB default", () => {
  assert.equal(APPROVAL_CHECKLIST.length, 8);
  assert.equal(new Set(ALL_KEYS).size, 8);
  const fromSql = [...sql.matchAll(/jsonb_build_object\('key', '([^']+)', 'label', '([^']+)', 'basis', '([^']+)', 'checked', false\)/g)]
    .map((m) => ({ key: m[1], label: m[2], basis: m[3] }));
  assert.deepEqual(fromSql, APPROVAL_CHECKLIST.map(({ key, label, basis }) => ({ key, label, basis })));
  assert.equal(APPROVAL_CHECKLIST[0].basis, "5/d");
  assert.equal(APPROVAL_CHECKLIST[7].basis, "4/h, 5/c");
  assert.ok(newChecklist().every((i) => i.checked === false));
});

test("completeness gate: cannot approve unless all 8 are checked", () => {
  const list = newChecklist();
  assert.equal(isChecklistComplete(list, []), false);
  assert.equal(isChecklistComplete(list, ALL_KEYS.slice(0, 7)), false);
  assert.deepEqual(missingChecks(list, ALL_KEYS.slice(1)), ["uzmanlik"]);
  assert.equal(isChecklistComplete(list, ALL_KEYS), true);
  assert.equal(isChecklistComplete(list, new Set([...ALL_KEYS, "fazladan"])), true);
  assert.equal(isChecklistComplete([], []), false); // boş liste onayı açmaz

  const base = { decision: "approved", name: "Dr. Ayşe Yılmaz" };
  assert.equal(validateDecision({ ...base, checked: ALL_KEYS.slice(0, 7) }, list), "checklist_incomplete");
  assert.equal(validateDecision({ ...base, checked: ALL_KEYS }, list), null);
  // Değişiklik talebi listeyi gerektirmez, not gerektirir
  assert.equal(validateDecision({ decision: "changes_requested", name: "Dr. Ayşe Yılmaz", checked: [] }, list), "note_required");
  assert.equal(validateDecision({ decision: "changes_requested", name: "Dr. Ayşe Yılmaz", note: "2. cümle çıksın" }, list), null);
  // RPC de aynı kapıyı uygular
  assert.match(sql, /p_decision = 'approved' and not \(v_keys <@ v_checked\)/);
});

test("validateDecision: decision type, name and note limits", () => {
  const list = newChecklist();
  assert.equal(validateDecision({ decision: "maybe", name: "Dr. A B", checked: ALL_KEYS }, list), "invalid_decision");
  assert.equal(validateDecision({ decision: "approved", name: "  ", checked: ALL_KEYS }, list), "name_required");
  assert.equal(validateDecision({ decision: "approved", name: "Al", checked: ALL_KEYS }, list), "name_required");
  assert.equal(validateDecision({ decision: "approved", name: "x".repeat(121), checked: ALL_KEYS }, list), "name_required");
  assert.equal(validateDecision({ decision: "approved", name: "Dr. A B", note: "x".repeat(2001), checked: ALL_KEYS }, list), "note_too_long");
});

/* ---------------- Durum geçişleri ---------------- */

test("status transitions: only pending can move; decisions are final", () => {
  assert.equal(canTransition("pending", "approved"), true);
  assert.equal(canTransition("pending", "changes_requested"), true);
  assert.equal(canTransition("pending", "expired"), true);
  assert.equal(canTransition("pending", "pending"), false);
  for (const from of ["approved", "changes_requested", "expired"]) {
    for (const to of Object.keys(APPROVAL_TRANSITIONS)) assert.equal(canTransition(from, to), false, `${from}→${to}`);
  }
  assert.match(sql, /check \(status in \('pending','approved','changes_requested','expired'\)\)/);
});

test("decide: approve records ticks, name, time; second decision is rejected", () => {
  const now = "2026-10-09T10:30:00.000Z";
  const r = decide(pending(), { decision: "approved", name: "  Dr. Ayşe Yılmaz ", note: "  ", checked: ALL_KEYS }, now);
  assert.equal(r.ok, true);
  assert.equal(r.approval.status, "approved");
  assert.equal(r.approval.decided_by_name, "Dr. Ayşe Yılmaz");
  assert.equal(r.approval.decided_at, now);
  assert.equal(r.approval.note, null);
  assert.equal(checkedCount(r.approval.checklist), 8);

  const again = decide(r.approval, { decision: "changes_requested", name: "Dr. Ayşe Yılmaz", note: "x" }, now);
  assert.deepEqual(again, { ok: false, error: "already_decided" });
});

test("decide: changes requested keeps partial ticks and the note", () => {
  const r = decide(pending(), { decision: "changes_requested", name: "Dr. Ayşe Yılmaz", note: "Ücret ifadesi çıksın", checked: ["uzmanlik", "hasta"] }, T0);
  assert.equal(r.ok, true);
  assert.equal(r.approval.status, "changes_requested");
  assert.equal(r.approval.note, "Ücret ifadesi çıksın");
  assert.deepEqual(r.approval.checklist.filter((i) => i.checked).map((i) => i.key), ["uzmanlik", "hasta"]);
});

test("decide: expired, superseded and incomplete requests are refused", () => {
  const input = { decision: "approved", name: "Dr. Ayşe Yılmaz", checked: ALL_KEYS };
  const late = decide(pending(), input, "2026-10-22T09:00:00.000Z");
  assert.equal(late.ok, false);
  assert.equal(late.error, "expired");
  assert.equal(late.approval.status, "expired");
  assert.equal(decide(pending(), input, T0, true).error, "expired");
  assert.equal(decide(pending({ status: "expired" }), input, T0).error, "expired");
  assert.equal(decide(pending(), { ...input, checked: ALL_KEYS.slice(0, 7) }, T0).error, "checklist_incomplete");
  // Girdi hatası kayıt durumundan önce (RPC sırası)
  assert.equal(decide(pending({ status: "approved" }), { ...input, name: "" }, T0).error, "name_required");
});

/* ---------------- Sürümler ---------------- */

test("versions: next number, newest first, latest per content", () => {
  const list = [
    pending({ id: "x1", content_id: "co1", version: 1 }),
    pending({ id: "x3", content_id: "co1", version: 3 }),
    pending({ id: "x2", content_id: "co1", version: 2 }),
    pending({ id: "y1", content_id: "co2", version: 1 }),
    pending({ id: "z1", content_id: null, version: 7 }), // içeriği silinmiş kayıt
  ];
  assert.equal(nextVersion(list, "co1"), 4);
  assert.equal(nextVersion(list, "co9"), 1);
  assert.deepEqual(versionsFor(list, "co1").map((a) => a.version), [3, 2, 1]);
  const latest = latestByContent(list);
  assert.equal(latest.get("co1").id, "x3");
  assert.equal(latest.get("co2").id, "y1");
  assert.equal(latest.size, 2);
});

/* ---------------- Güvenlik / bağlantı ---------------- */

test("RPCs are security definer with fixed search_path and granted to anon", () => {
  for (const fn of ["approval_get", "approval_decide"]) {
    const body = sql.slice(sql.indexOf(`create or replace function public.${fn}(`));
    const head = body.slice(0, body.indexOf("as $$"));
    assert.match(head, /security definer/, fn);
    assert.match(head, /set search_path = public/, fn);
    assert.match(sql, new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\) to anon, authenticated;`), fn);
    assert.match(sql, new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\) from public;`), fn);
  }
  assert.match(sql, /revoke all on public\.content_approvals from anon;/);
  // Karar verilmiş kayıt silinemez
  assert.match(sql, /for delete\s+to authenticated\s+using \(organization_id = current_org_id\(\) and status in \('pending', 'expired'\)\)/);
});

test("proxy lets /onay/* through when login is required", () => {
  const mw = readFileSync(new URL("../src/lib/supabase/middleware.ts", import.meta.url), "utf8");
  const pub = mw.slice(mw.indexOf("const isPublic"), mw.indexOf("const redirectToLogin"));
  assert.match(pub, /path\.startsWith\("\/onay\/"\)/);
});

test("demo seed: one pending and one approved approval with valid tokens", () => {
  // seed.ts uzantısız import kullandığı için Node'da doğrudan yüklenemez; kaynak metinden doğrulanır.
  const src = readFileSync(new URL("../src/lib/seed.ts", import.meta.url), "utf8");
  const tokens = src.slice(src.indexOf("DEMO_APPROVAL_TOKENS = {"), src.indexOf("} as const;"));
  const values = [...tokens.matchAll(/(pending|approved): "([^"]+)"/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(values.map(([k]) => k), ["pending", "approved"]);
  for (const [, t] of values) assert.ok(isValidToken(t), t);
  assert.notEqual(values[0][1], values[1][1]);
  const block = src.slice(src.indexOf("content_approvals: ["), src.indexOf("activity_logs: ["));
  assert.deepEqual([...block.matchAll(/status: "([a-z_]+)"/g)].map((m) => m[1]).sort(), ["approved", "pending"]);
  assert.match(block, /token: DEMO_APPROVAL_TOKENS\.pending/);
  assert.match(block, /checked: true/);
});
