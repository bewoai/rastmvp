// Çalıştırma: npm test  (Node'un yerleşik test runner'ı + type stripping)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addDaysKey, bucketTasks, dateKey, daysBetween, formatDue, groupTasks, sortTasks, todayKey,
} from "../src/lib/taskLogic.ts";

const T = "2026-09-20";
const task = (over) => ({
  id: "x", title: "t", priority: "medium", status: "todo", created_at: "2026-09-01T00:00:00Z", ...over,
});

test("dateKey uses local date parts, not UTC", () => {
  // 23:30 yerel saat: UTC'ye çevirmek günü kaydırabilir; yerel anahtar sabit kalmalı
  assert.equal(dateKey(new Date(2026, 8, 20, 23, 30)), "2026-09-20");
  assert.equal(todayKey(new Date(2026, 0, 5, 0, 5)), "2026-01-05");
});

test("addDaysKey / daysBetween handle month + year rollover", () => {
  assert.equal(addDaysKey("2026-09-30", 1), "2026-10-01");
  assert.equal(addDaysKey("2026-12-31", 1), "2027-01-01");
  assert.equal(addDaysKey("2026-03-01", -1), "2026-02-28");
  assert.equal(daysBetween("2026-09-20", "2026-09-23"), 3);
  assert.equal(daysBetween("2026-09-20", "2026-09-18"), -2);
});

test("formatDue", () => {
  assert.equal(formatDue(T, T), "Bugün");
  assert.equal(formatDue("2026-09-21", T), "Yarın");
  assert.equal(formatDue("2026-09-19", T), "Dün");
  assert.match(formatDue("2026-10-03", T), /^3 Eki/);
  assert.match(formatDue("2027-01-03", T), /2027/);
});

test("bucketTasks splits in one pass; done never appears in open views", () => {
  const tasks = [
    task({ id: "overdue", due_date: "2026-09-10" }),
    task({ id: "today", due_date: T }),
    task({ id: "future", due_date: "2026-09-25" }),
    task({ id: "undated" }),
    task({ id: "done-today", due_date: T, status: "done" }),
    task({ id: "wip", due_date: T, status: "in_progress" }),
  ];
  const b = bucketTasks(tasks, T);
  const ids = (l) => l.map((t) => t.id).sort();
  assert.deepEqual(ids(b.today), ["overdue", "today", "wip"]);
  assert.deepEqual(ids(b.upcoming), ["future"]);
  assert.deepEqual(ids(b.all), ["future", "overdue", "today", "undated", "wip"]);
  assert.deepEqual(ids(b.completed), ["done-today"]);
});

test("a task added with the view's default due date lands in that view", () => {
  // Bugün görünümünde Quick Add varsayılan tarihi bugün -> anında görünmeli
  const inToday = bucketTasks([task({ id: "n", due_date: T })], T);
  assert.equal(inToday.today.length, 1);
  // Yaklaşan görünümünde varsayılan yarın
  const inUpcoming = bucketTasks([task({ id: "n", due_date: addDaysKey(T, 1) })], T);
  assert.equal(inUpcoming.upcoming.length, 1);
  // Tarihsiz görev Tümü'nde görünür
  assert.equal(bucketTasks([task({ id: "n" })], T).all.length, 1);
});

test("sortTasks: due asc, undated last, then priority, then newest; input untouched", () => {
  const input = [
    task({ id: "undated" }),
    task({ id: "later", due_date: "2026-09-25" }),
    task({ id: "soon-low", due_date: "2026-09-21", priority: "low" }),
    task({ id: "soon-urgent", due_date: "2026-09-21", priority: "urgent" }),
    task({ id: "soon-urgent-new", due_date: "2026-09-21", priority: "urgent", created_at: "2026-09-10T00:00:00Z" }),
  ];
  const before = input.map((t) => t.id);
  const out = sortTasks("all", input).map((t) => t.id);
  assert.deepEqual(out, ["soon-urgent-new", "soon-urgent", "soon-low", "later", "undated"]);
  assert.deepEqual(input.map((t) => t.id), before);
});

test("sortTasks completed: newest first", () => {
  const out = sortTasks("completed", [
    task({ id: "old", created_at: "2026-01-01" }),
    task({ id: "new", created_at: "2026-09-01" }),
  ]).map((t) => t.id);
  assert.deepEqual(out, ["new", "old"]);
});

test("groupTasks today: overdue then today; empty groups omitted", () => {
  const sorted = sortTasks("today", [
    task({ id: "a", due_date: "2026-09-10" }),
    task({ id: "b", due_date: T }),
  ]);
  const g = groupTasks("today", sorted, T);
  assert.deepEqual(g.map((x) => [x.id, x.tasks.map((t) => t.id)]), [["overdue", ["a"]], ["today", ["b"]]]);
  assert.deepEqual(groupTasks("today", sorted.slice(1), T).map((x) => x.id), ["today"]);
  assert.deepEqual(groupTasks("today", [], T), []);
});

test("groupTasks upcoming: one group per date; tomorrow is labelled", () => {
  const sorted = sortTasks("upcoming", [
    task({ id: "a", due_date: "2026-09-21" }),
    task({ id: "b", due_date: "2026-09-21", priority: "high" }),
    task({ id: "c", due_date: "2026-09-25" }),
  ]);
  const g = groupTasks("upcoming", sorted, T);
  assert.equal(g.length, 2);
  assert.equal(g[0].tasks.length, 2);
  assert.match(g[0].label, /^Yarın/);
});

test("groupTasks all/completed: single unlabelled group", () => {
  const g = groupTasks("all", [task({ id: "a" })], T);
  assert.equal(g.length, 1);
  assert.equal(g[0].label, "");
});
