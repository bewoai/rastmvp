// Çalıştırma: npm test  (Node'un yerleşik test runner'ı + type stripping)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  activityEntity, activityFields, activityHref, activityRecord, activityValue,
} from "../src/lib/labels.ts";

test("every table with an activity-log trigger (0012, 0013, 0015, 0018) has a Turkish module label", () => {
  const sql = readFileSync(new URL("../supabase/migrations/0012_activity_logs_triggers.sql", import.meta.url), "utf8");
  const block = sql.match(/foreach t in array array\[([\s\S]*?)\]/);
  assert.ok(block, "trigger table list not found in 0012");
  const tables = [...block[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  // 0013, 0015 ve 0018 kendi tablolarına log_activity trigger'ını ayrıca bağlar
  // (0018 yalnızca belirli kolonların UPDATE'ini izler: "after insert or delete or update of …").
  const sql13 = ["0013_content_approvals.sql", "0015_client_reports.sql", "0018_client_portal.sql"]
    .map((f) => readFileSync(new URL(`../supabase/migrations/${f}`, import.meta.url), "utf8"))
    .join("\n");
  for (const m of sql13.matchAll(/create trigger ([a-z_]+)_activity_log\s+after insert[a-z_, \r\n]*?\bon public\.([a-z_]+)/g)) {
    assert.equal(m[1], m[2]);
    tables.push(m[2]);
  }
  assert.ok(tables.includes("content_approvals"), "0013 activity trigger not found");
  assert.ok(tables.includes("client_reports"), "0015 activity trigger not found");
  assert.ok(tables.includes("client_portal_tokens"), "0018 activity trigger not found");
  assert.deepEqual(tables.sort(), Object.keys(activityEntity).sort());
});

test("activityRecord: record_label, payment amount, short id fallback", () => {
  assert.equal(activityRecord({ entity: "clients", entity_id: "c1", record_label: "Mira Kozmetik" }), "Mira Kozmetik");
  const pay = activityRecord({ entity: "payments", entity_id: "p1", diff: { amount: { old: null, new: 30000 } } });
  assert.match(pay, /30\.000/);
  assert.equal(activityRecord({ entity: "tasks", entity_id: "0123456789abcdef" }), "#01234567");
  assert.equal(activityRecord({ entity: "tasks" }), "—");
});

test("activityFields / activityValue: Turkish field names and status labels", () => {
  assert.deepEqual(activityFields({ diff: { status: {}, paid_amount: {}, weird_col: {} } }), ["durum", "tahsil edilen", "weird_col"]);
  assert.equal(activityValue("invoices", "status", "partial"), "Kısmi ödendi");
  assert.equal(activityValue("proposals", "status", "sent"), "Gönderildi");
  assert.equal(activityValue("tasks", "priority", "urgent"), "Acil");
  assert.equal(activityValue("clients", "is_active", false), "Hayır");
  assert.equal(activityValue("clients", "notes", null), "—");
  assert.equal(activityValue("clients", "notes", "x".repeat(60)).length, 40);
});

test("activityHref: deleted records have no link; proposals open their editor", () => {
  assert.equal(activityHref({ entity: "clients", entity_id: "c1", action: "delete" }), undefined);
  assert.equal(activityHref({ entity: "proposals", entity_id: "pr1", action: "update" }), "/teklifler/pr1");
  assert.equal(activityHref({ entity: "payments", entity_id: "p1", action: "insert" }), "/finance/invoices");
});
