// Görevler ekranının saf (React'siz) mantığı: tarih anahtarları, görünümlere ayırma,
// sıralama, gruplama. Testler: scripts/tasks-logic.test.mjs
import type { Priority, Task } from "./types";

export type TaskView = "today" | "upcoming" | "all" | "completed";

export interface TaskBuckets {
  today: Task[];
  upcoming: Task[];
  all: Task[];
  completed: Task[];
}

export interface TaskGroup {
  id: string;
  label: string;
  tasks: Task[];
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Yerel saate göre YYYY-MM-DD (toISOString UTC kaydırır, kullanılmaz). */
export function dateKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export const todayKey = (now: Date = new Date()) => dateKey(now);

function parseKey(key: string): number {
  const [y, m, d] = key.slice(0, 10).split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

export function addDaysKey(key: string, days: number): string {
  const d = new Date(parseKey(key) + days * 86_400_000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export const daysBetween = (from: string, to: string) =>
  Math.round((parseKey(to) - parseKey(from)) / 86_400_000);

/** "Bugün" / "Yarın" / "Dün" / "21 Eyl" (yıl farklıysa yılıyla). */
export function formatDue(key: string, today: string): string {
  const diff = daysBetween(today, key);
  if (diff === 0) return "Bugün";
  if (diff === 1) return "Yarın";
  if (diff === -1) return "Dün";
  const sameYear = key.slice(0, 4) === today.slice(0, 4);
  return new Date(parseKey(key)).toLocaleDateString("tr-TR", {
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
    timeZone: "UTC",
  });
}

function formatGroupDate(key: string, today: string): string {
  const full = new Date(parseKey(key)).toLocaleDateString("tr-TR", {
    day: "numeric",
    month: "long",
    weekday: "long",
    timeZone: "UTC",
  });
  const diff = daysBetween(today, key);
  return diff === 1 ? `Yarın · ${full}` : full;
}

const prioRank: Record<Priority, number> = { urgent: 0, high: 1, medium: 2, low: 3 };

const dueOf = (t: Task) => (t.due_date ? t.due_date.slice(0, 10) : "");

/**
 * Tek geçişte (O(N)) görünümlere ayırır.
 * - completed: status === "done"
 * - all: tamamlanmamış her görev (tarihsiz dahil)
 * - today: tamamlanmamış ve son tarihi bugün veya geçmiş (gecikenler dahil)
 * - upcoming: tamamlanmamış ve son tarihi bugünden sonra
 */
export function bucketTasks(tasks: Task[], today: string): TaskBuckets {
  const out: TaskBuckets = { today: [], upcoming: [], all: [], completed: [] };
  for (const t of tasks) {
    if (t.status === "done") {
      out.completed.push(t);
      continue;
    }
    out.all.push(t);
    const due = dueOf(t);
    if (!due) continue;
    if (due <= today) out.today.push(t);
    else out.upcoming.push(t);
  }
  return out;
}

function compareOpen(a: Task, b: Task): number {
  const da = dueOf(a);
  const db = dueOf(b);
  if (da !== db) {
    if (!da) return 1; // tarihsizler sona
    if (!db) return -1;
    return da < db ? -1 : 1;
  }
  const pa = prioRank[a.priority] ?? 2;
  const pb = prioRank[b.priority] ?? 2;
  if (pa !== pb) return pa - pb;
  return b.created_at.localeCompare(a.created_at);
}

const compareCompleted = (a: Task, b: Task) => b.created_at.localeCompare(a.created_at);

/** Girdiyi değiştirmez. Açık görevler: tarih → öncelik → yeni olan önce. */
export function sortTasks(view: TaskView, list: Task[]): Task[] {
  return [...list].sort(view === "completed" ? compareCompleted : compareOpen);
}

export function groupTasks(view: TaskView, sorted: Task[], today: string): TaskGroup[] {
  if (sorted.length === 0) return [];

  if (view === "today") {
    const overdue = sorted.filter((t) => dueOf(t) < today);
    const due = sorted.filter((t) => dueOf(t) >= today);
    const groups: TaskGroup[] = [];
    if (overdue.length) groups.push({ id: "overdue", label: "Gecikmiş", tasks: overdue });
    if (due.length) groups.push({ id: "today", label: "Bugün", tasks: due });
    return groups;
  }

  if (view === "upcoming") {
    const groups: TaskGroup[] = [];
    for (const t of sorted) {
      const due = dueOf(t);
      const last = groups[groups.length - 1];
      if (last && last.id === due) last.tasks.push(t);
      else groups.push({ id: due, label: formatGroupDate(due, today), tasks: [t] });
    }
    return groups;
  }

  return [{ id: view, label: "", tasks: sorted }];
}
