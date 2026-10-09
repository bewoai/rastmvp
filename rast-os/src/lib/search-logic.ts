// Kayıt araması (Ctrl/⌘K) — saf mantık: Türkçe normalize, store'daki yüklü kayıtlardan indeks, puanlama,
// gruplama ve kayıt → sayfa bağlantısı. Ağ isteği yok. Testler: scripts/search-logic.test.mjs
import type { RastData } from "./types";

/**
 * Arama için metni sadeleştirir: Türkçe küçük harf (İ→i, I→ı), ı→i, aksanlar atılır (ş→s, ç→c, ğ→g,
 * ö→o, ü→u, â→a), boşluklar teke iner. Böylece "isik", "IŞIK", "ışık" aynı eşleşir.
 */
export function normalizeSearch(value: string | null | undefined): string {
  if (!value) return "";
  return value
    .toLocaleLowerCase("tr-TR")
    .replace(/ı/g, "i")
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

export type RecordKind =
  | "clients" | "brands" | "contacts" | "projects" | "tasks" | "jobs"
  | "invoices" | "proposals" | "leads" | "prospects" | "contents" | "shoots";

/** Sonuç gruplarının sırası ve başlıkları. */
export const RECORD_KINDS: { kind: RecordKind; label: string }[] = [
  { kind: "clients", label: "Müşteriler" },
  { kind: "projects", label: "Projeler" },
  { kind: "tasks", label: "Görevler" },
  { kind: "contents", label: "İçerikler" },
  { kind: "shoots", label: "Çekimler" },
  { kind: "proposals", label: "Teklifler" },
  { kind: "invoices", label: "Faturalar" },
  { kind: "jobs", label: "Tekil işler" },
  { kind: "leads", label: "Potansiyel müşteriler" },
  { kind: "prospects", label: "Müşteri Bulma adayları" },
  { kind: "brands", label: "Markalar" },
  { kind: "contacts", label: "Kişiler" },
];

export const RECORD_KIND_LABEL = Object.fromEntries(RECORD_KINDS.map((k) => [k.kind, k.label])) as Record<RecordKind, string>;

/**
 * Kaydın açılacağı yer. Detay sayfası olanlar (müşteri, teklif) oraya; diğerleri liste sayfasında
 * `?ac=<id>` ile düzenleme penceresini açar (görevlerde satır vurgulanır).
 */
export function recordHref(kind: RecordKind, id: string): string {
  const e = encodeURIComponent(id);
  switch (kind) {
    case "clients": return `/crm/clients/${e}`;
    case "proposals": return `/teklifler/${e}`;
    case "brands": return `/crm/brands?ac=${e}`;
    case "contacts": return `/crm/contacts?ac=${e}`;
    case "projects": return `/projects?ac=${e}`;
    case "tasks": return `/tasks?ac=${e}`;
    case "jobs": return `/jobs?ac=${e}`;
    case "invoices": return `/finance/invoices?ac=${e}`;
    case "leads": return `/crm/leads?ac=${e}`;
    case "prospects": return `/musteri-bulma?ac=${e}`;
    case "contents": return `/content?ac=${e}`;
    case "shoots": return `/shoots?ac=${e}`;
  }
}

export interface SearchDoc {
  kind: RecordKind;
  id: string;
  title: string;
  subtitle?: string;
  href: string;
  /** normalize edilmiş başlık */
  t: string;
  /** normalize edilmiş tüm aranabilir alanlar */
  hay: string;
}

export type SearchSource = Partial<Pick<RastData, RecordKind>>;

const join = (...parts: (string | number | null | undefined)[]) => parts.filter((p) => p !== undefined && p !== null && p !== "").join(" · ");

/** Store'daki yüklü kayıtlardan arama indeksi (tek geçiş, O(N)). */
export function buildSearchIndex(src: SearchSource): SearchDoc[] {
  const out: SearchDoc[] = [];
  const clientName = new Map<string, string>();
  for (const c of src.clients ?? []) clientName.set(c.id, c.name);
  const brandName = new Map<string, string>();
  for (const b of src.brands ?? []) brandName.set(b.id, b.name);
  const projectName = new Map<string, string>();
  for (const p of src.projects ?? []) projectName.set(p.id, p.name);
  const cn = (id?: string | null) => (id ? clientName.get(id) : undefined);

  const push = (kind: RecordKind, id: string, title: string, subtitle: string | undefined, fields: (string | number | null | undefined)[]) => {
    const shown = title.trim() || "(adsız)";
    out.push({
      kind, id, title: shown, subtitle: subtitle || undefined, href: recordHref(kind, id),
      t: normalizeSearch(shown),
      hay: normalizeSearch([shown, ...fields].filter((f) => f !== undefined && f !== null && f !== "").join(" ")),
    });
  };

  for (const c of src.clients ?? []) push("clients", c.id, c.name, join(c.is_active ? "Aktif" : "Pasif", c.tax_id ? `VKN ${c.tax_id}` : null), [c.tax_id]);
  for (const b of src.brands ?? []) push("brands", b.id, b.name, cn(b.client_id), [cn(b.client_id), b.instagram, b.website]);
  for (const c of src.contacts ?? []) push("contacts", c.id, c.full_name, join(c.title, cn(c.client_id)), [c.title, c.email, c.phone, cn(c.client_id)]);
  for (const p of src.projects ?? []) push("projects", p.id, p.name, join(cn(p.client_id), p.type), [cn(p.client_id), p.type, p.owner]);
  for (const t of src.tasks ?? []) {
    const project = t.project_id ? projectName.get(t.project_id) : undefined;
    push("tasks", t.id, t.title, join(project, t.status === "done" ? "Tamamlandı" : undefined), [project, t.assignee]);
  }
  for (const j of src.jobs ?? []) push("jobs", j.id, j.customer_name, join(j.service, j.date), [j.service, j.contact, j.job_type]);
  for (const i of src.invoices ?? []) {
    push("invoices", i.id, i.invoice_no ? `Fatura ${i.invoice_no}` : "Fatura (numarasız)", join(cn(i.client_id), i.issue_date), [i.invoice_no, cn(i.client_id), i.notes]);
  }
  for (const p of src.proposals ?? []) push("proposals", p.id, p.title, join(p.proposal_no, cn(p.client_id)), [p.proposal_no, cn(p.client_id)]);
  for (const l of src.leads ?? []) push("leads", l.id, l.company_name, join(l.contact_person, l.source), [l.contact_person, l.email, l.phone, l.instagram, l.interested_in]);
  for (const p of src.prospects ?? []) {
    // Places adaylarında ad saklanmaz (Google şartları): sektör + konumla anılır.
    const title = p.name?.trim() || join(p.sector, [p.district, p.city].filter(Boolean).join(", ")) || "Aday";
    push("prospects", p.id, title, join(p.name ? p.sector : undefined, p.city), [p.sector, p.city, p.district, p.email, p.website, p.instagram]);
  }
  for (const c of src.contents ?? []) {
    const brand = c.brand_id ? brandName.get(c.brand_id) : undefined;
    push("contents", c.id, c.title, join(brand ?? cn(c.client_id), c.platform, c.planned_date), [brand, cn(c.client_id), c.platform, c.content_type]);
  }
  for (const s of src.shoots ?? []) push("shoots", s.id, s.title, join(s.location, s.scheduled_at?.slice(0, 10)), [s.location, s.shoot_type, cn(s.client_id)]);
  return out;
}

/**
 * Eşleşme puanı (0 = eşleşmedi). Sorgunun her sözcüğü aranabilir alanlarda geçmeli; başlıkta tam / baştan /
 * sözcük başı eşleşme öne çıkar.
 */
export function scoreDoc(doc: Pick<SearchDoc, "t" | "hay">, q: string, tokens: readonly string[] = q.split(" ")): number {
  if (!q) return 0;
  for (const tok of tokens) if (tok && !doc.hay.includes(tok)) return 0;
  if (doc.t === q) return 100;
  if (doc.t.startsWith(q)) return 80;
  if (doc.t.includes(` ${q}`)) return 60;
  if (doc.t.includes(q)) return 40;
  if (tokens.every((tok) => doc.t.includes(tok))) return 30;
  return 10;
}

export interface SearchGroup {
  kind: RecordKind;
  label: string;
  items: SearchDoc[];
  /** Gösterilenden fazla eşleşme sayısı */
  more: number;
}

/** Gruplu sonuç: grup başına `perGroup`, grup sırası RECORD_KINDS; grupta en iyi puan önce. */
export function searchRecords(index: readonly SearchDoc[], query: string, perGroup = 4): SearchGroup[] {
  const q = normalizeSearch(query);
  if (!q) return [];
  const tokens = q.split(" ");
  const byKind = new Map<RecordKind, { doc: SearchDoc; score: number }[]>();
  for (const doc of index) {
    const score = scoreDoc(doc, q, tokens);
    if (!score) continue;
    const list = byKind.get(doc.kind);
    if (list) list.push({ doc, score });
    else byKind.set(doc.kind, [{ doc, score }]);
  }
  const groups: SearchGroup[] = [];
  for (const { kind, label } of RECORD_KINDS) {
    const list = byKind.get(kind);
    if (!list?.length) continue;
    list.sort((a, b) => b.score - a.score || a.doc.title.localeCompare(b.doc.title, "tr-TR"));
    groups.push({ kind, label, items: list.slice(0, perGroup).map((x) => x.doc), more: Math.max(0, list.length - perGroup) });
  }
  return groups;
}
