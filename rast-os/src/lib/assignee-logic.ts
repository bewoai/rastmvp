// Görev atama — saf mantık: ekip üyesi adı / baş harfleri, görevin sorumlusunu çözme (assignee_id; yoksa eski
// serbest metin `assignee` bir üyenin adıyla eşleşiyorsa o üye), "Bana atanan / Herkes" süzgeçleri ve
// atama yaması. Testler: scripts/assignee-logic.test.mjs
import type { Task, TeamMember } from "./types";
import { normalizeSearch } from "./search-logic.ts";

/** Üyenin görünen adı (ad yoksa "İsimsiz üye"). full_name, ad verilmemişse e-postadır (handle_new_user). */
export function memberName(m: Pick<TeamMember, "full_name"> | null | undefined): string {
  return m?.full_name?.trim() || "İsimsiz üye";
}

/** Baş harfler: "Berat Değirmenci" → "BD", "mami" → "M", "d@ornek.com" → "D". En çok 2 harf. */
export function initialsOf(name: string | null | undefined): string {
  const clean = (name ?? "").trim().replace(/@.*$/, "");
  if (!clean) return "?";
  const parts = clean.split(/[\s._-]+/).filter(Boolean);
  const letters = (parts.length > 1 ? [parts[0], parts[parts.length - 1]] : [parts[0]]).map((p) => [...p][0] ?? "");
  return letters.join("").toLocaleUpperCase("tr-TR") || "?";
}

/**
 * Görevin sorumlusu olan üyenin id'si. Önce `assignee_id`; yoksa eski metin `assignee` bir üyenin tam adı,
 * ilk adı ya da adının başıyla (Türkçe/aksan duyarsız) TEK üyeyle eşleşiyorsa o üye. Aksi halde null.
 */
export function resolveAssigneeId(task: Pick<Task, "assignee_id" | "assignee">, members: readonly TeamMember[]): string | null {
  if (task.assignee_id) return task.assignee_id;
  const text = normalizeSearch(task.assignee);
  if (!text) return null;
  const hits = members.filter((m) => {
    const full = normalizeSearch(m.full_name);
    if (!full) return false;
    return full === text || full.split(" ")[0] === text || full.startsWith(`${text} `);
  });
  return hits.length === 1 ? hits[0].id : null;
}

/** Atanmamış: ne id var ne de bir üyeyle eşleşen metin (eşleşmeyen eski metin, ör. "Editör", atanmamış sayılır). */
export function isUnassigned(task: Pick<Task, "assignee_id" | "assignee">, members: readonly TeamMember[]): boolean {
  return resolveAssigneeId(task, members) === null;
}

export type OwnerFilter = "all" | "mine" | "mine_or_unassigned";

/**
 * Sorumluya göre süzer. `userId` bilinmiyorsa (oturum yok) süzgeç uygulanmaz — görevler kaybolmasın.
 * - all: hepsi · mine: bana atanan · mine_or_unassigned: bana atanan + atanmamış (Bugün varsayılanı)
 */
export function filterByOwner<T extends Pick<Task, "assignee_id" | "assignee">>(
  tasks: readonly T[],
  mode: OwnerFilter,
  userId: string | null | undefined,
  members: readonly TeamMember[],
): T[] {
  if (mode === "all" || !userId) return [...tasks];
  return tasks.filter((t) => {
    const who = resolveAssigneeId(t, members);
    return who === userId || (mode === "mine_or_unassigned" && who === null);
  });
}

export interface AssigneeView {
  /** Üye id'si (eşleşmeyen eski metinde null) */
  id: string | null;
  name: string;
  initials: string;
  /** Ekip üyesi mi (değilse eski serbest metin) */
  member: boolean;
}

/** Satırda gösterilecek sorumlu (atanmamışsa null). */
export function assigneeView(task: Pick<Task, "assignee_id" | "assignee">, members: readonly TeamMember[]): AssigneeView | null {
  const id = resolveAssigneeId(task, members);
  if (id) {
    const m = members.find((x) => x.id === id);
    const name = m ? memberName(m) : task.assignee?.trim() || "Ekip dışı üye";
    return { id, name, initials: initialsOf(name), member: Boolean(m) };
  }
  const text = task.assignee?.trim();
  return text ? { id: null, name: text, initials: initialsOf(text), member: false } : null;
}

/**
 * Önbellekli `assigneeView`: aynı (assignee_id, assignee) için AYNI nesneyi döndürür — memo'lu görev
 * satırları başka bir görev değişince yeniden render olmasın. Ekip listesi değişince yenisi oluşturulur.
 */
export function createAssigneeResolver(members: readonly TeamMember[]) {
  const cache = new Map<string, AssigneeView | null>();
  return (task: Pick<Task, "assignee_id" | "assignee">): AssigneeView | null => {
    const key = `${task.assignee_id ?? ""}\u0000${task.assignee ?? ""}`;
    if (!cache.has(key)) cache.set(key, assigneeView(task, members));
    return cache.get(key)!;
  };
}

/**
 * Atama yaması: id + görünen ad birlikte yazılır (eski `assignee` metnini okuyan yerler de doğru adı görsün).
 * null → atamayı kaldır (store boş string'i DB'ye null olarak yazar).
 */
export function assignPatch(memberId: string | null, members: readonly TeamMember[]): Pick<Task, "assignee_id" | "assignee"> {
  if (!memberId) return { assignee_id: "", assignee: "" };
  const m = members.find((x) => x.id === memberId);
  return { assignee_id: memberId, assignee: m ? memberName(m) : "" };
}

/** Seçicide gösterilecek üyeler: aktif olanlar + (pasif olsa da) şu an atanmış üye; ada göre sıralı. */
export function assignableMembers(members: readonly TeamMember[], keepId?: string | null): TeamMember[] {
  return members
    .filter((m) => m.is_active !== false || m.id === keepId)
    .sort((a, b) => memberName(a).localeCompare(memberName(b), "tr-TR"));
}
