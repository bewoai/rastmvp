// Çalıştırma: npm test  (Node'un yerleşik test runner'ı + type stripping)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  conversionBlocker, findLinkedProject, monthlyValue, proposalToDraftInvoice, proposalToProject,
} from "../src/lib/proposal-convert.ts";

const proposal = (over = {}) => ({
  id: "pr1", client_id: "c2", title: "  Hekim İçerik Sistemi — Standart ", proposal_no: "RC-2026-001",
  currency: "TRY", vat_rate: 20, status: "accepted", ...over,
});
const item = (unit_price, over = {}) => ({ qty: 1, unit: "ay", unit_price, is_recurring: true, ...over });
const opts = { id: "new1", today: "2026-10-08", now: "2026-10-08T12:00:00.000Z" };

/* ---------------- proposalToProject ---------------- */

test("proposalToProject: title, client, today, active, linked to the proposal", () => {
  const p = proposalToProject(proposal(), [item(4800), item(14300), item(5900)], opts);
  assert.equal(p.id, "new1");
  assert.equal(p.name, "Hekim İçerik Sistemi — Standart");
  assert.equal(p.client_id, "c2");
  assert.equal(p.start_date, "2026-10-08");
  assert.equal(p.status, "active");
  assert.equal(p.priority, "medium");
  assert.equal(p.proposal_id, "pr1");
  assert.equal(p.type, "Aylık hizmet");
  assert.equal(p.budget, 25000);
  assert.equal(p.created_at, opts.now);
  assert.match(p.notes, /Teklif RC-2026-001/);
  assert.match(p.notes, /Aylık: 25\.000 TL \+ KDV/);
  assert.doesNotMatch(p.notes, /Tek seferlik/);
});

test("proposalToProject: one-off only and mixed budgets (KDV hariç, first month)", () => {
  const oneOff = proposalToProject(proposal(), [item(9000, { is_recurring: false, unit: "gün" })], opts);
  assert.equal(oneOff.type, "Tek seferlik iş");
  assert.equal(oneOff.budget, 9000);
  const mixed = proposalToProject(proposal(), [item(12000), item(9000, { is_recurring: false })], opts);
  assert.equal(mixed.budget, 21000);
  assert.match(mixed.notes, /Tek seferlik: 9\.000 TL \+ KDV/);
});

test("proposalToProject: non-TRY proposal leaves the TL budget empty; empty proposal has no budget", () => {
  const usd = proposalToProject(proposal({ currency: "USD" }), [item(1000)], opts);
  assert.equal(usd.budget, undefined);
  assert.match(usd.notes, /1\.000 USD/);
  assert.equal(proposalToProject(proposal(), [], opts).budget, undefined);
});

/* ---------------- proposalToDraftInvoice ---------------- */

test("proposalToDraftInvoice: recurring items only, KDV from proposal vat_rate, draft for this month", () => {
  const inv = proposalToDraftInvoice(
    proposal(),
    [item(12000), item(18000), item(9000, { is_recurring: false, unit: "gün" })],
    { ...opts, id: "inv1", projectId: "proj1" },
  );
  assert.deepEqual(inv, {
    id: "inv1",
    client_id: "c2",
    project_id: "proj1",
    issue_date: "2026-10-08",
    amount: 30000,
    vat: 6000,
    paid_amount: 0,
    status: "draft",
    notes: "Teklif RC-2026-001 · Ekim 2026 aylık hizmet bedeli (taslak)",
    created_at: opts.now,
  });
});

test("proposalToDraftInvoice: other VAT rates, qty and cents", () => {
  const inv = proposalToDraftInvoice(proposal({ vat_rate: 10 }), [item(333.33, { qty: 3 })], opts);
  assert.equal(inv.amount, 999.99);
  assert.equal(inv.vat, 100);
  assert.equal(proposalToDraftInvoice(proposal({ vat_rate: 0 }), [item(5000)], opts).vat, 0);
});

test("proposalToDraftInvoice: yearly unit is spread monthly (same rule as MRR)", () => {
  assert.equal(monthlyValue({ qty: 1, unit: "yıl", unit_price: 120000 }), 10000);
  assert.equal(proposalToDraftInvoice(proposal(), [item(120000, { unit: "yıl" })], opts).amount, 10000);
});

test("proposalToDraftInvoice: null when no recurring items, zero total or non-TRY", () => {
  assert.equal(proposalToDraftInvoice(proposal(), [item(9000, { is_recurring: false })], opts), null);
  assert.equal(proposalToDraftInvoice(proposal(), [item(0)], opts), null);
  assert.equal(proposalToDraftInvoice(proposal(), [], opts), null);
  assert.equal(proposalToDraftInvoice(proposal({ currency: "EUR" }), [item(1000)], opts), null);
});

test("proposalToDraftInvoice: project link optional", () => {
  assert.equal(proposalToDraftInvoice(proposal(), [item(1000)], opts).project_id, null);
});

/* ---------------- Idempotency / guards ---------------- */

test("findLinkedProject finds the project already created from this proposal", () => {
  const projects = [{ id: "p1" }, { id: "p2", proposal_id: "pr9" }, { id: "p3", proposal_id: "pr1" }];
  assert.equal(findLinkedProject(projects, "pr1")?.id, "p3");
  assert.equal(findLinkedProject(projects, "pr2"), undefined);
});

test("conversionBlocker: client required", () => {
  assert.match(conversionBlocker(proposal({ client_id: undefined })), /müşteri/);
  assert.match(conversionBlocker(proposal({ client_id: "" })), /müşteri/);
  assert.equal(conversionBlocker(proposal()), null);
});
