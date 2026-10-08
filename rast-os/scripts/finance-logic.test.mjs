// Çalıştırma: npm test  (Node'un yerleşik test runner'ı + type stripping)
import { test } from "node:test";
import assert from "node:assert/strict";
import { expandRecurring, expenseTotalTRY, fxSnapshot, invoiceIncomeInRange, monthBounds, toTRY } from "../src/lib/finance.ts";

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

const exp = (over) => ({
  id: "x", amount: 100, vat: 0, currency: "TRY", is_recurring: false, payment_status: "paid",
  created_at: "2026-01-01T00:00:00Z", ...over,
});
const ids = (rows) => rows.map((r) => r.id);

test("non-recurring expense appears only in its own month", () => {
  const list = [exp({ id: "in", paid_at: "2026-10-31" }), exp({ id: "before", paid_at: "2026-09-30" }), exp({ id: "after", paid_at: "2026-11-01" }), exp({ id: "undated" })];
  const rows = expandRecurring(list, ...OCT);
  assert.deepEqual(ids(rows), ["in"]);
  assert.equal(rows[0].source_id, "in");
  assert.equal(rows[0].is_occurrence, false);
});

test("recurring expense is a template: monthly from its start date, never before", () => {
  const list = [exp({ id: "sub", is_recurring: true, paid_at: "2026-08-15" })];
  assert.deepEqual(expandRecurring(list, ...monthBounds("2026-07")), []);
  const oct = expandRecurring(list, ...OCT);
  assert.equal(oct.length, 1);
  assert.equal(oct[0].id, "sub@2026-10");
  assert.equal(oct[0].source_id, "sub");
  assert.equal(oct[0].paid_at, "2026-10-15");
  assert.equal(oct[0].is_occurrence, true);
  // Çok aylık aralık: her ay bir oluşum
  assert.deepEqual(ids(expandRecurring(list, "2026-08-01", "2026-12-31")), ["sub@2026-08", "sub@2026-09", "sub@2026-10", "sub@2026-11", "sub@2026-12"]);
});

test("recurring day is clamped to short months; partial ranges respect the day", () => {
  const list = [exp({ id: "eom", is_recurring: true, paid_at: "2026-01-31" })];
  assert.equal(expandRecurring(list, ...monthBounds("2026-02"))[0].paid_at, "2026-02-28");
  assert.equal(expandRecurring(list, "2026-03-01", "2026-03-30").length, 0);
});

test("undated recurring template keeps legacy behaviour (once per month)", () => {
  const list = [exp({ id: "legacy", is_recurring: true })];
  assert.deepEqual(ids(expandRecurring(list, ...OCT)), ["legacy@2026-10"]);
});

test("installment template stops after installment_total", () => {
  const sixPart = exp({ id: "tv", is_recurring: true, paid_at: "2026-05-10", installment_number: 1, installment_total: 6 });
  const months = expandRecurring([sixPart], "2026-01-01", "2027-12-31");
  assert.equal(months.length, 6);
  assert.deepEqual(months.map((r) => r.paid_at), ["2026-05-10", "2026-06-10", "2026-07-10", "2026-08-10", "2026-09-10", "2026-10-10"]);
  assert.deepEqual(months.map((r) => r.installment_number), [1, 2, 3, 4, 5, 6]);
  assert.equal(expandRecurring([sixPart], ...monthBounds("2026-11")).length, 0);

  // Şablon 3/6'dan başlıyorsa 4 oluşum kalır
  const mid = exp({ id: "mid", is_recurring: true, paid_at: "2026-09-01", installment_number: 3, installment_total: 6 });
  const rest = expandRecurring([mid], "2026-01-01", "2027-12-31");
  assert.deepEqual(rest.map((r) => r.installment_number), [3, 4, 5, 6]);
  assert.equal(rest.at(-1).paid_at, "2026-12-01");

  // Tekrarlamayan taksit satırı (her taksit ayrı kayıt) yalnızca kendi ayında
  const single = exp({ id: "t2", paid_at: "2026-10-05", installment_number: 2, installment_total: 6 });
  assert.deepEqual(ids(expandRecurring([single], ...OCT)), ["t2"]);
  assert.deepEqual(ids(expandRecurring([single], ...monthBounds("2026-11"))), []);
});

test("FX conversion: TRY passthrough, USD/EUR at given rate, VAT included", () => {
  assert.equal(toTRY(100, "TRY", 40, 45), 100);
  assert.equal(toTRY(100, undefined, 40, 45), 100);
  assert.equal(toTRY(100, "USD", 40, 45), 4000);
  assert.equal(toTRY(100, "EUR", 40, 45), 4500);
  assert.equal(expenseTotalTRY({ amount: 10, vat: 2, currency: "USD" }, 40, 45), 480);
  assert.equal(expenseTotalTRY({ amount: 10, vat: 2, currency: "TRY" }, 40, 45), 12);
  // Oluşumlar şablonun para birimini taşır
  const sub = exp({ id: "s", is_recurring: true, paid_at: "2026-01-01", amount: 20, currency: "EUR" });
  const [occ] = expandRecurring([sub], ...OCT);
  assert.equal(expenseTotalTRY(occ, 40, 45), 900);
});

test("historical FX: amount_try (entry-time) wins over the current rate", () => {
  // Girişte kur 40 idi; bugün 50. Tarihsel tutar sabit kalmalı.
  const x = { amount: 10, vat: 2, currency: "USD", fx_rate: 40, amount_try: 400 };
  assert.equal(expenseTotalTRY(x, 50, 60), 480);
  // amount_try var ama fx_rate yok (elle backfill): KDV güncel kurla
  assert.equal(expenseTotalTRY({ amount: 10, vat: 2, currency: "USD", amount_try: 400 }, 50, 60), 500);
  // Eski kayıt (kolonlar boş/null): güncel kur
  assert.equal(expenseTotalTRY({ amount: 10, vat: 2, currency: "USD", fx_rate: null, amount_try: null }, 50, 60), 600);
  // DB numeric string olarak gelse de çalışır
  assert.equal(expenseTotalTRY({ amount: 10, vat: 0, currency: "EUR", fx_rate: "45.5", amount_try: "455.00" }, 50, 60), 455);
});

test("fxSnapshot stores entry-time rate; keeps stored rate on edit; clears for TRY", () => {
  assert.deepEqual(fxSnapshot(100, "TRY", 40, 45), { fx_rate: null, amount_try: null });
  assert.deepEqual(fxSnapshot(100, "USD", 40, 45), { fx_rate: 40, amount_try: 4000 });
  assert.deepEqual(fxSnapshot(12.345, "EUR", 40, 45.1), { fx_rate: 45.1, amount_try: 556.76 });
  // Düzenleme: aynı para birimi + kayıtlı kur → kur korunur, tutar yeniden hesaplanır
  assert.deepEqual(fxSnapshot(200, "USD", 50, 60, { currency: "USD", fx_rate: 40 }), { fx_rate: 40, amount_try: 8000 });
  // Para birimi değişti → güncel kur
  assert.deepEqual(fxSnapshot(200, "EUR", 50, 60, { currency: "USD", fx_rate: 40 }), { fx_rate: 60, amount_try: 12000 });
  // Eski kayıt (kur yok) → güncel kur
  assert.deepEqual(fxSnapshot(200, "USD", 50, 60, { currency: "USD", fx_rate: null }), { fx_rate: 50, amount_try: 10000 });
});
