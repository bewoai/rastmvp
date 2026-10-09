// Çalıştırma: npm test  (Node'un yerleşik test runner'ı + type stripping)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  RECORD_KINDS, buildSearchIndex, normalizeSearch, recordHref, scoreDoc, searchRecords,
} from "../src/lib/search-logic.ts";

// seed.ts uzantısız import kullandığı için Node'da yüklenemez: küçük, her türü içeren fikstür.
const D = "2026-08-01";
const seed = {
  clients: [{ id: "c1", name: "Aytaş Home", is_active: true, created_at: D }, { id: "c2", name: "Adatıp Sağlık Grubu", is_active: true, created_at: D }],
  brands: [{ id: "b1", client_id: "c1", name: "Aytaş Mobilya", created_at: D }],
  contacts: [{ id: "ct1", client_id: "c2", full_name: "Kemal Sarı", email: "kemal@adatip.com", is_approver: true, created_at: D }],
  projects: [{ id: "p1", client_id: "c1", name: "Ağustos Sosyal Medya", status: "active", priority: "high", created_at: D }],
  tasks: [{ id: "t1", project_id: "p1", title: "Reels #8 kurgu", priority: "high", status: "done", created_at: D }],
  jobs: [{ id: "j1", customer_name: "Selin & Emre", service: "Düğün çekimi", price: 1, paid_amount: 0, status: "confirmed", payment_status: "unpaid", created_at: D }],
  invoices: [{ id: "i1", client_id: "c1", invoice_no: "2026-082", amount: 1, vat: 0, paid_amount: 0, status: "issued", created_at: D }],
  proposals: [{ id: "pr1", client_id: "c2", title: "Hekim İçerik Sistemi", proposal_no: "RC-2026-001", status: "sent", currency: "TRY", vat_rate: 20, created_at: D }],
  leads: [{ id: "l1", company_name: "Kavis Mimarlık", contact_person: "Burak Yıldız", status: "new", created_at: D }],
  prospects: [{ id: "pp1", source: "csv", name: "Işık Diş", sector: "Diş", city: "Sakarya", score: 1, score_breakdown: [], status: "new", created_at: D }],
  contents: [{ id: "co1", client_id: "c1", brand_id: "b1", title: "Yatak odası ilhamı", status: "editing", created_at: D }],
  shoots: [{ id: "s1", client_id: "c2", title: "Kardiyoloji röportajı", location: "Adatıp", status: "planned", created_at: D }],
};

test("normalizeSearch: Türkçe büyük/küçük harf + aksan duyarsız", () => {
  assert.equal(normalizeSearch("IŞIK"), "isik");
  assert.equal(normalizeSearch("ışık"), "isik");
  assert.equal(normalizeSearch("İSTANBUL"), "istanbul");
  assert.equal(normalizeSearch("Çağrı Öğüt"), "cagri ogut");
  assert.equal(normalizeSearch("  Kâğıt   Ürün "), "kagit urun");
  assert.equal(normalizeSearch("Değirmenci"), "degirmenci");
  assert.equal(normalizeSearch(null), "");
  assert.equal(normalizeSearch(undefined), "");
});

const doc = (title, extra = "") => ({ t: normalizeSearch(title), hay: normalizeSearch(`${title} ${extra}`) });

test("scoreDoc: tam > baştan > sözcük başı > içinde > başka alan; tüm sözcükler gerekli", () => {
  const q = (s) => normalizeSearch(s);
  assert.equal(scoreDoc(doc("Aytaş Home"), q("aytas home")), 100);
  assert.equal(scoreDoc(doc("Aytaş Home"), q("ayt")), 80);
  assert.equal(scoreDoc(doc("Aytaş Home"), q("home")), 60);
  assert.equal(scoreDoc(doc("Aytaşhome"), q("home")), 40);
  assert.equal(scoreDoc(doc("Reels kurgu", "Aytaş"), q("aytas")), 10);
  assert.equal(scoreDoc(doc("Reels kurgu", "Aytaş"), q("aytas reels")), 10);
  assert.equal(scoreDoc(doc("Kurgu Reels"), q("reels kurgu")), 30);
  assert.equal(scoreDoc(doc("Reels kurgu"), q("reels yok")), 0);
  assert.equal(scoreDoc(doc("Reels"), ""), 0);
});

test("recordHref: detay sayfası olanlar oraya, diğerleri ?ac=<id>", () => {
  assert.equal(recordHref("clients", "c1"), "/crm/clients/c1");
  assert.equal(recordHref("proposals", "pr1"), "/teklifler/pr1");
  assert.equal(recordHref("tasks", "t 1"), "/tasks?ac=t%201");
  assert.equal(recordHref("prospects", "x"), "/musteri-bulma?ac=x");
  assert.equal(recordHref("invoices", "i1"), "/finance/invoices?ac=i1");
  for (const { kind } of RECORD_KINDS) assert.match(recordHref(kind, "id"), /^\/[a-z/-]+(\?ac=id|\/id)$/);
});

test("buildSearchIndex + searchRecords: 12 tür, gruplu, Türkçe duyarsız arama", () => {
  const index = buildSearchIndex(seed);
  assert.deepEqual(new Set(index.map((d) => d.kind)), new Set(RECORD_KINDS.map((k) => k.kind)));

  const g = searchRecords(index, "aytas");
  const kinds = g.map((x) => x.kind);
  // Müşteri adı bağlı kayıtlarda da aranır (proje, marka, fatura, içerik)
  for (const k of ["clients", "projects", "brands", "invoices", "contents"]) assert.ok(kinds.includes(k), k);
  // Grup sırası RECORD_KINDS sırasını izler
  const order = RECORD_KINDS.map((k) => k.kind);
  assert.deepEqual(kinds, [...kinds].sort((a, b) => order.indexOf(a) - order.indexOf(b)));
  assert.equal(g.find((x) => x.kind === "clients").items[0].href, "/crm/clients/c1");

  // Büyük harf + aksan: "KAVİS" → lead; "isik" → "Işık Diş"
  const lead = searchRecords(index, "KAVİS").find((x) => x.kind === "leads");
  assert.equal(lead?.items[0].title, "Kavis Mimarlık");
  assert.equal(lead?.items[0].href, "/crm/leads?ac=l1");
  assert.equal(searchRecords(index, "isik")[0].items[0].id, "pp1");
  assert.equal(searchRecords(index, "KEMAL@ADATIP")[0].items[0].id, "ct1");

  // Görev: proje adına göre de bulunur; tamamlanan görev de aranır (alt satırda "Tamamlandı")
  const task = searchRecords(index, "reels #8").find((x) => x.kind === "tasks");
  assert.equal(task?.items[0].subtitle, "Ağustos Sosyal Medya · Tamamlandı");
  assert.ok(searchRecords(index, "agustos sosyal").some((x) => x.kind === "tasks"));
  // Fatura numarası, teklif numarası
  assert.equal(searchRecords(index, "2026-082")[0].items[0].id, "i1");
  assert.equal(searchRecords(index, "rc-2026")[0].items[0].id, "pr1");

  // Boş sorgu → sonuç yok
  assert.deepEqual(searchRecords(index, "   "), []);
});

test("searchRecords: grup başına sınır ve 'more' sayısı", () => {
  const tasks = Array.from({ length: 7 }, (_, i) => ({ id: `t${i}`, title: `Kurgu ${i}`, priority: "medium", status: "todo", created_at: "2026-01-01" }));
  const g = searchRecords(buildSearchIndex({ tasks }), "kurgu", 4);
  assert.equal(g.length, 1);
  assert.equal(g[0].items.length, 4);
  assert.equal(g[0].more, 3);
});

test("buildSearchIndex: Places adayı adı yoksa sektör + konumla anılır", () => {
  const index = buildSearchIndex({ prospects: [{ id: "p1", source: "places", sector: "Diş kliniği", city: "Sakarya", district: "Adapazarı", score: 50, score_breakdown: [], status: "new", created_at: "2026-01-01" }] });
  assert.equal(index[0].title, "Diş kliniği · Adapazarı, Sakarya");
  assert.equal(searchRecords(index, "dis sakarya")[0].items[0].id, "p1");
});
