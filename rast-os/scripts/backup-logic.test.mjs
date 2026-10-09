// Çalıştırma: npm test  (Node'un yerleşik test runner'ı + type stripping)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BACKUP_PAGE_SIZE, BACKUP_STALE_DAYS, backupAgeLabel, backupFileName, buildBackup, daysSinceBackup, fetchAllRows, isBackupStale,
} from "../src/lib/backup-logic.ts";

/** Sahte Supabase istemcisi: tablo → satırlar; range çağrılarını kaydeder. `fail`: o tablo hata döner. */
function fakeClient(data, { fail = [] } = {}) {
  const calls = [];
  return {
    calls,
    from(table) {
      return {
        select: (cols) => ({
          order: (col, opts) => ({
            range: async (from, to) => {
              calls.push({ table, cols, col, asc: opts.ascending, from, to });
              if (fail.includes(table)) return { data: null, error: { message: "permission denied" } };
              return { data: (data[table] ?? []).slice(from, to + 1), error: null };
            },
          }),
        }),
      };
    },
  };
}
const rows = (n) => Array.from({ length: n }, (_, i) => ({ id: `r${i}` }));

test("fetchAllRows pages with range until a short page (2500 rows → 3 requests)", async () => {
  const c = fakeClient({ leads: rows(2500) });
  const r = await fetchAllRows(c, "leads");
  assert.equal(r.error, undefined);
  assert.equal(r.rows.length, 2500);
  assert.deepEqual(c.calls.map((x) => [x.from, x.to]), [[0, 999], [1000, 1999], [2000, 2999]]);
  assert.ok(c.calls.every((x) => x.cols === "*" && x.col === "id" && x.asc === true));
});

test("fetchAllRows: exact multiple of the page size needs one extra (empty) request", async () => {
  const c = fakeClient({ jobs: rows(BACKUP_PAGE_SIZE) });
  const r = await fetchAllRows(c, "jobs");
  assert.equal(r.rows.length, BACKUP_PAGE_SIZE);
  assert.equal(c.calls.length, 2);
});

test("fetchAllRows: empty / missing table → no rows, single request", async () => {
  const c = fakeClient({});
  const r = await fetchAllRows(c, "tasks");
  assert.deepEqual(r, { rows: [] });
  assert.equal(c.calls.length, 1);
});

test("fetchAllRows returns the error instead of partial data", async () => {
  const c = fakeClient({ leads: rows(5) }, { fail: ["leads"] });
  assert.deepEqual(await fetchAllRows(c, "leads"), { rows: [], error: "permission denied" });
});

test("buildBackup: {exported_at, organization_id, tables}; failed tables go to errors, others still included", async () => {
  const c = fakeClient({ leads: rows(2), jobs: rows(1) }, { fail: ["prospects"] });
  const seen = [];
  const now = new Date("2026-10-09T12:00:00Z");
  const p = await buildBackup(c, ["leads", "jobs", "prospects"], "org-1", now, (d, t, tbl) => seen.push([d, t, tbl]));
  assert.equal(p.exported_at, "2026-10-09T12:00:00.000Z");
  assert.equal(p.organization_id, "org-1");
  assert.deepEqual(Object.keys(p.tables), ["leads", "jobs"]);
  assert.equal(p.tables.leads.length, 2);
  assert.deepEqual(p.errors, { prospects: "permission denied" });
  assert.deepEqual(seen, [[1, 3, "leads"], [2, 3, "jobs"], [3, 3, "prospects"]]);
});

test("buildBackup: no errors key when everything succeeds", async () => {
  const p = await buildBackup(fakeClient({ leads: rows(1) }), ["leads"], null, new Date());
  assert.equal("errors" in p, false);
  assert.equal(p.organization_id, null);
});

test("backupFileName uses the local date, zero-padded", () => {
  assert.equal(backupFileName(new Date(2026, 0, 5, 23, 59)), "rast-os-yedek-2026-01-05.json");
  assert.equal(backupFileName(new Date(2026, 9, 9, 0, 1)), "rast-os-yedek-2026-10-09.json");
});

test("backup age: days, stale threshold (>7 days or never), labels", () => {
  const now = Date.parse("2026-10-20T12:00:00Z");
  const ago = (d) => new Date(now - d * 86_400_000 - 1000).toISOString();
  assert.equal(BACKUP_STALE_DAYS, 7);
  assert.equal(daysSinceBackup(null, now), null);
  assert.equal(daysSinceBackup("bozuk", now), null);
  assert.equal(daysSinceBackup(ago(0), now), 0);
  assert.equal(daysSinceBackup(new Date(now + 5 * 86_400_000).toISOString(), now), 0); // gelecek tarih
  assert.equal(isBackupStale(null, now), true);
  assert.equal(isBackupStale(ago(6), now), false);
  assert.equal(isBackupStale(new Date(now - 7 * 86_400_000).toISOString(), now), false); // tam 7 gün: henüz eski değil
  assert.equal(isBackupStale(ago(7), now), false); // "7 gün önce" hâlâ uyarı değil; 8. günde uyarı başlar
  assert.equal(isBackupStale(ago(8), now), true);
  assert.equal(backupAgeLabel(null, now), "Henüz yedek alınmadı");
  assert.equal(backupAgeLabel(ago(0), now), "Son yedek bugün");
  assert.equal(backupAgeLabel(ago(9), now), "Son yedek 9 gün önce");
});
