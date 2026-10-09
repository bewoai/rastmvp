// Çalıştırma: npm test  (Node'un yerleşik test runner'ı + type stripping)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_LEAD_NOTICES, RECENT_DAYS, countUnread, deriveNotices, mergeReadIds, parseReadIds, titleWithCount,
} from "../src/lib/notifications.ts";

const NOW = new Date("2026-10-09T10:00:00+03:00");
const ago = (d) => new Date(NOW.getTime() - d * 86_400_000).toISOString();
const empty = { invoices: [], expenses: [], tasks: [], contents: [], leads: [], content_approvals: [], proposals: [], clients: [] };
const lead = (id, created, status = "new") => ({ id, company_name: `Firma ${id}`, contact_person: "Ali", source: "Web", status, created_at: created });
const approval = (id, status, decided, extra = {}) => ({
  id, content_id: `co-${id}`, version: 1, token: "x", title: `İçerik ${id}`, checklist: [], status,
  sent_at: ago(20), expires_at: ago(-10), created_at: ago(20), decided_at: decided, decided_by_name: "Dr. Kemal", ...extra,
});
const proposal = (id, status, updated) => ({ id, client_id: "c1", title: `Teklif ${id}`, proposal_no: `RC-${id}`, status, currency: "TRY", vat_rate: 20, created_at: ago(30), updated_at: updated });

test("boş veri → bildirim yok", () => {
  assert.deepEqual(deriveNotices(empty, NOW), []);
});

test("yeni lead'ler: yalnız status new, en yeni önce, ilk N tek tek + kalanı tek satır", () => {
  const leads = [
    ...Array.from({ length: MAX_LEAD_NOTICES + 2 }, (_, i) => lead(`l${i}`, ago(i))),
    lead("eski", ago(1), "contacted"),
  ];
  const n = deriveNotices({ ...empty, leads }, NOW);
  const items = n.filter((x) => x.kind === "lead");
  assert.equal(items.length, MAX_LEAD_NOTICES);
  assert.equal(items[0].id, "lead:l0");
  assert.equal(items[0].href, "/crm/leads?ac=l0");
  assert.ok(!n.some((x) => x.id === "lead:eski"));
  const more = n.find((x) => x.kind === "leads-more");
  assert.equal(more?.title, "2 yeni lead daha");
  assert.equal(more?.id, `leads-more:${MAX_LEAD_NOTICES + 2}`);
});

test("içerik onayları: yalnız karar verilmiş (onay / revize) ve son RECENT_DAYS gün", () => {
  const n = deriveNotices({
    ...empty,
    content_approvals: [
      approval("a1", "approved", ago(1)),
      approval("a2", "changes_requested", ago(2), { note: "Giriş cümlesi değişsin." }),
      approval("a3", "pending", null),
      approval("a4", "approved", ago(RECENT_DAYS + 1)),
      approval("a5", "expired", ago(1)),
    ],
  }, NOW);
  assert.deepEqual(n.map((x) => x.id), ["approval:a1:approved", "approval:a2:changes_requested"]);
  assert.equal(n[0].title, "Müşteri onayladı: İçerik a1");
  assert.equal(n[0].tone, "success");
  assert.equal(n[0].href, "/content?ac=co-a1");
  assert.equal(n[1].title, "Revize istendi: İçerik a2");
  assert.equal(n[1].body, "Dr. Kemal · Giriş cümlesi değişsin.");
  // İçerik silinmişse (content_id null) içerik takvimine gider
  const orphan = deriveNotices({ ...empty, content_approvals: [approval("a6", "approved", ago(1), { content_id: null })] }, NOW);
  assert.equal(orphan[0].href, "/content");
});

test("teklifler: kabul / red edilenler (son güncellemeye göre); taslak / gönderilen yok", () => {
  const n = deriveNotices({
    ...empty,
    clients: [{ id: "c1", name: "Aytaş Home", is_active: true, created_at: ago(100) }],
    proposals: [
      proposal("p1", "accepted", ago(3)),
      proposal("p2", "rejected", ago(1)),
      proposal("p3", "sent", ago(1)),
      proposal("p4", "accepted", ago(RECENT_DAYS + 3)),
    ],
  }, NOW);
  assert.deepEqual(n.map((x) => x.id), ["proposal:p2:rejected", "proposal:p1:accepted"]);
  assert.equal(n[0].title, "Teklif reddedildi: Teklif p2");
  assert.equal(n[0].body, "RC-p2 · Aytaş Home");
  assert.equal(n[1].href, "/teklifler/p1");
});

test("olaylar zamana göre karışık sıralanır; toplu hatırlatmalar sonda ve kimlikte sayı var", () => {
  const n = deriveNotices({
    ...empty,
    leads: [lead("l1", ago(0.1))],
    content_approvals: [approval("a1", "approved", ago(2))],
    proposals: [proposal("p1", "accepted", ago(1))],
    invoices: [
      { id: "i1", amount: 100, vat: 20, paid_amount: 0, status: "issued", created_at: ago(5) },
      { id: "i2", amount: 100, vat: 20, paid_amount: 120, status: "paid", created_at: ago(5) },
    ],
    expenses: [{ id: "x1", amount: 1, vat: 0, payment_status: "pending", is_recurring: false, created_at: ago(1) }],
    tasks: [
      { id: "t1", title: "a", priority: "medium", status: "todo", due_date: "2026-10-09", created_at: ago(1) },
      { id: "t2", title: "b", priority: "medium", status: "todo", due_date: "2026-10-30", created_at: ago(1) },
      { id: "t3", title: "c", priority: "medium", status: "done", due_date: "2026-10-10", created_at: ago(1) },
    ],
    contents: [{ id: "c1", title: "x", status: "editing", planned_date: "2026-10-12", created_at: ago(1) }],
  }, NOW);
  assert.deepEqual(n.map((x) => x.id), [
    "lead:l1", "proposal:p1:accepted", "approval:a1:approved",
    "unpaid-invoices:1", "pending-expenses:1", "upcoming-tasks:1", "upcoming-content:1",
  ]);
});

test("okunmamış sayısı ve okundu kimliklerinin birleştirilmesi", () => {
  const notices = [{ id: "a" }, { id: "b" }, { id: "c" }];
  assert.equal(countUnread(notices, []), 3);
  assert.equal(countUnread(notices, ["a", "zzz"]), 2);
  assert.equal(countUnread(notices, new Set(["a", "b", "c"])), 0);
  assert.deepEqual(mergeReadIds(["a", "b"], ["b", "c"]), ["a", "b", "c"]);
  assert.deepEqual(mergeReadIds(["a", "b", "c"], ["d"], 3), ["b", "c", "d"]);
});

test("parseReadIds: bozuk / beklenmeyen localStorage değeri → boş", () => {
  assert.deepEqual(parseReadIds(null), []);
  assert.deepEqual(parseReadIds("{bozuk"), []);
  assert.deepEqual(parseReadIds('{"a":1}'), []);
  assert.deepEqual(parseReadIds('["a", 3, "b"]'), ["a", "b"]);
});

test("titleWithCount: '(n) ' öneki eklenir / güncellenir / kaldırılır", () => {
  assert.equal(titleWithCount("Görevler · Rast OS", 3), "(3) Görevler · Rast OS");
  assert.equal(titleWithCount("(3) Görevler · Rast OS", 5), "(5) Görevler · Rast OS");
  assert.equal(titleWithCount("(5) Görevler · Rast OS", 0), "Görevler · Rast OS");
  assert.equal(titleWithCount("Bugün · Rast OS", 120), "(99+) Bugün · Rast OS");
  assert.equal(titleWithCount("(99+) Bugün · Rast OS", 2), "(2) Bugün · Rast OS");
});
