// Çalıştırma: npm test  (Node'un yerleşik test runner'ı + type stripping)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildMonthlyReport, defaultReportMonth, findReport, isValidMonth, localDay, localTime, monthLabelTR,
  normalizeHighlights, parsePoints, periodOf, shiftMonth,
} from "../src/lib/report-logic.ts";

const NOW = "2026-09-02T09:00:00.000Z";
const content = (id, over = {}) => ({ id, client_id: "c2", title: `İçerik ${id}`, platform: "Instagram", content_type: "reels", status: "idea", ...over });
const approval = (id, content_id, version, status, over = {}) => ({
  id, content_id, version, status, title: `Onay ${id}`,
  sent_at: "2026-08-10T10:00:00.000Z", expires_at: "2026-08-24T10:00:00.000Z",
  checklist: Array.from({ length: 8 }, (_, i) => ({ key: `k${i}`, label: "x", checked: status === "approved" })),
  ...over,
});
const shoot = (id, scheduled_at, over = {}) => ({ id, client_id: "c2", title: `Çekim ${id}`, scheduled_at, status: "planned", ...over });

const base = (over = {}) => ({ clientId: "c2", month: "2026-08", contents: [], shoots: [], approvals: [], now: NOW, ...over });

/* ---------------- Tarih yardımcıları ---------------- */

test("month helpers", () => {
  assert.equal(shiftMonth("2026-12", 1), "2027-01");
  assert.equal(shiftMonth("2026-01", -1), "2025-12");
  assert.equal(periodOf("2026-08"), "2026-08-01");
  assert.equal(defaultReportMonth("2026-10-08"), "2026-09");
  assert.equal(defaultReportMonth("2026-01-03"), "2025-12");
  assert.ok(isValidMonth("2026-08"));
  assert.ok(!isValidMonth("2026-13"));
  assert.ok(!isValidMonth("2026-8"));
  assert.equal(monthLabelTR("2026-08"), "Ağustos 2026");
});

test("localDay / localTime: date, local datetime and timestamptz", () => {
  assert.equal(localDay("2026-08-05"), "2026-08-05");
  assert.equal(localDay("2026-08-05T10:00"), "2026-08-05");
  assert.equal(localTime("2026-08-05T10:00"), "10:00");
  assert.equal(localTime("2026-08-05"), "");
  assert.equal(localDay(""), "");
  assert.equal(localDay(null), "");
  // timestamptz → yerel güne çevrilir (test ortamının saat dilimi neyse)
  const ts = "2026-08-31T22:30:00+00:00";
  const d = new Date(ts);
  const expected = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  assert.equal(localDay(ts), expected);
});

/* ---------------- İçerik sayıları ---------------- */

test("planned vs published counts come only from records; other clients and archived are excluded", () => {
  const contents = [
    content("a", { planned_date: "2026-08-03", status: "published" }),
    content("b", { planned_date: "2026-08-10", status: "published", published_date: "2026-08-12" }),
    content("c", { planned_date: "2026-08-20", status: "editing" }),
    content("d", { planned_date: "2026-08-25", status: "archived" }),
    content("e", { planned_date: "2026-08-05", status: "published", client_id: "c1" }),
    // Temmuz'da planlanıp Ağustos'ta yayınlandı → yayınlanan sayılır, planlanan sayılmaz
    content("f", { planned_date: "2026-07-28", status: "published", published_date: "2026-08-02" }),
    // Ağustos'ta planlanıp Eylül'de yayınlandı → Ağustos planlanan, Ağustos yayınlanan değil
    content("g", { planned_date: "2026-08-30", status: "published", published_date: "2026-09-01" }),
  ];
  const r = buildMonthlyReport(base({ contents }));
  assert.equal(r.summary.planned, 4);            // a, b, c, g
  assert.equal(r.summary.published, 3);          // a, b, f
  assert.equal(r.summary.publishedFromPlan, 2);  // a, b
  assert.equal(r.summary.contents, 5);           // a, b, c, f, g
  assert.deepEqual(r.contents.map((c) => c.id), ["f", "a", "b", "c", "g"]);
  // Yayınlanan içerikte tarih = yayın tarihi; g henüz Ağustos'ta yayınlanmadı ama satırında yayın günü görünür
  assert.equal(r.contents.find((c) => c.id === "b").date, "2026-08-12");
  assert.equal(r.contents.find((c) => c.id === "c").channel, "Instagram · reels");
});

test("empty month: all zero, nothing invented", () => {
  const r = buildMonthlyReport(base());
  assert.deepEqual(r.summary, {
    planned: 0, published: 0, publishedFromPlan: 0, contents: 0,
    approvals: { approved: 0, pending: 0, changes_requested: 0, expired: 0, none: 0 },
    shoots: 0, shootDays: 0,
  });
  assert.deepEqual(r.contents, []);
  assert.deepEqual(r.approvalRecords, []);
  assert.deepEqual(r.nextMonthPlan, []);
});

/* ---------------- Onaylar ---------------- */

test("approval distribution uses the latest version's effective status", () => {
  const contents = [
    content("a", { planned_date: "2026-08-03" }),
    content("b", { planned_date: "2026-08-04" }),
    content("c", { planned_date: "2026-08-05" }),
    content("d", { planned_date: "2026-08-06" }),
  ];
  const approvals = [
    approval("a1", "a", 1, "changes_requested", { decided_at: "2026-08-11T10:00:00Z", decided_by_name: "Dr. A" }),
    approval("a2", "a", 2, "approved", { decided_at: "2026-08-12T10:00:00Z", decided_by_name: "Dr. A" }),
    // süresi dolmuş bekleyen → expired
    approval("b1", "b", 1, "pending"),
    // süresi dolmamış bekleyen
    approval("c1", "c", 1, "pending", { expires_at: "2026-09-10T00:00:00Z" }),
  ];
  const r = buildMonthlyReport(base({ contents, approvals }));
  assert.deepEqual(r.summary.approvals, { approved: 1, pending: 1, changes_requested: 0, expired: 1, none: 1 });
  assert.deepEqual(r.contents.find((c) => c.id === "a").approval, { version: 2, status: "approved" });
  assert.equal(r.contents.find((c) => c.id === "d").approval, null);
});

test("approval records: all versions of listed contents + this month's decisions of other client contents", () => {
  const contents = [
    content("a", { planned_date: "2026-08-03" }),
    content("old", { planned_date: "2026-06-01" }),
    content("older", { planned_date: "2026-05-01" }),
    content("x", { planned_date: "2026-08-03", client_id: "c1" }),
  ];
  const approvals = [
    approval("a2", "a", 2, "approved", { decided_at: "2026-08-12T10:00:00Z", decided_by_name: "Dr. A" }),
    approval("a1", "a", 1, "pending"), // yenisi var → expired görünür
    approval("o1", "old", 1, "approved", { sent_at: "2026-06-01T10:00:00Z", decided_at: "2026-08-02T10:00:00Z", decided_by_name: "Dr. B" }),
    approval("q1", "older", 1, "approved", { sent_at: "2026-05-01T10:00:00Z", decided_at: "2026-05-02T10:00:00Z" }),
    approval("x1", "x", 1, "approved", { decided_at: "2026-08-12T10:00:00Z" }),
    approval("gone", null, 1, "approved", { decided_at: "2026-08-12T10:00:00Z" }),
  ];
  const r = buildMonthlyReport(base({ contents, approvals }));
  assert.deepEqual(r.approvalRecords.map((a) => [a.id, a.version, a.status]), [
    ["a1", 1, "expired"],
    ["a2", 2, "approved"],
    ["o1", 1, "approved"],
  ]);
  const a2 = r.approvalRecords.find((a) => a.id === "a2");
  assert.equal(a2.decidedBy, "Dr. A");
  assert.equal(a2.checked, 8);
  assert.equal(a2.total, 8);
  assert.equal(a2.contentTitle, "İçerik a");
});

/* ---------------- Çekimler / gelecek ay ---------------- */

test("shoots of the month sorted; shoot days count distinct non-cancelled days", () => {
  const shoots = [
    shoot("s2", "2026-08-07T14:00"),
    shoot("s1", "2026-08-07T10:00", { status: "completed" }),
    shoot("s3", "2026-08-20T10:00", { status: "cancelled" }),
    shoot("s4", "2026-09-01T10:00"),
    shoot("s5", "2026-08-09T10:00", { client_id: "c1" }),
  ];
  const r = buildMonthlyReport(base({ shoots }));
  assert.deepEqual(r.shoots.map((s) => [s.id, s.date, s.time]), [
    ["s1", "2026-08-07", "10:00"], ["s2", "2026-08-07", "14:00"], ["s3", "2026-08-20", "10:00"],
  ]);
  assert.equal(r.summary.shoots, 3);
  assert.equal(r.summary.shootDays, 1);
});

test("next month plan: client's non-archived contents planned next month", () => {
  const contents = [
    content("n1", { planned_date: "2026-09-15" }),
    content("n2", { planned_date: "2026-09-02", status: "script_ready" }),
    content("n3", { planned_date: "2026-09-03", status: "archived" }),
    content("n4", { planned_date: "2026-10-01" }),
    content("n5", { planned_date: "2026-09-05", client_id: "c1" }),
  ];
  const r = buildMonthlyReport(base({ contents }));
  assert.equal(r.nextMonth, "2026-09");
  assert.deepEqual(r.nextMonthPlan.map((c) => c.id), ["n2", "n1"]);
});

/* ---------------- Notlar ---------------- */

test("points / highlights normalisation", () => {
  assert.deepEqual(parsePoints("- Bir\n\n• İki \n  üç  "), ["Bir", "İki", "üç"]);
  assert.deepEqual(normalizeHighlights({ points: " \n", ads_note: "  " }), {});
  assert.deepEqual(normalizeHighlights({ points: "a\nb", ads_note: " GİP: yok " }), { points: ["a", "b"], ads_note: "GİP: yok" });
  assert.deepEqual(normalizeHighlights({ points: ["x", " "] }), { points: ["x"] });
});

test("findReport matches client + month (date or timestamp period)", () => {
  const reports = [
    { id: "r1", client_id: "c2", period: "2026-08-01" },
    { id: "r2", client_id: "c2", period: "2026-09-01T00:00:00+00:00" },
  ];
  assert.equal(findReport(reports, "c2", "2026-08")?.id, "r1");
  assert.equal(findReport(reports, "c2", "2026-09")?.id, "r2");
  assert.equal(findReport(reports, "c1", "2026-08"), undefined);
});

/* ---------------- Migration / dürüstlük ---------------- */

test("0015: client_reports is org-scoped, unique per client+month, no ad metric columns", () => {
  const sql = readFileSync(new URL("../supabase/migrations/0015_client_reports.sql", import.meta.url), "utf8");
  assert.match(sql, /create table if not exists public\.client_reports/);
  assert.match(sql, /unique \(organization_id, client_id, period\)/);
  assert.match(sql, /check \(period = date_trunc\('month', period\)::date\)/);
  assert.match(sql, /create policy client_reports_org_all on public\.client_reports for all\s+to authenticated\s+using \(organization_id = current_org_id\(\)\)\s+with check \(organization_id = current_org_id\(\)\)/);
  assert.match(sql, /revoke all on public\.client_reports from anon;/);
  assert.match(sql, /add column if not exists proposal_id uuid/);
  assert.match(sql, /projects_proposal_unique\s+on public\.projects\(proposal_id\) where proposal_id is not null/);
  const table = sql.slice(sql.indexOf("create table if not exists public.client_reports"), sql.indexOf("create index if not exists idx_client_reports_org"));
  assert.doesNotMatch(table, /impression|click|reach|ctr|spend|gosterim|tiklama/i);
});

test("report pages never render ad metrics", () => {
  for (const f of ["../src/lib/report-logic.ts", "../src/app/(app)/raporlar/aylik/[clientId]/[yyyy-mm]/yazdir/page.tsx"]) {
    const src = readFileSync(new URL(f, import.meta.url), "utf8");
    assert.doesNotMatch(src, /insights|impressions|\bctr\b|\bcpc\b|\breach\b/i, f);
  }
});
