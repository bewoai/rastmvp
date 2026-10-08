"use client";

import { useStore, uid, nowISO } from "./store";
import type { MutationResult } from "./store";
import type { Proposal, ProposalItem } from "./types";
import { nextProposalNo } from "./proposal-logic";

/** Yeni teklifin başlık alanları (id / no / tarih damgaları burada üretilir). */
export type ProposalFields = Omit<Proposal, "id" | "proposal_no" | "created_at" | "updated_at" | "created_by">;
/** Kalem girdisi (id / teklif / sıra / tarih burada atanır). */
export type ItemInput = Pick<ProposalItem, "name" | "description" | "qty" | "unit" | "unit_price" | "is_recurring">;

const fail = (e: unknown): MutationResult => ({ ok: false, error: e instanceof Error ? e.message : String(e) });

// Eşzamanlı oluşturmada aynı numara (proposals_org_no_unique) → sıradakiyle yeniden dene.
const isDuplicateNo = (r: MutationResult) =>
  !r.ok && /proposals_org_no_unique|duplicate key|23505/i.test(r.error ?? "");

/**
 * Teklif + kalemlerini oluşturur. Numara RC-<yıl>-NNN, org'un mevcut tekliflerinden türetilir;
 * çakışırsa (başka kullanıcı aynı anda oluşturdu) 5 kez sıradaki numarayla denenir.
 * Kalem eklemesi başarısız olursa teklif yine oluşturulmuş sayılır (`ok: true`) ve `error` uyarı taşır.
 */
export async function createProposal(
  fields: ProposalFields,
  items: ItemInput[],
): Promise<MutationResult & { id?: string; proposal_no?: string }> {
  const id = uid();
  const now = nowISO();
  const year = new Date().getFullYear();
  const taken: { proposal_no: string }[] = [...useStore.getState().proposals];

  let res: MutationResult = { ok: false, error: "Teklif oluşturulamadı." };
  let proposal_no = "";
  for (let attempt = 0; attempt < 5; attempt++) {
    proposal_no = nextProposalNo(taken, year);
    res = await useStore
      .getState()
      .add("proposals", { ...fields, id, proposal_no, created_at: now, updated_at: now })
      .catch(fail);
    if (res.ok || !isDuplicateNo(res)) break;
    taken.push({ proposal_no });
  }
  if (!res.ok) return res;

  const results = await Promise.all(
    items.map((it, position) =>
      useStore
        .getState()
        .add("proposal_items", { ...it, id: uid(), proposal_id: id, position, created_at: now })
        .catch(fail),
    ),
  );
  const failed = results.filter((r) => !r.ok);
  return {
    ok: true,
    id,
    proposal_no,
    error: failed.length ? `${failed.length} kalem eklenemedi: ${failed[0].error ?? ""}` : undefined,
  };
}

/** Teklifi kalemleriyle kopyalar: yeni numara, taslak durumunda, "(kopya)" ekli başlık. */
export function duplicateProposal(p: Proposal, items: ProposalItem[], validUntil?: string) {
  return createProposal(
    {
      client_id: p.client_id,
      title: `${p.title} (kopya)`,
      status: "draft",
      currency: p.currency,
      vat_rate: p.vat_rate,
      valid_until: validUntil ?? p.valid_until,
      notes: p.notes,
      terms: p.terms,
    },
    [...items]
      .sort((a, b) => a.position - b.position)
      .map(({ name, description, qty, unit, unit_price, is_recurring }) => ({ name, description, qty, unit, unit_price, is_recurring })),
  );
}

/**
 * Teklifi siler. Veritabanında kalemler FK ile (on delete cascade) silinir; yerel store'daki
 * kalemler de burada temizlenir.
 */
export async function deleteProposal(id: string): Promise<MutationResult> {
  const r = await useStore.getState().remove("proposals", id).catch(fail);
  if (r.ok) {
    useStore.setState((s) => ({ proposal_items: s.proposal_items.filter((i) => i.proposal_id !== id) }));
  }
  return r;
}

const ITEM_FIELDS = ["position", "name", "description", "qty", "unit", "unit_price", "is_recurring"] as const;

function itemPatch(it: ProposalItem): Partial<ProposalItem> {
  return {
    position: it.position,
    name: it.name,
    description: it.description ?? "",
    qty: Number(it.qty) || 0,
    unit: it.unit,
    unit_price: Number(it.unit_price) || 0,
    is_recurring: it.is_recurring,
  };
}

export function itemChanged(a: ProposalItem, b: ProposalItem): boolean {
  const pa = itemPatch(a);
  const pb = itemPatch(b);
  return ITEM_FIELDS.some((k) => pa[k] !== pb[k]);
}

/**
 * Editör kaydı: başlık alanlarını günceller, kalemleri önceki (kayıtlı) hâliyle karşılaştırıp yalnızca
 * eklenen / değişen / silinen kalemler için istek atar. Kalem sırası dizideki sıradır (position).
 * Başarısız kalemler store tarafından geri alınır; editör kayıtlı hâli store'dan okuduğu için tekrar
 * "Kaydet" yalnızca eksik kalanları dener.
 */
export async function saveProposal(
  id: string,
  fields: Partial<ProposalFields> & { proposal_no?: string },
  draftItems: ProposalItem[],
  savedItems: ProposalItem[],
): Promise<MutationResult> {
  const s = useStore.getState();
  const head = await s.update("proposals", id, { ...fields, updated_at: nowISO() }).catch(fail);
  if (!head.ok) {
    return isDuplicateNo(head) ? { ok: false, error: "Bu teklif numarası zaten kullanılıyor." } : head;
  }

  const saved = new Map(savedItems.map((i) => [i.id, i]));
  const keep = new Set(draftItems.map((i) => i.id));
  const ops: Promise<MutationResult>[] = [];

  draftItems.forEach((it, position) => {
    const row: ProposalItem = { ...it, position, proposal_id: id };
    const prev = saved.get(it.id);
    if (!prev) ops.push(s.add("proposal_items", { ...row, ...itemPatch(row), created_at: row.created_at || nowISO() }).catch(fail));
    else if (itemChanged(prev, row)) ops.push(s.update("proposal_items", it.id, itemPatch(row)).catch(fail));
  });
  for (const prev of savedItems) {
    if (!keep.has(prev.id)) ops.push(s.remove("proposal_items", prev.id).catch(fail));
  }

  const failed = (await Promise.all(ops)).filter((r) => !r.ok);
  return failed.length ? { ok: false, error: `${failed.length} kalem kaydedilemedi: ${failed[0].error ?? ""}` } : { ok: true };
}
