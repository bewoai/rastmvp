// Çalıştırma: npm test  (Node'un yerleşik test runner'ı + type stripping)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assignPatch, assignableMembers, assigneeView, createAssigneeResolver, filterByOwner, initialsOf, isUnassigned, memberName, resolveAssigneeId,
} from "../src/lib/assignee-logic.ts";

const BEWO = "u-bewo";
const MAMI = "u-mami";
const members = [
  { id: BEWO, full_name: "Berat Değirmenci", role: "admin", is_active: true },
  { id: MAMI, full_name: "Mohammed Akram Adnan", role: "editor", is_active: true },
  { id: "u-old", full_name: "Eski Üye", role: "editor", is_active: false },
  { id: "u-mail", full_name: "d@ornek.com", role: "editor", is_active: true },
];
const task = (id, over = {}) => ({ id, title: id, priority: "medium", status: "todo", created_at: "2026-10-01", ...over });

test("initialsOf / memberName", () => {
  assert.equal(initialsOf("Berat Değirmenci"), "BD");
  assert.equal(initialsOf("Mohammed Akram Adnan"), "MA");
  assert.equal(initialsOf("ışıl"), "I");
  assert.equal(initialsOf("d@ornek.com"), "D");
  assert.equal(initialsOf("  "), "?");
  assert.equal(memberName({ full_name: "  " }), "İsimsiz üye");
  assert.equal(memberName(members[0]), "Berat Değirmenci");
});

test("resolveAssigneeId: önce assignee_id; yoksa metin tek üyeyle eşleşirse o üye", () => {
  assert.equal(resolveAssigneeId({ assignee_id: MAMI, assignee: "Berat" }, members), MAMI);
  assert.equal(resolveAssigneeId({ assignee: "berat" }, members), BEWO); // ilk ad
  assert.equal(resolveAssigneeId({ assignee: "BERAT DEĞİRMENCİ" }, members), BEWO); // tam ad, Türkçe büyük harf
  assert.equal(resolveAssigneeId({ assignee: "Mohammed Akram" }, members), MAMI); // adın başı
  assert.equal(resolveAssigneeId({ assignee: "Editör" }, members), null); // üye değil
  assert.equal(resolveAssigneeId({ assignee_id: "", assignee: "" }, members), null);
  assert.equal(resolveAssigneeId({}, members), null);
  // Belirsiz metin (iki üyeyle eşleşir) → null
  const twins = [...members, { id: "u-b2", full_name: "Berat Kaya" }];
  assert.equal(resolveAssigneeId({ assignee: "Berat" }, twins), null);
  assert.equal(isUnassigned({ assignee: "Editör" }, members), true);
});

test("filterByOwner: Herkes / Bana atanan / Bana atanan + atanmamış", () => {
  const tasks = [
    task("mine", { assignee_id: BEWO }),
    task("mine-text", { assignee: "Berat" }),
    task("mami", { assignee_id: MAMI }),
    task("none"),
    task("legacy", { assignee: "Editör" }),
  ];
  const ids = (xs) => xs.map((t) => t.id);
  assert.deepEqual(ids(filterByOwner(tasks, "all", BEWO, members)), ["mine", "mine-text", "mami", "none", "legacy"]);
  assert.deepEqual(ids(filterByOwner(tasks, "mine", BEWO, members)), ["mine", "mine-text"]);
  assert.deepEqual(ids(filterByOwner(tasks, "mine_or_unassigned", BEWO, members)), ["mine", "mine-text", "none", "legacy"]);
  assert.deepEqual(ids(filterByOwner(tasks, "mine", MAMI, members)), ["mami"]);
  // Oturum bilinmiyorsa süzgeç uygulanmaz (görevler kaybolmasın)
  assert.equal(filterByOwner(tasks, "mine", null, members).length, tasks.length);
  // Ekip listesi yüklenmemişse yalnız assignee_id'ye bakılır
  assert.deepEqual(ids(filterByOwner(tasks, "mine", BEWO, [])), ["mine"]);
});

test("assigneeView: üye, ekip dışı eski metin, atanmamış", () => {
  assert.deepEqual(assigneeView(task("a", { assignee_id: MAMI }), members), { id: MAMI, name: "Mohammed Akram Adnan", initials: "MA", member: true });
  assert.deepEqual(assigneeView(task("b", { assignee: "Editör" }), members), { id: null, name: "Editör", initials: "E", member: false });
  assert.equal(assigneeView(task("c"), members), null);
  // id var ama üye listesinde yok (ör. org'dan ayrılmış): kayıttaki adla gösterilir
  assert.deepEqual(assigneeView(task("d", { assignee_id: "u-x", assignee: "Ayşe Yılmaz" }), members), { id: "u-x", name: "Ayşe Yılmaz", initials: "AY", member: false });
});

test("createAssigneeResolver: aynı sorumlu için aynı nesne (memo'lu satırlar korunur)", () => {
  const resolve = createAssigneeResolver(members);
  const a = resolve(task("a", { assignee_id: MAMI }));
  assert.equal(resolve(task("b", { assignee_id: MAMI })), a);
  assert.notEqual(resolve(task("c", { assignee_id: BEWO })), a);
  assert.equal(resolve(task("d")), null);
});

test("assignPatch: id + görünen ad birlikte; kaldırma boş string (DB'de null)", () => {
  assert.deepEqual(assignPatch(MAMI, members), { assignee_id: MAMI, assignee: "Mohammed Akram Adnan" });
  assert.deepEqual(assignPatch(null, members), { assignee_id: "", assignee: "" });
});

test("assignableMembers: pasif üyeler gizli (atanmışsa kalır), ada göre sıralı", () => {
  assert.deepEqual(assignableMembers(members).map((m) => m.id), [BEWO, "u-mail", MAMI]);
  assert.ok(assignableMembers(members, "u-old").some((m) => m.id === "u-old"));
});
