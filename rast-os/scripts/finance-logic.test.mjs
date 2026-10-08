// Çalıştırma: npm test  (Node'un yerleşik test runner'ı + type stripping)
import { test } from "node:test";
import assert from "node:assert/strict";
import { invoiceIncomeInRange, monthBounds } from "../src/lib/finance.ts";

const OCT = monthBounds("2026-10");

test("monthBounds returns inclusive first/last day keys", () => {
  assert.deepEqual(monthBounds("2026-10"), ["2026-10-01", "2026-10-31"]);
  assert.deepEqual(monthBounds("2026-02"), ["2026-02-01", "2026-02-28"]);
  assert.deepEqual(monthBounds("2028-02"), ["2028-02-01", "2028-02-29"]);
  assert.deepEqual(monthBounds("2026-12"), ["2026-12-01", "2026-12-31"]);
});

test("invoice income counts payments by paid_at, not invoice issue_date", () => {
  const invoices = [{ id: "i1", issue_date: "2026-09-25", paid_amount: 1000 }];
  const payments = [{ invoice_id: "i1", amount: 1000, paid_at: "2026-10-03" }];
  assert.equal(invoiceIncomeInRange(invoices, payments, ...OCT), 1000);
  assert.equal(invoiceIncomeInRange(invoices, payments, ...monthBounds("2026-09")), 0);
});

test("legacy paid_amount without payment rows falls back to issue_date", () => {
  const invoices = [
    { id: "legacy", issue_date: "2026-10-02", paid_amount: 500 },
    { id: "partial", issue_date: "2026-10-05", paid_amount: 800 }, // 300'ü ödeme satırlı
  ];
  const payments = [{ invoice_id: "partial", amount: 300, paid_at: "2026-11-01" }];
  assert.equal(invoiceIncomeInRange(invoices, payments, ...OCT), 500 + 500);
  assert.equal(invoiceIncomeInRange(invoices, payments, ...monthBounds("2026-11")), 300);
});

test("payments of deleted invoices are ignored; corrections net out", () => {
  const invoices = [{ id: "i1", issue_date: "2026-10-01", paid_amount: 700 }];
  const payments = [
    { invoice_id: "gone", amount: 999, paid_at: "2026-10-10" },
    { invoice_id: "i1", amount: 1000, paid_at: "2026-10-10" },
    { invoice_id: "i1", amount: -300, paid_at: "2026-10-12" },
    { amount: 50, paid_at: "2026-10-15" }, // faturasız tahsilat
  ];
  assert.equal(invoiceIncomeInRange(invoices, payments, ...OCT), 750);
});
