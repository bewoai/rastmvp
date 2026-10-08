"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowLeft, ArrowUp, FileDown, Plus, Save, Trash2 } from "lucide-react";
import { PageHeader, EmptyState, Badge } from "@/components/ui";
import { Field, Input, Select, Textarea, Button } from "@/components/form";
import { PageLoading } from "@/components/list";
import { ConfirmDialog } from "@/components/confirm";
import { useStore, useHydrated, uid, nowISO } from "@/lib/store";
import { useToasts } from "@/lib/toast";
import { proposalStatus } from "@/lib/labels";
import { formatMoney, lineTotal, moveItem, proposalTotals, sortItems } from "@/lib/proposal-logic";
import { PROPOSAL_PRESETS, findPreset, presetKey, presetTitle, presetToItems } from "@/lib/proposal-presets";
import { itemChanged, saveProposal } from "@/lib/proposalActions";
import type { Client, Currency, Proposal, ProposalItem, ProposalStatus } from "@/lib/types";

const statusOptions = (Object.keys(proposalStatus) as ProposalStatus[]).map((value) => ({ value, ...proposalStatus[value] }));
const CURRENCIES: Currency[] = ["TRY", "USD", "EUR"];
const UNITS = ["ay", "adet", "gün", "video", "saat", "paket"];

type Head = {
  title: string;
  client_id: string;
  proposal_no: string;
  status: ProposalStatus;
  currency: Currency;
  vat_rate: number;
  valid_until: string;
  notes: string;
  terms: string;
};

const headOf = (p: Proposal): Head => ({
  title: p.title ?? "",
  client_id: p.client_id ?? "",
  proposal_no: p.proposal_no ?? "",
  status: p.status,
  currency: p.currency ?? "TRY",
  vat_rate: Number(p.vat_rate ?? 20),
  valid_until: p.valid_until ?? "",
  notes: p.notes ?? "",
  terms: p.terms ?? "",
});

const sameHead = (a: Head, b: Head) => (Object.keys(a) as (keyof Head)[]).every((k) => a[k] === b[k]);

function sameItems(draft: ProposalItem[], saved: ProposalItem[]) {
  if (draft.length !== saved.length) return false;
  return draft.every((it, i) => it.id === saved[i].id && !itemChanged(saved[i], { ...it, position: i }));
}

/** Sayı alanı: 0 iken boş görünür (yazarken "05" olmasın), boş giriş → 0. */
const numValue = (n: number) => (n ? String(n) : "");
const toNum = (v: string) => (v === "" ? 0 : Number(v));

export default function ProposalEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const hydrated = useHydrated(["proposals", "proposal_items", "clients"]);
  const proposal = useStore((s) => s.proposals.find((p) => p.id === id));

  if (!hydrated) return <PageLoading title="Teklif" />;
  if (!proposal) {
    return (
      <>
        <PageHeader title="Teklif bulunamadı" />
        <EmptyState title="Bu teklif yok veya silinmiş" hint="Teklif listesine dönüp başka bir kayıt seçin." cta={{ label: "Tekliflere dön", href: "/teklifler" }} />
      </>
    );
  }
  return <ProposalEditor key={proposal.id} proposal={proposal} />;
}

function ProposalEditor({ proposal }: { proposal: Proposal }) {
  const router = useRouter();
  const clients = useStore((s) => s.clients);
  const allItems = useStore((s) => s.proposal_items);
  const allProposals = useStore((s) => s.proposals);
  const savedItems = useMemo(() => sortItems(allItems.filter((i) => i.proposal_id === proposal.id)), [allItems, proposal.id]);

  const [head, setHead] = useState<Head>(() => headOf(proposal));
  const [items, setItems] = useState<ProposalItem[]>(() => savedItems);
  const [preset, setPreset] = useState("");
  const [confirmPreset, setConfirmPreset] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);

  const savedHead = useMemo(() => headOf(proposal), [proposal]);
  const dirty = !sameHead(head, savedHead) || !sameItems(items, savedItems);
  const totals = useMemo(() => proposalTotals(items, head.vat_rate), [items, head.vat_rate]);
  const money = (n: number) => formatMoney(n, head.currency);

  const set = <K extends keyof Head>(key: K, value: Head[K]) => setHead((h) => ({ ...h, [key]: value }));
  const setItem = (idx: number, patch: Partial<ProposalItem>) =>
    setItems((list) => list.map((it, i) => (i === idx ? { ...it, ...patch } : it)));

  // Kaydedilmemiş değişiklikle sekme kapatma / yenileme uyarısı
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  const save = useCallback(async (): Promise<boolean> => {
    const title = head.title.trim();
    const no = head.proposal_no.trim();
    if (!title) {
      setError("Başlık boş olamaz.");
      return false;
    }
    if (!no) {
      setError("Teklif numarası boş olamaz.");
      return false;
    }
    if (allProposals.some((p) => p.id !== proposal.id && p.proposal_no === no)) {
      setError(`${no} başka bir teklifte kullanılıyor.`);
      return false;
    }
    const unnamed = items.findIndex((it) => !it.name.trim());
    if (unnamed >= 0) {
      setError(`${unnamed + 1}. kalemin adı boş.`);
      return false;
    }
    setSaving(true);
    setError(null);
    const res = await saveProposal(
      proposal.id,
      {
        title,
        proposal_no: no,
        client_id: head.client_id || undefined,
        status: head.status,
        currency: head.currency,
        vat_rate: head.vat_rate,
        valid_until: head.valid_until,
        notes: head.notes,
        terms: head.terms,
      },
      items.map((it) => ({ ...it, name: it.name.trim() })),
      savedItems,
    );
    setSaving(false);
    if (!res.ok) {
      setError(res.error ?? "Kaydedilemedi.");
      useToasts.getState().push({ message: res.error ?? "Teklif kaydedilemedi.", tone: "danger" });
      return false;
    }
    // client_id "" → store'da undefined değil "" kalabilir; taslağı kayıtlı hâlle hizala
    setHead((h) => ({ ...h, title, proposal_no: no }));
    setItems((list) => list.map((it) => ({ ...it, name: it.name.trim() })));
    useToasts.getState().push({ message: "Teklif kaydedildi" });
    return true;
  }, [head, items, savedItems, allProposals, proposal.id]);

  // Ctrl/Cmd + S = Kaydet
  const saveRef = useRef(save);
  useEffect(() => {
    saveRef.current = save;
  });
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void saveRef.current();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  async function openPdf() {
    if (dirty && !(await save())) return;
    router.push(`/teklifler/${proposal.id}/yazdir`);
  }

  function applyPreset() {
    const found = findPreset(preset);
    if (!found) return;
    setItems(presetToItems(found.pkg, proposal.id, uid, nowISO()));
    setHead((h) => ({
      ...h,
      title: !h.title.trim() || h.title.trim() === "Yeni teklif" ? presetTitle(found.group, found.pkg) : h.title,
      notes: h.notes.trim() ? h.notes : found.group.notes,
      terms: h.terms.trim() ? h.terms : found.group.terms,
    }));
    setConfirmPreset(false);
    useToasts.getState().push({ message: `“${presetTitle(found.group, found.pkg)}” kalemleri eklendi — kaydetmeyi unutma` });
  }

  function addItem() {
    const last = items[items.length - 1];
    const item: ProposalItem = {
      id: uid(), proposal_id: proposal.id, position: items.length, name: "", description: "",
      qty: 1, unit: last?.unit ?? "ay", unit_price: 0, is_recurring: last?.is_recurring ?? true, created_at: nowISO(),
    };
    setItems((list) => [...list, item]);
    setFocusId(item.id);
  }

  const clientName = clients.find((c: Client) => c.id === head.client_id)?.name;

  return (
    <>
      <PageHeader
        title={`${head.proposal_no || "Teklif"}${clientName ? ` · ${clientName}` : ""}`}
        subtitle={head.title || "Başlıksız teklif"}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/teklifler"
              prefetch={false}
              onClick={(e) => {
                if (dirty && !window.confirm("Kaydedilmemiş değişiklikler var. Yine de çıkılsın mı?")) e.preventDefault();
              }}
              className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-sm text-foreground transition-colors hover:bg-surface-2"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden /> Teklifler
            </Link>
            <Button variant="ghost" onClick={openPdf} disabled={saving} title={dirty ? "Önce kaydeder, sonra yazdırma görünümünü açar" : undefined}>
              <FileDown className="h-4 w-4" aria-hidden /> PDF
            </Button>
            <Button onClick={() => void save()} loading={saving} disabled={!dirty && !error}>
              {!saving && <Save className="h-4 w-4" aria-hidden />}
              {saving ? "Kaydediliyor…" : dirty ? "Kaydet" : "Kaydedildi"}
            </Button>
          </div>
        }
      />

      {error && (
        <p role="alert" className="mb-3 rounded-xl border border-danger/40 bg-danger/10 px-3.5 py-2.5 text-sm text-danger">{error}</p>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_19rem]">
        <div className="min-w-0 space-y-4">
          {/* Başlık bilgileri */}
          <section className="card p-4" aria-labelledby="sec-head">
            <h2 id="sec-head" className="mb-3 text-sm font-semibold text-foreground">Teklif bilgileri</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div className="sm:col-span-2">
                <Field label="Başlık *">
                  <Input value={head.title} onChange={(e) => set("title", e.target.value)} autoComplete="off" />
                </Field>
              </div>
              <div className="sm:col-span-2">
                <Field label="Müşteri" hint={clients.length === 0 ? "Henüz müşteri yok — CRM › Müşteriler'den ekleyin." : undefined}>
                  <Select value={head.client_id} onChange={(e) => set("client_id", e.target.value)}>
                    <option value="">Seçilmedi</option>
                    {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </Select>
                </Field>
              </div>
              <Field label="Teklif no *">
                <Input value={head.proposal_no} onChange={(e) => set("proposal_no", e.target.value)} autoComplete="off" className="font-mono" />
              </Field>
              <Field label="Durum">
                <Select value={head.status} onChange={(e) => set("status", e.target.value as ProposalStatus)}>
                  {statusOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </Select>
              </Field>
              <Field label="Geçerlilik tarihi">
                <Input type="date" value={head.valid_until} onChange={(e) => set("valid_until", e.target.value)} />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Para birimi">
                  <Select value={head.currency} onChange={(e) => set("currency", e.target.value as Currency)}>
                    {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </Select>
                </Field>
                <Field label="KDV %">
                  <Input type="number" inputMode="decimal" min="0" max="100" value={String(head.vat_rate)} onChange={(e) => set("vat_rate", Math.min(100, Math.max(0, toNum(e.target.value))))} />
                </Field>
              </div>
            </div>
          </section>

          {/* Kapsam / kalemler */}
          <section className="card p-4" aria-labelledby="sec-items">
            <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
              <h2 id="sec-items" className="text-sm font-semibold text-foreground">Kapsam ve fiyat <span className="font-normal text-muted">· KDV hariç</span></h2>
              <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center md:w-auto">
                <Select value={preset} onChange={(e) => setPreset(e.target.value)} aria-label="Paket şablonu" className="min-w-0 sm:flex-1 md:w-72 md:flex-none">
                  <option value="">Paket şablonu seç…</option>
                  {PROPOSAL_PRESETS.map((g) => (
                    <optgroup key={g.id} label={g.label}>
                      {g.packages.map((p) => (
                        <option key={p.id} value={presetKey(g.id, p.id)}>{p.label}{p.summary ? ` — ${p.summary}` : ""}</option>
                      ))}
                    </optgroup>
                  ))}
                </Select>
                <Button variant="ghost" className="whitespace-nowrap" disabled={!preset} onClick={() => (items.length ? setConfirmPreset(true) : applyPreset())}>
                  Kalemleri doldur
                </Button>
              </div>
            </div>

            <datalist id="proposal-units">
              {UNITS.map((u) => <option key={u} value={u} />)}
            </datalist>

            {items.length === 0 ? (
              <EmptyState title="Henüz kalem yok" hint="Yukarıdan bir paket şablonu seçin ya da kalemleri tek tek ekleyin." action={{ label: "Kalem ekle", onClick: addItem }} />
            ) : (
              <ol className="space-y-2">
                {items.map((it, idx) => (
                  <li key={it.id} className="rounded-xl border border-border/70 bg-background/30 p-3">
                    <div className="flex items-start gap-2">
                      <span className="mt-3 w-5 shrink-0 text-right text-xs tabular-nums text-muted" aria-hidden>{idx + 1}.</span>
                      <div className="min-w-0 flex-1 space-y-2">
                        <div className="flex flex-col gap-2 sm:flex-row">
                        <div className="min-w-0 flex-1">
                          <Input
                            value={it.name}
                            onChange={(e) => setItem(idx, { name: e.target.value })}
                            placeholder="Hizmet adı"
                            aria-label={`${idx + 1}. kalem: hizmet adı`}
                            autoFocus={focusId === it.id}
                            autoComplete="off"
                          />
                        </div>
                        <div className="sm:w-36 sm:shrink-0">
                          <Select
                            value={it.is_recurring ? "1" : "0"}
                            onChange={(e) => setItem(idx, { is_recurring: e.target.value === "1" })}
                            aria-label={`${idx + 1}. kalem: ödeme türü`}
                          >
                            <option value="1">Aylık</option>
                            <option value="0">Tek seferlik</option>
                          </Select>
                        </div>
                        </div>
                        <div>
                          <Input
                            value={it.description ?? ""}
                            onChange={(e) => setItem(idx, { description: e.target.value })}
                            placeholder="Açıklama (opsiyonel) — PDF'te hizmet adının altında görünür"
                            aria-label={`${idx + 1}. kalem: açıklama`}
                            autoComplete="off"
                          />
                        </div>
                        <div className="flex flex-wrap items-end gap-2">
                        <label className="block w-20">
                          <span className="mb-1 block text-[11px] text-muted">Miktar</span>
                          <Input className="px-2.5!" type="number" inputMode="decimal" min="0" step="any" value={numValue(it.qty)} onChange={(e) => setItem(idx, { qty: toNum(e.target.value) })} placeholder="0" />
                        </label>
                        <label className="block w-24">
                          <span className="mb-1 block text-[11px] text-muted">Birim</span>
                          <Input className="px-2.5!" list="proposal-units" value={it.unit} onChange={(e) => setItem(idx, { unit: e.target.value })} autoComplete="off" />
                        </label>
                        <label className="block min-w-[8rem] flex-1">
                          <span className="mb-1 block text-[11px] text-muted">Birim fiyat ({head.currency})</span>
                          <Input type="number" inputMode="decimal" step="any" value={numValue(it.unit_price)} onChange={(e) => setItem(idx, { unit_price: toNum(e.target.value) })} placeholder="0" />
                        </label>
                        <div className="flex min-w-[7.5rem] flex-1 flex-col justify-end text-right">
                          <span className="mb-1 block text-[11px] text-muted">Tutar</span>
                          <span className={`whitespace-nowrap py-2.5 text-sm font-medium tabular-nums ${lineTotal(it) === 0 ? "text-warning" : "text-foreground"}`}>
                            {money(lineTotal(it))}{it.is_recurring && <span className="text-xs font-normal text-muted"> / ay</span>}
                          </span>
                        </div>
                        </div>
                      </div>
                      <div className="flex shrink-0 flex-col gap-0.5">
                        <button type="button" onClick={() => setItems((l) => moveItem(l, idx, -1))} disabled={idx === 0} aria-label={`${idx + 1}. kalemi yukarı taşı`} title="Yukarı" className="flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-foreground disabled:opacity-30">
                          <ArrowUp className="h-4 w-4" aria-hidden />
                        </button>
                        <button type="button" onClick={() => setItems((l) => moveItem(l, idx, 1))} disabled={idx === items.length - 1} aria-label={`${idx + 1}. kalemi aşağı taşı`} title="Aşağı" className="flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-foreground disabled:opacity-30">
                          <ArrowDown className="h-4 w-4" aria-hidden />
                        </button>
                        <button type="button" onClick={() => setItems((l) => l.filter((_, i) => i !== idx))} aria-label={`${idx + 1}. kalemi sil`} title="Kalemi sil" className="flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-danger/15 hover:text-danger">
                          <Trash2 className="h-4 w-4" aria-hidden />
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            )}

            {items.length > 0 && (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <Button variant="ghost" onClick={addItem}>
                  <Plus className="h-4 w-4" aria-hidden /> Kalem ekle
                </Button>
                <p className="text-xs text-muted">Strateji, raporlama ve kreatif ayrı kalem olarak yazılmaz — hizmetlere dahildir.</p>
              </div>
            )}
          </section>

          {/* Süreç + koşullar */}
          <section className="card p-4" aria-labelledby="sec-text">
            <h2 id="sec-text" className="mb-3 text-sm font-semibold text-foreground">Süreç ve koşullar</h2>
            <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
              <Field label="Süreç / takvim" hint="Her satır PDF'te bir adım olur. “1. …” veya “- …” ile liste yazın.">
                <Textarea rows={8} value={head.notes} onChange={(e) => set("notes", e.target.value)} />
              </Field>
              <Field label="Sorumluluklar ve ödeme koşulları" hint="“## Başlık” alt başlık, “- madde” madde işareti olur.">
                <Textarea rows={8} value={head.terms} onChange={(e) => set("terms", e.target.value)} />
              </Field>
            </div>
          </section>
        </div>

        {/* Canlı toplamlar */}
        <aside className="xl:sticky xl:top-0 xl:self-start" aria-label="Toplamlar">
          <section className="card p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-foreground">Toplamlar</h2>
              {dirty ? <Badge tone="warning">Kaydedilmedi</Badge> : <Badge tone="muted">Kayıtlı</Badge>}
            </div>
            <dl className="space-y-1.5 text-sm">
              <div className="flex justify-between gap-3"><dt className="text-muted">Ara toplam</dt><dd className="tabular-nums text-foreground">{money(totals.subtotal)}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-muted">KDV (%{head.vat_rate})</dt><dd className="tabular-nums text-foreground">{money(totals.vat)}</dd></div>
              <div className="flex justify-between gap-3 border-t border-border/70 pt-2">
                <dt className="font-medium text-foreground">Genel toplam{totals.mixed && <span className="block text-[11px] font-normal text-muted">ilk ay (aylık + tek seferlik)</span>}</dt>
                <dd className="text-lg font-semibold tabular-nums text-amber">{money(totals.total)}</dd>
              </div>
            </dl>
            {(totals.recurring.subtotal !== 0 || totals.oneOff.subtotal !== 0) && (
              <dl className="mt-4 space-y-2 border-t border-border/70 pt-3 text-xs">
                <div>
                  <dt className="mb-0.5 font-medium text-foreground">Aylık (her ay)</dt>
                  <dd className="flex justify-between gap-3 text-muted"><span>{money(totals.recurring.subtotal)} + KDV</span><span className="tabular-nums text-foreground">{money(totals.recurring.total)}</span></dd>
                </div>
                <div>
                  <dt className="mb-0.5 font-medium text-foreground">Tek seferlik</dt>
                  <dd className="flex justify-between gap-3 text-muted"><span>{money(totals.oneOff.subtotal)} + KDV</span><span className="tabular-nums text-foreground">{money(totals.oneOff.total)}</span></dd>
                </div>
              </dl>
            )}
            <div className="mt-4 grid gap-2">
              <Button onClick={openPdf} disabled={saving}>
                <FileDown className="h-4 w-4" aria-hidden /> PDF / yazdır
              </Button>
              <p className="text-[11px] leading-4 text-muted">{dirty ? "Değişiklikler önce kaydedilir." : "Yazdırma görünümünde “PDF olarak kaydet” seçin."} Kısayol: Ctrl+S kaydeder.</p>
            </div>
          </section>
        </aside>
      </div>

      {confirmPreset && (
        <ConfirmDialog
          title="Kalemler değiştirilsin mi?"
          message={<p>Mevcut {items.length} kalem seçilen paketin kalemleriyle <strong className="text-foreground">değiştirilecek</strong>. Süreç ve koşul metinleri yalnızca boşsa doldurulur. Kaydetmeden önce geri almak için sayfayı yenileyebilirsiniz.</p>}
          confirmLabel="Değiştir"
          onConfirm={applyPreset}
          onCancel={() => setConfirmPreset(false)}
        />
      )}
    </>
  );
}
