// Çalıştırma: npm test  (Node'un yerleşik test runner'ı + type stripping)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isExpired, lineTotal, moveItem, nextProposalNo, parseTextBlocks, proposalTotals, round2, sortItems,
} from "../src/lib/proposal-logic.ts";
import { PROPOSAL_PRESETS, findPreset, presetToItems } from "../src/lib/proposal-presets.ts";

const item = (unit_price, over = {}) => ({ qty: 1, unit_price, is_recurring: true, ...over });

/* ---------------- Toplamlar / KDV ---------------- */

test("lineTotal = qty × unit_price, rounded to cents", () => {
  assert.equal(lineTotal({ qty: 4, unit_price: 1800 }), 7200);
  assert.equal(lineTotal({ qty: 3, unit_price: 0.1 }), 0.3);
  assert.equal(lineTotal({ qty: 1.5, unit_price: 333.33 }), 500);
  assert.equal(lineTotal({ qty: undefined, unit_price: 100 }), 0);
});

test("KDV %20 on a 25.000 monthly package", () => {
  const t = proposalTotals([item(4800), item(14300), item(5900)], 20);
  assert.equal(t.subtotal, 25000);
  assert.equal(t.vat, 5000);
  assert.equal(t.total, 30000);
  assert.equal(t.mixed, false);
  assert.deepEqual(t.recurring, { subtotal: 25000, vat: 5000, total: 30000 });
  assert.deepEqual(t.oneOff, { subtotal: 0, vat: 0, total: 0 });
});

test("KDV rounding to cents and other rates", () => {
  const t = proposalTotals([item(333.33, { is_recurring: false })], 20);
  assert.equal(t.vat, 66.67);
  assert.equal(t.total, 400);
  assert.equal(proposalTotals([item(1000)], 0).total, 1000);
  assert.equal(proposalTotals([item(1000)], 10).vat, 100);
  assert.equal(proposalTotals([], 20).total, 0);
});

test("recurring vs one-off split; grand total = monthly + one-off (first month)", () => {
  const items = [
    item(22000), item(9000),                              // aylık 31.000
    item(5000, { is_recurring: false, qty: 2, unit: "gün" }), // tek seferlik 10.000
  ];
  const t = proposalTotals(items, 20);
  assert.equal(t.mixed, true);
  assert.deepEqual(t.recurring, { subtotal: 31000, vat: 6200, total: 37200 });
  assert.deepEqual(t.oneOff, { subtotal: 10000, vat: 2000, total: 12000 });
  assert.equal(t.subtotal, 41000);
  assert.equal(t.vat, 8200);
  assert.equal(t.total, 49200);
});

test("split parts always add up to the totals (no cent drift)", () => {
  const items = [item(0.35), item(0.35, { is_recurring: false }), item(1234.565), item(99.995, { is_recurring: false })];
  for (const rate of [0, 1, 8, 10, 18, 20]) {
    const t = proposalTotals(items, rate);
    assert.equal(t.vat, round2(t.recurring.vat + t.oneOff.vat));
    assert.equal(t.total, round2(t.recurring.total + t.oneOff.total));
    assert.equal(t.total, round2(t.subtotal + t.vat));
  }
});

/* ---------------- Teklif numarası ---------------- */

test("proposal_no starts at RC-<year>-001", () => {
  assert.equal(nextProposalNo([], 2026), "RC-2026-001");
});

test("proposal_no increments from the highest number of the same year", () => {
  const list = [{ proposal_no: "RC-2026-001" }, { proposal_no: "RC-2026-007" }, { proposal_no: "RC-2026-003" }];
  assert.equal(nextProposalNo(list, 2026), "RC-2026-008");
});

test("proposal_no resets per year and ignores other years", () => {
  const list = [{ proposal_no: "RC-2025-041" }, { proposal_no: "RC-2026-002" }];
  assert.equal(nextProposalNo(list, 2026), "RC-2026-003");
  assert.equal(nextProposalNo(list, 2027), "RC-2027-001");
  assert.equal(nextProposalNo(list, 2025), "RC-2025-042");
});

test("proposal_no is counted per organization when orgId is given", () => {
  const list = [
    { proposal_no: "RC-2026-005", organization_id: "org-a" },
    { proposal_no: "RC-2026-001", organization_id: "org-b" },
  ];
  assert.equal(nextProposalNo(list, 2026, "org-b"), "RC-2026-002");
  assert.equal(nextProposalNo(list, 2026, "org-a"), "RC-2026-006");
  assert.equal(nextProposalNo(list, 2026, "org-c"), "RC-2026-001");
});

test("manual / malformed numbers are ignored; >999 grows to 4 digits", () => {
  const list = [{ proposal_no: "TEKLIF-12" }, { proposal_no: "" }, { proposal_no: null }, { proposal_no: " RC-2026-004 " }];
  assert.equal(nextProposalNo(list, 2026), "RC-2026-005");
  assert.equal(nextProposalNo([{ proposal_no: "RC-2026-999" }], 2026), "RC-2026-1000");
});

/* ---------------- Paketler ---------------- */

const presetTotal = (key) => proposalTotals(findPreset(key).pkg.items, 20).subtotal;

test("Hekim İçerik Sistemi tiers ≈ 15.000 / 25.000 / 40.000 (KDV hariç, aylık)", () => {
  assert.equal(presetTotal("hekim:baslangic"), 15000);
  assert.equal(presetTotal("hekim:standart"), 25000);
  assert.equal(presetTotal("hekim:klinik"), 40000);
  for (const p of findPreset("hekim:klinik").group.packages) {
    assert.ok(p.items.every((i) => i.is_recurring), `${p.label}: tüm kalemler aylık olmalı`);
  }
});

test("Aylık video paketi (inşaat/emlak) = 45.000; kurumsal film fiyatları henüz 0 ve tek seferlik", () => {
  assert.equal(presetTotal("insaat-emlak:aylik"), 45000);
  for (const key of ["kurumsal-film:cekim", "kurumsal-film:cekim-kurgu"]) {
    const items = findPreset(key).pkg.items;
    assert.equal(proposalTotals(items, 20).total, 0);
    assert.ok(items.every((i) => !i.is_recurring));
  }
});

test("strateji / raporlama / kreatif are never separate line items", () => {
  for (const g of PROPOSAL_PRESETS) {
    assert.ok(g.notes.trim() && g.terms.trim(), `${g.label}: varsayılan süreç ve koşullar olmalı`);
    for (const p of g.packages) {
      for (const i of p.items) {
        assert.doesNotMatch(i.name.toLocaleLowerCase("tr-TR"), /strateji|rapor|kreatif/, `${g.label} / ${p.label}: ${i.name}`);
      }
    }
  }
});

test("presetToItems numbers positions and links the proposal", () => {
  let n = 0;
  const items = presetToItems(findPreset("hekim:standart").pkg, "pr-x", () => `id${++n}`, "2026-10-08");
  assert.deepEqual(items.map((i) => [i.id, i.position, i.proposal_id]), [["id1", 0, "pr-x"], ["id2", 1, "pr-x"], ["id3", 2, "pr-x"]]);
});

/* ---------------- Yardımcılar ---------------- */

test("moveItem swaps neighbours and is a no-op at the edges", () => {
  assert.deepEqual(moveItem(["a", "b", "c"], 1, -1), ["b", "a", "c"]);
  assert.deepEqual(moveItem(["a", "b", "c"], 1, 1), ["a", "c", "b"]);
  const list = ["a", "b"];
  assert.equal(moveItem(list, 0, -1), list);
  assert.equal(moveItem(list, 1, 1), list);
});

test("sortItems orders by position, then created_at", () => {
  const rows = [
    { id: "c", position: 2, created_at: "1" },
    { id: "b", position: 1, created_at: "2" },
    { id: "a", position: 1, created_at: "1" },
  ];
  assert.deepEqual(sortItems(rows).map((r) => r.id), ["a", "b", "c"]);
});

test("isExpired only for open proposals past valid_until", () => {
  assert.equal(isExpired({ status: "sent", valid_until: "2026-10-01" }, "2026-10-08"), true);
  assert.equal(isExpired({ status: "draft", valid_until: "2026-10-08" }, "2026-10-08"), false);
  assert.equal(isExpired({ status: "accepted", valid_until: "2026-01-01" }, "2026-10-08"), false);
  assert.equal(isExpired({ status: "sent" }, "2026-10-08"), false);
});

test("parseTextBlocks: headings, bullet / numbered lists, paragraphs", () => {
  const blocks = parseTextBlocks("## Ödeme\n- %50 peşin\n• %50 teslimde\n\nNot satırı\ndevamı\n1. Adım\n2. Adım");
  assert.deepEqual(blocks, [
    { type: "heading", text: "Ödeme" },
    { type: "list", items: ["%50 peşin", "%50 teslimde"] },
    { type: "paragraph", text: "Not satırı devamı" },
    { type: "list", items: ["1. Adım", "2. Adım"] },
  ]);
  assert.deepEqual(parseTextBlocks(undefined), []);
});
