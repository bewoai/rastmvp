// Çalıştırma: npm test  (Node'un yerleşik test runner'ı + type stripping)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildPortalPayload, buildPortalReportData, findActivePortalToken, isValidPortalToken, istanbulDay, istanbulTime,
  portalApprovalRef, portalMonths, portalPath, portalReportInput, portalReportPath, portalShareText, portalTokenState,
  splitByMonth,
} from "../src/lib/portal-logic.ts";
import { buildMonthlyReport } from "../src/lib/report-logic.ts";

const NOW = "2026-10-08T09:00:00.000Z"; // İstanbul: 8 Ekim 2026 12:00
const TOKEN = "a".repeat(64);
const OTHER = "b".repeat(64);

const tokenRow = (over = {}) => ({ id: "t1", client_id: "c2", token: TOKEN, created_at: "2026-10-01T10:00:00Z", revoked_at: null, expires_at: null, ...over });
const content = (id, over = {}) => ({ id, client_id: "c2", title: `İçerik ${id}`, platform: "Instagram", content_type: "reels", status: "idea", ...over });
const approval = (content_id, version, status, over = {}) => ({
  content_id, version, status, title: `Onay ${content_id} v${version}`,
  token: `${content_id}${version}`.padEnd(64, "0").replace(/[^0-9a-f]/g, "0"),
  sent_at: "2026-10-01T10:00:00.000Z", expires_at: "2026-10-15T10:00:00.000Z",
  decided_at: null, decided_by_name: null,
  checklist: Array.from({ length: 8 }, (_, i) => ({ key: `k${i}`, label: "x", checked: status === "approved" })),
  ...over,
});
const shoot = (id, scheduled_at, over = {}) => ({ id, client_id: "c2", title: `Çekim ${id}`, shoot_type: "Röportaj", scheduled_at, location: "Stüdyo", status: "planned", ...over });

const source = (over = {}) => ({
  token: TOKEN,
  tokens: [tokenRow()],
  clients: [{ id: "c2", name: "Adatıp Sağlık Grubu" }, { id: "c9", name: "Başka Müşteri" }],
  contents: [],
  shoots: [],
  approvals: [],
  reports: [],
  agencyName: "Rast Creative",
  creatorName: "Berat",
  now: NOW,
  ...over,
});

/* ---------------- Token ---------------- */

test("token format and paths", () => {
  assert.ok(isValidPortalToken(TOKEN));
  assert.ok(!isValidPortalToken("A".repeat(64)));
  assert.ok(!isValidPortalToken("a".repeat(63)));
  assert.ok(!isValidPortalToken(null));
  assert.equal(portalPath(TOKEN), `/portal/${TOKEN}`);
  assert.equal(portalReportPath(TOKEN, "2026-09"), `/portal/${TOKEN}/rapor/2026-09`);
});

test("portalTokenState: revoked > expired > active", () => {
  assert.equal(portalTokenState(tokenRow(), NOW), "active");
  assert.equal(portalTokenState(tokenRow({ expires_at: "2026-12-01T00:00:00Z" }), NOW), "active");
  assert.equal(portalTokenState(tokenRow({ expires_at: NOW }), NOW), "expired"); // expires_at anı dahil (SQL: > now())
  assert.equal(portalTokenState(tokenRow({ expires_at: "2026-10-01T00:00:00Z" }), NOW), "expired");
  assert.equal(portalTokenState(tokenRow({ revoked_at: "2026-10-02T00:00:00Z", expires_at: "2026-10-01T00:00:00Z" }), NOW), "revoked");
  assert.equal(portalTokenState(tokenRow({ expires_at: "çöp" }), NOW), "expired");
});

test("revoked / expired / unknown / malformed tokens are refused", () => {
  const base = { contents: [content("x", { planned_date: "2026-10-10" })] };
  assert.ok(buildPortalPayload(source(base)));
  assert.equal(buildPortalPayload(source({ ...base, tokens: [tokenRow({ revoked_at: "2026-10-05T00:00:00Z" })] })), null);
  assert.equal(buildPortalPayload(source({ ...base, tokens: [tokenRow({ expires_at: "2026-10-07T00:00:00Z" })] })), null);
  assert.equal(buildPortalPayload(source({ ...base, token: OTHER })), null);
  assert.equal(buildPortalPayload(source({ ...base, token: TOKEN.toUpperCase() })), null);
  assert.equal(buildPortalPayload(source({ ...base, token: "" })), null);
  // Token'ın müşterisi silinmişse de reddedilir
  assert.equal(buildPortalPayload(source({ ...base, clients: [] })), null);
  assert.equal(findActivePortalToken([tokenRow()], `${TOKEN} `, NOW), null);
});

/* ---------------- Ay pencereleri ---------------- */

test("portalMonths: current + previous month in Europe/Istanbul", () => {
  assert.deepEqual(portalMonths(NOW), { today: "2026-10-08", current: "2026-10", previous: "2026-09" });
  // UTC'de hâlâ 30 Eylül, İstanbul'da 1 Ekim
  assert.deepEqual(portalMonths("2026-09-30T22:30:00Z"), { today: "2026-10-01", current: "2026-10", previous: "2026-09" });
  // Yıl dönümü
  assert.deepEqual(portalMonths("2027-01-05T09:00:00Z"), { today: "2027-01-05", current: "2027-01", previous: "2026-12" });
});

test("istanbulDay / istanbulTime: date, wall time and timestamptz", () => {
  assert.equal(istanbulDay("2026-10-05"), "2026-10-05");
  assert.equal(istanbulDay("2026-10-05T23:30"), "2026-10-05"); // saat dilimsiz = duvar saati
  assert.equal(istanbulDay("2026-10-05T22:30:00Z"), "2026-10-06"); // UTC+3
  assert.equal(istanbulDay("2026-10-05T22:30:00+00:00"), "2026-10-06");
  assert.equal(istanbulTime("2026-10-05T22:30:00Z"), "01:30");
  assert.equal(istanbulTime("2026-10-05T10:15"), "10:15");
  assert.equal(istanbulDay(""), "");
  assert.equal(istanbulDay("çöp"), "");
});

test("contents: only previous + current month, own client, no archive; published uses published_date", () => {
  const p = buildPortalPayload(source({
    contents: [
      content("oct", { planned_date: "2026-10-20" }),
      content("oct-early", { planned_date: "2026-10-02", title: "B erken" }),
      content("sep", { planned_date: "2026-09-30" }),
      content("aug", { planned_date: "2026-08-31" }),
      content("nov", { planned_date: "2026-11-01" }),
      content("arch", { planned_date: "2026-10-10", status: "archived" }),
      content("other", { planned_date: "2026-10-10", client_id: "c9" }),
      // Eylül'de planlanıp Ekim'de yayınlanan → Ekim
      content("pub", { planned_date: "2026-09-25", published_date: "2026-10-03", status: "published" }),
      // Yayın tarihi yoksa planlanan
      content("pub2", { planned_date: "2026-09-12", status: "published" }),
      content("nodate"),
    ],
  }));
  assert.deepEqual(p.months, { current: "2026-10", previous: "2026-09" });
  assert.deepEqual(p.contents.map((c) => c.title), [
    "İçerik pub2", "İçerik sep", "B erken", "İçerik pub", "İçerik oct",
  ]);
  const { current, previous } = splitByMonth(p);
  assert.deepEqual(current.map((c) => c.date), ["2026-10-02", "2026-10-03", "2026-10-20"]);
  assert.deepEqual(previous.map((c) => c.date), ["2026-09-12", "2026-09-30"]);
  assert.equal(p.contents[0].channel, "Instagram · reels");
  assert.equal(p.client_name, "Adatıp Sağlık Grubu");
});

test("shoots: window, Istanbul day, cancelled excluded, sorted", () => {
  const p = buildPortalPayload(source({
    shoots: [
      shoot("s1", "2026-10-15T14:00"),
      shoot("s2", "2026-09-30T21:30:00Z"), // İstanbul 1 Ekim 00:30
      shoot("s3", "2026-09-05T10:00"),
      shoot("s4", "2026-08-30T10:00"),
      shoot("s5", "2026-10-10T10:00", { status: "cancelled" }),
      shoot("s6", "2026-10-11T10:00", { client_id: "c9" }),
      shoot("s7", null),
    ],
  }));
  assert.deepEqual(p.shoots.map((s) => `${s.date} ${s.time}`), ["2026-09-05 10:00", "2026-10-01 00:30", "2026-10-15 14:00"]);
  assert.deepEqual(Object.keys(p.shoots[0]).sort(), ["date", "location", "status", "time", "type"]);
});

/* ---------------- Onay bağlantısı ---------------- */

test("portalApprovalRef: token only while effectively pending", () => {
  const pending = approval("c1", 1, "pending");
  assert.deepEqual(portalApprovalRef(pending, NOW), { version: 1, status: "pending", token: pending.token, expires_at: pending.expires_at });
  const expired = portalApprovalRef(approval("c1", 1, "pending", { expires_at: "2026-10-08T09:00:00.000Z" }), NOW);
  assert.equal(expired.status, "expired");
  assert.equal(expired.token, null);
  assert.equal(expired.expires_at, null);
  for (const st of ["approved", "changes_requested", "expired"]) {
    const r = portalApprovalRef(approval("c1", 1, st), NOW);
    assert.equal(r.status, st);
    assert.equal(r.token, null, st);
  }
});

test("payload exposes approval links only for pending latest versions; pending list ignores month window", () => {
  const p = buildPortalPayload(source({
    contents: [
      content("p1", { planned_date: "2026-10-12" }),          // bekleyen v2 (v1 eski bekleyen)
      content("p2", { planned_date: "2026-10-14" }),          // onaylı
      content("p3", { planned_date: "2026-10-16" }),          // değişiklik istendi
      content("p4", { planned_date: "2026-10-18" }),          // bekleyen ama süresi dolmuş
      content("p5", { planned_date: "2026-08-20" }),          // pencere dışında, bekliyor
      content("p6", { planned_date: "2026-10-22" }),          // onaya hiç gönderilmemiş
      content("p7", { planned_date: "2026-10-23", status: "archived" }), // arşiv: bekliyor olsa da gizli
    ],
    approvals: [
      approval("p1", 1, "pending", { expires_at: "2026-10-20T00:00:00Z" }),
      approval("p1", 2, "pending", { expires_at: "2026-10-21T00:00:00Z" }),
      approval("p2", 1, "pending"),
      approval("p2", 2, "approved", { decided_at: "2026-10-03T10:00:00Z", decided_by_name: "Dr. Test" }),
      approval("p3", 1, "changes_requested"),
      approval("p4", 1, "pending", { expires_at: "2026-10-01T00:00:00Z" }),
      approval("p5", 3, "pending", { expires_at: "2026-10-10T00:00:00Z" }),
      approval("p7", 1, "pending"),
    ],
  }));
  const byTitle = Object.fromEntries(p.contents.map((c) => [c.title, c.approval]));
  assert.equal(byTitle["İçerik p1"].version, 2);
  assert.equal(byTitle["İçerik p1"].status, "pending");
  assert.match(byTitle["İçerik p1"].token, /^[0-9a-f]{64}$/);
  assert.equal(byTitle["İçerik p1"].token, approval("p1", 2, "pending").token);
  assert.deepEqual(byTitle["İçerik p2"], { version: 2, status: "approved", token: null, expires_at: null });
  assert.equal(byTitle["İçerik p3"].token, null);
  assert.equal(byTitle["İçerik p4"].status, "expired");
  assert.equal(byTitle["İçerik p4"].token, null);
  assert.equal(byTitle["İçerik p6"], null);
  assert.ok(!("İçerik p5" in byTitle));
  assert.ok(!("İçerik p7" in byTitle));

  // pending: p5 (10 Ekim'de biter) önce, sonra p1 (21 Ekim)
  assert.equal(p.pending_count, 2);
  assert.deepEqual(p.pending.map((x) => [x.title, x.version]), [["Onay p5 v3", 3], ["Onay p1 v2", 2]]);
  // Bekleyen olmayan hiçbir onayın token'ı yükte yer almaz
  const json = JSON.stringify(p);
  for (const a of [approval("p1", 1, "pending"), approval("p2", 2, "approved"), approval("p3", 1, "changes_requested"), approval("p4", 1, "pending"), approval("p7", 1, "pending")]) {
    assert.ok(!json.includes(a.token), `${a.content_id} v${a.version} token sızdı`);
  }
});

/* ---------------- Rapor ---------------- */

test("latest_report: newest period not after the current month; contact line fallback", () => {
  const reports = [
    { client_id: "c2", period: "2026-08-01", notes: "Ağustos", highlights: { points: ["a"] }, generated_at: "2026-09-01T10:00:00Z" },
    { client_id: "c2", period: "2026-09-01", notes: "Eylül", highlights: {}, generated_at: "2026-10-01T10:00:00Z" },
    { client_id: "c2", period: "2026-11-01", notes: "Gelecek", highlights: {}, generated_at: "2026-10-01T10:00:00Z" },
    { client_id: "c9", period: "2026-10-01", notes: "Başkası", highlights: {}, generated_at: "2026-10-01T10:00:00Z" },
  ];
  const p = buildPortalPayload(source({ reports }));
  assert.equal(p.latest_report.month, "2026-09");
  assert.equal(p.latest_report.notes, "Eylül");
  assert.equal(p.contact_line, "Rast Creative · Berat");
  const q = buildPortalPayload(source({ tokens: [tokenRow({ contact_line: "  Rast · 0532  " })] }));
  assert.equal(q.contact_line, "Rast · 0532");
  assert.equal(q.latest_report, null);
  assert.equal(buildPortalPayload(source({ creatorName: null })).contact_line, "Rast Creative");
});

test("buildPortalReportData: only saved months, refuses revoked tokens, never exposes approval tokens", () => {
  const src = source({
    brands: [{ client_id: "c2", name: "Adatıp Hastanesi" }, { client_id: "c9", name: "X" }],
    contents: [
      content("a1", { planned_date: "2026-09-10", status: "published", published_date: "2026-09-11" }),
      content("a2", { planned_date: "2026-10-04" }),        // gelecek ay planı
      content("a3", { planned_date: "2026-07-01" }),        // onayı Eylül'de verildi
      content("a4", { planned_date: "2026-06-01" }),        // ilgisiz
      content("a5", { planned_date: "2026-09-10", client_id: "c9" }),
    ],
    approvals: [
      approval("a1", 1, "approved", { decided_at: "2026-09-05T10:00:00Z", decided_by_name: "Dr. Test" }),
      approval("a3", 1, "approved", { sent_at: "2026-08-25T10:00:00Z", decided_at: "2026-09-02T10:00:00Z", decided_by_name: "Dr. Test" }),
      approval("a2", 1, "pending"),
    ],
    shoots: [shoot("s1", "2026-09-15T10:00"), shoot("s2", "2026-10-15T10:00")],
    reports: [{ client_id: "c2", period: "2026-09-01", notes: "Not", highlights: { points: ["P"] }, generated_at: "2026-10-01T10:00:00Z" }],
  });
  assert.equal(buildPortalReportData(src, "2026-08"), null, "kaydedilmemiş ay açılmaz");
  assert.equal(buildPortalReportData(src, "2026-9"), null);
  assert.equal(buildPortalReportData({ ...src, tokens: [tokenRow({ revoked_at: "2026-10-01T00:00:00Z" })] }, "2026-09"), null);

  const d = buildPortalReportData(src, "2026-09");
  assert.deepEqual(d.contents.map((c) => c.title).sort(), ["İçerik a1", "İçerik a2", "İçerik a3"]);
  assert.deepEqual(d.brand_names, ["Adatıp Hastanesi"]);
  assert.equal(d.shoots.length, 1);
  assert.equal(d.report.notes, "Not");
  const json = JSON.stringify(d);
  for (const a of src.approvals) assert.ok(!json.includes(a.token), "rapor verisinde onay token'ı olmamalı");
  assert.ok(!json.includes('"id"'), "rapor verisinde iç id olmamalı");

  // RPC verisi → buildMonthlyReport: iç rapor kurallarıyla aynı sayılar
  const r = buildMonthlyReport(portalReportInput(d, NOW));
  assert.equal(r.summary.published, 1);
  assert.equal(r.summary.planned, 1);
  assert.equal(r.summary.shoots, 1);
  assert.deepEqual(r.nextMonthPlan.map((c) => c.title), ["İçerik a2"]);
  assert.deepEqual(r.approvalRecords.map((a) => a.contentTitle).sort(), ["İçerik a1", "İçerik a3"]);
});

test("portalShareText mentions the link and the privacy warning", () => {
  const t = portalShareText({ clientName: "Adatıp", url: "https://x/portal/abc" });
  assert.match(t, /Adatıp/);
  assert.match(t, /https:\/\/x\/portal\/abc/);
  assert.match(t, /paylaşmayın/);
});

/* ---------------- SQL (0018) ve demo seed ---------------- */

test("0018: table closed to anon; only the three portal RPCs are executable by anon", () => {
  const sql = readFileSync(new URL("../supabase/migrations/0018_client_portal.sql", import.meta.url), "utf8");
  assert.match(sql, /revoke all on public\.client_portal_tokens from anon;/);
  assert.match(sql, /alter table public\.client_portal_tokens enable row level security;/);
  assert.match(sql, /to authenticated\s+using \(organization_id = current_org_id\(\)\)\s+with check \(organization_id = current_org_id\(\)\)/);
  const anonGrants = [...sql.matchAll(/grant execute on function public\.([a-z_]+)\([^)]*\) to ([a-z_, ]+);/g)];
  assert.deepEqual(anonGrants.map((m) => m[1]).sort(), ["portal_get", "portal_report_get", "portal_touch"]);
  for (const m of anonGrants) assert.equal(m[2].trim(), "anon", `${m[1]} yalnızca anon'a açılmalı`);
  assert.doesNotMatch(sql, /grant [a-z, ]+ on public\.client_portal_tokens to anon/);
  assert.match(sql, /revoke all on function public\.portal_active_token\(text\) from public, anon, authenticated;/);
  // Her RPC security definer + sabit search_path
  for (const fn of ["portal_get", "portal_touch", "portal_report_get", "portal_active_token"]) {
    const body = sql.slice(sql.indexOf(`function public.${fn}(`));
    assert.match(body.slice(0, 400), /security definer\s+set search_path = public/, fn);
  }
  // Token: 0013 üreticisi, 64 hex
  assert.match(sql, /token\s+text not null default public\.approval_new_token\(\)/);
  assert.match(sql, /check \(token ~ '\^\[0-9a-f\]\{64\}\$'\)/);
  // Onay token'ı yalnızca bekleyen sürümde
  assert.match(sql, /case when l\.eff = 'pending' then l\.token end/);
  // Rapor yalnızca kayıtlı ay için
  assert.match(sql, /from public\.client_reports\s+where organization_id = t\.organization_id and client_id = t\.client_id and period = v_start;\s+if not found then\s+return null;/);
});

test("demo seed: one active and one revoked portal token for Adatıp", () => {
  // seed.ts uzantısız import kullandığı için Node'da doğrudan yüklenemez; kaynak metinden doğrulanır.
  const src = readFileSync(new URL("../src/lib/seed.ts", import.meta.url), "utf8");
  const block = src.match(/DEMO_PORTAL_TOKENS = \{([\s\S]*?)\} as const/);
  assert.ok(block, "DEMO_PORTAL_TOKENS bulunamadı");
  const tokens = [...block[1].matchAll(/(\w+): "([^"]+)"/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(tokens.map(([k]) => k), ["active", "revoked"]);
  for (const [, t] of tokens) assert.ok(isValidPortalToken(t));
  assert.match(src, /id: "cpt1", client_id: "c2", token: DEMO_PORTAL_TOKENS\.active/);
  assert.match(src, /id: "cpt0", client_id: "c2", token: DEMO_PORTAL_TOKENS\.revoked,[\s\S]*?revoked_at: daysAgo\(10\)/);
});
