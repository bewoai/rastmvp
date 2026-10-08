// Çalıştırma: npm test  (Node'un yerleşik test runner'ı + type stripping)
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeMrr, monthlyItemValue, mrrProgress } from "../src/lib/mrr.ts";

const prop = (id, client_id, status, over = {}) => ({ id, client_id, title: `Teklif ${id}`, status, currency: "TRY", ...over });
const item = (proposal_id, unit_price, over = {}) => ({ proposal_id, qty: 1, unit: "ay", unit_price, is_recurring: true, ...over });
const clients = [
  { id: "c1", name: "Aytaş Home", monthly_fee: 35000, is_active: true },
  { id: "c2", name: "Adatıp", monthly_fee: 60000, is_active: true },
  { id: "c3", name: "Mira", monthly_fee: undefined, is_active: true },
  { id: "c4", name: "Eski Müşteri", monthly_fee: 10000, is_active: false },
];
const inv = (client_id, issue_date, amount, over = {}) => ({ client_id, issue_date, amount, status: "issued", created_at: issue_date, ...over });
const base = { monthStart: "2026-10-01", today: "2026-10-08", clients };

/* ---------------- Teklifler ---------------- */

test("only accepted proposals count; draft/sent/rejected/expired do not", () => {
  const proposals = ["draft", "sent", "accepted", "rejected", "expired"].map((s, i) => prop(`p${i}`, "c1", s));
  const proposalItems = proposals.map((p) => item(p.id, 10000));
  const r = computeMrr({ ...base, proposals, proposalItems });
  assert.equal(r.mrr, 10000);
  assert.deepEqual(r.byClient.map((x) => [x.client, x.amount, x.source]), [["Aytaş Home", 10000, "proposal"]]);
});

test("one-off items are excluded; recurring items summed (qty x price)", () => {
  const proposals = [prop("p1", "c1", "accepted")];
  const proposalItems = [
    item("p1", 4800),
    item("p1", 1500, { qty: 2 }),
    item("p1", 99999, { is_recurring: false, unit: "adet" }),
  ];
  assert.equal(computeMrr({ ...base, proposals, proposalItems }).mrr, 7800);
});

test("KDV is never added: unit prices are KDV-hariç, vat_rate ignored", () => {
  const proposals = [prop("p1", "c1", "accepted", { vat_rate: 20 })];
  const r = computeMrr({ ...base, proposals, proposalItems: [item("p1", 25000)] });
  assert.equal(r.mrr, 25000); // 30.000 (KDV dahil) değil
});

test("yearly recurring unit is divided by 12", () => {
  assert.equal(monthlyItemValue({ qty: 1, unit_price: 12000, unit: "yıl" }), 1000);
  assert.equal(monthlyItemValue({ qty: 1, unit_price: 12000, unit: "ay" }), 12000);
  assert.equal(monthlyItemValue({ qty: 2, unit_price: 500, unit: "adet" }), 1000);
});

test("multiple accepted proposals of one client are summed; clientless proposal uses its title", () => {
  const proposals = [prop("p1", "c1", "accepted"), prop("p2", "c1", "accepted"), prop("p3", null, "accepted", { title: "Kavis Mimarlık" })];
  const proposalItems = [item("p1", 20000), item("p2", 5000), item("p3", 3000)];
  const r = computeMrr({ ...base, proposals, proposalItems });
  assert.equal(r.mrr, 28000);
  assert.deepEqual(r.byClient.map((x) => [x.client, x.amount]), [["Aytaş Home", 25000], ["Kavis Mimarlık", 3000]]);
});

test("foreign currency converts with rates; missing rate skips that proposal", () => {
  const proposals = [prop("p1", "c1", "accepted", { currency: "USD" }), prop("p2", "c2", "accepted", { currency: "EUR" })];
  const proposalItems = [item("p1", 1000), item("p2", 1000)];
  const r = computeMrr({ ...base, proposals, proposalItems, rates: { usd: 40 } });
  assert.equal(r.mrr, 40000);
  assert.equal(r.byClient.length, 1);
});

test("accepted proposal without recurring items contributes nothing", () => {
  const r = computeMrr({ ...base, proposals: [prop("p1", "c1", "accepted")], proposalItems: [item("p1", 5000, { is_recurring: false })] });
  assert.equal(r.mrr, 0);
  assert.deepEqual(r.byClient, []);
});

/* ---------------- Fatura yedeği ---------------- */

test("fallback: recent invoice of a retainer client without proposal counts (amount, KDV hariç)", () => {
  const invoices = [inv("c2", "2026-10-01", 60000, { vat: 12000 })];
  const r = computeMrr({ ...base, proposals: [], proposalItems: [], invoices });
  assert.equal(r.mrr, 60000);
  assert.equal(r.byClient[0].source, "invoice");
  assert.equal(r.sources.invoice.amount, 60000);
  assert.equal(r.sources.proposal.amount, 0);
});

test("fallback: client covered by an accepted recurring proposal is not double counted", () => {
  const proposals = [prop("p1", "c2", "accepted")];
  const invoices = [inv("c2", "2026-10-01", 60000)];
  const r = computeMrr({ ...base, proposals, proposalItems: [item("p1", 25000)], invoices });
  assert.equal(r.mrr, 25000);
  assert.equal(r.sources.invoice.clients, 0);
});

test("fallback: a client with only a DRAFT proposal still falls back to its invoice", () => {
  const invoices = [inv("c1", "2026-10-03", 35000)];
  const r = computeMrr({ ...base, proposals: [prop("p1", "c1", "draft")], proposalItems: [item("p1", 99000)], invoices });
  assert.equal(r.mrr, 35000);
});

test("fallback window: only (today-30, today]; older / future invoices ignored", () => {
  const invoices = [
    inv("c1", "2026-09-08", 1000), // tam 30 gün önce -> dışarıda
    inv("c2", "2026-09-09", 2000), // 29 gün önce -> içeride
    inv("c1", "2026-10-09", 3000), // gelecek -> dışarıda
  ];
  const r = computeMrr({ ...base, proposals: [], proposalItems: [], invoices });
  assert.deepEqual(r.byClient.map((x) => [x.client, x.amount]), [["Adatıp", 2000]]);
});

test("fallback: draft/cancelled, inactive client, non-retainer client are ignored; note keyword counts", () => {
  const invoices = [
    inv("c1", "2026-10-02", 35000, { status: "draft" }),
    inv("c2", "2026-10-02", 60000, { status: "cancelled" }),
    inv("c4", "2026-10-02", 10000),                                  // pasif müşteri
    inv("c3", "2026-10-02", 22000),                                  // monthly_fee yok, not yok
    inv("c3", "2026-10-03", 18000, { notes: "Ekim aylık yönetim" }), // notta "aylık"
  ];
  const r = computeMrr({ ...base, proposals: [], proposalItems: [], invoices });
  assert.deepEqual(r.byClient.map((x) => [x.client, x.amount]), [["Mira", 18000]]);
});

test("fallback: several recurring invoices in window -> latest one, not the sum", () => {
  const invoices = [inv("c1", "2026-09-20", 30000), inv("c1", "2026-10-05", 35000)];
  assert.equal(computeMrr({ ...base, proposals: [], proposalItems: [], invoices }).mrr, 35000);
});

test("proposals + fallback combine; byClient sorted desc; sources add up to mrr", () => {
  const proposals = [prop("p1", "c1", "accepted")];
  const invoices = [inv("c2", "2026-10-01", 60000)];
  const r = computeMrr({ ...base, proposals, proposalItems: [item("p1", 25000)], invoices });
  assert.equal(r.mrr, 85000);
  assert.deepEqual(r.byClient.map((x) => x.client), ["Adatıp", "Aytaş Home"]);
  assert.equal(r.sources.proposal.amount + r.sources.invoice.amount, r.mrr);
});

test("empty input", () => {
  const r = computeMrr({ proposals: [], proposalItems: [], monthStart: "2026-10-01" });
  assert.equal(r.mrr, 0);
  assert.deepEqual(r.byClient, []);
});

/* ---------------- İlerleme ---------------- */

test("mrrProgress: partial, reached, exceeded", () => {
  assert.deepEqual(mrrProgress(75000, 90000), { hasTarget: true, target: 90000, pct: 83.3, remaining: 15000, surplus: 0, reached: false });
  const hit = mrrProgress(90000, 90000);
  assert.equal(hit.reached, true);
  assert.equal(hit.pct, 100);
  assert.equal(hit.remaining, 0);
  const over = mrrProgress(100000, 90000);
  assert.equal(over.pct, 100);
  assert.equal(over.surplus, 10000);
});

test("mrrProgress: no / invalid target", () => {
  for (const t of [null, undefined, 0, -5, NaN]) {
    assert.equal(mrrProgress(50000, t).hasTarget, false);
  }
  assert.equal(mrrProgress(-10, 1000).pct, 0);
});
