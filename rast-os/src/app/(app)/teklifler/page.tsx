"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Copy, Plus, Printer } from "lucide-react";
import { PageHeader, EmptyState, StatStrip } from "@/components/ui";
import { FormModal, Field, Input, Select, Button, useFormState } from "@/components/form";
import { DataTable, FilterChips, PageLoading, RowActions, SearchBox, StatusSelect, Toolbar, useListSearch, useNewIntent, usePersistentState } from "@/components/list";
import type { Column } from "@/components/list";
import { ConfirmDialog } from "@/components/confirm";
import { useStore, useHydrated } from "@/lib/store";
import { useToday } from "@/lib/useToday";
import { addDaysKey } from "@/lib/taskLogic";
import { patchRecord } from "@/lib/mutate";
import { useToasts } from "@/lib/toast";
import { proposalStatus, dateTR } from "@/lib/labels";
import { formatMoney, isExpired, proposalTotals } from "@/lib/proposal-logic";
import type { ProposalTotals } from "@/lib/proposal-logic";
import { PROPOSAL_PRESETS, findPreset, presetKey, presetTitle } from "@/lib/proposal-presets";
import { createProposal, deleteProposal, duplicateProposal } from "@/lib/proposalActions";
import type { Client, Proposal, ProposalItem, ProposalStatus } from "@/lib/types";

const statusOptions = (Object.keys(proposalStatus) as ProposalStatus[]).map((value) => ({ value, ...proposalStatus[value] }));

type StatusFilter = "all" | ProposalStatus;
const FILTERS: readonly StatusFilter[] = ["all", "draft", "sent", "accepted", "rejected", "expired"];

type Row = {
  proposal: Proposal;
  client: string;
  totals: ProposalTotals;
  expired: boolean;
};

/** Yeni teklif: müşteri + paket + başlık → oluştur → editöre git (kalemler paketten dolu gelir). */
function NewProposalModal({ clients, today, onClose }: { clients: Client[]; today: string; onClose: () => void }) {
  const router = useRouter();
  const f = useFormState({ client_id: "", preset: presetKey("hekim", "standart"), title: "", valid_until: addDaysKey(today, 30) });
  const { form } = f;
  const preset = findPreset(form.preset);
  const suggested = preset ? presetTitle(preset.group, preset.pkg) : "";

  async function submit() {
    const title = form.title.trim() || suggested;
    if (!title) return { ok: false, error: "Başlık girin veya bir paket seçin." };
    const res = await createProposal(
      {
        client_id: form.client_id || undefined,
        title,
        status: "draft",
        currency: "TRY",
        vat_rate: 20,
        valid_until: form.valid_until || undefined,
        notes: preset?.group.notes,
        terms: preset?.group.terms,
      },
      preset?.pkg.items ?? [],
    );
    if (!res.ok || !res.id) return res;
    if (res.error) useToasts.getState().push({ message: res.error, tone: "danger" });
    router.push(`/teklifler/${res.id}`);
    return { ok: true };
  }

  return (
    <FormModal title="Yeni teklif" onClose={onClose} onSubmit={submit} submitLabel="Oluştur ve düzenle" successMessage="Teklif oluşturuldu">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Müşteri" hint={clients.length === 0 ? "Henüz müşteri yok — CRM › Müşteriler'den ekleyin." : undefined}>
          <Select {...f.text("client_id")} data-autofocus>
            <option value="">Seçilmedi</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
        <Field label="Paket">
          <Select {...f.text("preset")}>
            <option value="">Boş teklif (kalemsiz)</option>
            {PROPOSAL_PRESETS.map((g) => (
              <optgroup key={g.id} label={g.label}>
                {g.packages.map((p) => (
                  <option key={p.id} value={presetKey(g.id, p.id)}>{p.label}{p.summary ? ` — ${p.summary}` : ""}</option>
                ))}
              </optgroup>
            ))}
          </Select>
        </Field>
        <div className="sm:col-span-2">
          <Field label="Başlık">
            <Input {...f.text("title")} placeholder={suggested || "ör. Sosyal medya yönetimi teklifi"} autoComplete="off" />
          </Field>
        </div>
        <Field label="Geçerlilik tarihi"><Input type="date" {...f.text("valid_until")} /></Field>
      </div>
    </FormModal>
  );
}

export default function ProposalsPage() {
  const hydrated = useHydrated(["proposals", "proposal_items", "clients"]);
  const proposals = useStore((s) => s.proposals);
  const items = useStore((s) => s.proposal_items);
  const clients = useStore((s) => s.clients);
  const today = useToday();
  const router = useRouter();

  const wantNew = useNewIntent();
  const [creating, setCreating] = useState(wantNew);
  const [filter, setFilter] = usePersistentState<StatusFilter>("proposals-status", "all", FILTERS);
  const [query, setQuery] = useState("");
  const [toDelete, setToDelete] = useState<Proposal | null>(null);
  const [copying, setCopying] = useState<string | null>(null);

  const itemsByProposal = useMemo(() => {
    const map = new Map<string, ProposalItem[]>();
    for (const it of items) {
      const list = map.get(it.proposal_id);
      if (list) list.push(it);
      else map.set(it.proposal_id, [it]);
    }
    return map;
  }, [items]);

  const rows = useMemo<Row[]>(() => {
    const clientMap = new Map(clients.map((c) => [c.id, c.name]));
    return [...proposals]
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)) || b.proposal_no.localeCompare(a.proposal_no))
      .map((proposal) => ({
        proposal,
        client: clientMap.get(proposal.client_id || "") || "—",
        totals: proposalTotals(itemsByProposal.get(proposal.id) ?? [], proposal.vat_rate),
        expired: isExpired(proposal, today),
      }));
  }, [proposals, clients, itemsByProposal, today]);

  const counts = useMemo(() => {
    const c: Record<StatusFilter, number> = { all: rows.length, draft: 0, sent: 0, accepted: 0, rejected: 0, expired: 0 };
    for (const r of rows) c[r.proposal.status]++;
    return c;
  }, [rows]);

  const filtered = useMemo(() => (filter === "all" ? rows : rows.filter((r) => r.proposal.status === filter)), [rows, filter]);
  const visible = useListSearch(filtered, query, (r) => `${r.proposal.proposal_no} ${r.proposal.title} ${r.client}`);

  const stats = useMemo(() => {
    const open = rows.filter((r) => r.proposal.status === "draft" || r.proposal.status === "sent");
    const accepted = rows.filter((r) => r.proposal.status === "accepted");
    // Para birimi karışık olabilir; özet yalnızca TRY tekliflerini toplar.
    const sum = (list: Row[]) => list.filter((r) => r.proposal.currency === "TRY").reduce((s, r) => s + r.totals.subtotal, 0);
    const decided = rows.filter((r) => r.proposal.status === "accepted" || r.proposal.status === "rejected").length;
    return {
      openCount: open.length,
      openSum: sum(open),
      acceptedSum: sum(accepted),
      rate: decided ? Math.round((accepted.length / decided) * 100) : null,
    };
  }, [rows]);

  async function copy(r: Row) {
    if (copying) return;
    setCopying(r.proposal.id);
    const res = await duplicateProposal(r.proposal, itemsByProposal.get(r.proposal.id) ?? [], addDaysKey(today, 30));
    setCopying(null);
    const toasts = useToasts.getState();
    if (!res.ok || !res.id) {
      toasts.push({ message: `Kopyalanamadı: ${res.error ?? ""}`, tone: "danger" });
      return;
    }
    toasts.push({
      message: res.error ? `Kopya oluşturuldu (${res.proposal_no}) — ${res.error}` : `Kopya oluşturuldu: ${res.proposal_no}`,
      tone: res.error ? "danger" : "default",
      href: `/teklifler/${res.id}`,
      hrefLabel: "Aç",
    });
  }

  function confirmDelete() {
    if (!toDelete) return;
    const p = toDelete;
    setToDelete(null);
    void deleteProposal(p.id).then((r) => {
      const toasts = useToasts.getState();
      if (r.ok) toasts.push({ message: `“${p.proposal_no}” silindi` });
      else toasts.push({ message: `“${p.proposal_no}” silinemedi${r.error ? `: ${r.error}` : ""}`, tone: "danger" });
    });
  }

  const columns = useMemo<Column<Row>[]>(() => [
    {
      key: "no", header: "No", mobile: "meta", sort: (r) => r.proposal.proposal_no,
      cell: (r) => <span className="whitespace-nowrap font-mono text-xs">{r.proposal.proposal_no}</span>,
    },
    {
      key: "title", header: "Müşteri / Başlık", tone: "primary", mobile: "title", sort: (r) => r.client,
      cell: (r) => (
        <>
          <span className="block max-w-[22rem] truncate">{r.client}</span>
          <span className="block max-w-[22rem] truncate text-xs font-normal text-muted">{r.proposal.title}</span>
        </>
      ),
    },
    {
      key: "net", header: "Toplam (KDV hariç)", tone: "strong", sort: (r) => r.totals.subtotal,
      cell: (r) => (
        <span className="whitespace-nowrap">
          {formatMoney(r.totals.subtotal, r.proposal.currency)}
          {r.totals.recurring.subtotal > 0 && <span className="text-xs text-muted">{r.totals.mixed ? " ilk ay" : " / ay"}</span>}
        </span>
      ),
    },
    {
      key: "gross", header: "KDV dahil", sort: (r) => r.totals.total,
      cell: (r) => <span className="whitespace-nowrap">{formatMoney(r.totals.total, r.proposal.currency)}</span>,
    },
    {
      key: "status", header: "Durum", mobile: "badge",
      cell: (r) => (
        <StatusSelect
          value={r.proposal.status}
          options={statusOptions}
          label={`Durum: ${r.proposal.proposal_no}`}
          onChange={(status) => patchRecord("proposals", r.proposal.id, { status }, "Durum güncellenemedi")}
        />
      ),
    },
    {
      key: "valid", header: "Geçerlilik", sort: (r) => r.proposal.valid_until,
      cell: (r) => (
        <span className={r.expired ? "whitespace-nowrap text-warning" : "whitespace-nowrap"} title={r.expired ? "Geçerlilik tarihi geçti" : undefined}>
          {dateTR(r.proposal.valid_until)}
          {r.expired && <span className="sr-only"> (geçerlilik tarihi geçti)</span>}
        </span>
      ),
    },
  ], []);

  if (!hydrated) return <PageLoading title="Teklifler" />;

  const iconBtn = "flex h-10 w-10 items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface-2 hover:text-foreground disabled:opacity-40 md:h-8 md:w-8";

  return (
    <>
      <PageHeader
        title="Teklifler"
        subtitle="Kapsam → fiyat → markalı PDF. Paket seç, kalemleri düzenle, yazdır."
        action={
          <Button onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" aria-hidden /> Yeni Teklif
          </Button>
        }
      />

      <StatStrip
        items={[
          { label: "Açık teklif", value: String(stats.openCount), hint: "taslak + gönderildi" },
          { label: "Açık tutar (KDV hariç)", value: formatMoney(stats.openSum), tone: "amber" },
          { label: "Kabul edilen (KDV hariç)", value: formatMoney(stats.acceptedSum), tone: "success" },
          { label: "Kabul oranı", value: stats.rate === null ? "—" : `%${stats.rate}`, hint: "kabul / (kabul + ret)" },
        ]}
      />

      <Toolbar>
        <FilterChips
          label="Durum"
          value={filter}
          onChange={setFilter}
          options={FILTERS.map((id) => ({ id, label: id === "all" ? "Tümü" : proposalStatus[id].label, count: counts[id] }))}
        />
        <SearchBox value={query} onChange={setQuery} placeholder="No, başlık, müşteri ara…" label="Teklif ara" />
      </Toolbar>

      <DataTable
        columns={columns}
        rows={visible}
        rowKey={(r) => r.proposal.id}
        onOpen={(r) => router.push(`/teklifler/${r.proposal.id}`)}
        openLabel={(r) => `Düzenle: ${r.proposal.proposal_no} ${r.proposal.title}`}
        actions={(r) => (
          <RowActions
            label={`${r.proposal.proposal_no} ${r.proposal.title}`}
            onEdit={() => router.push(`/teklifler/${r.proposal.id}`)}
            onDelete={() => setToDelete(r.proposal)}
          >
            <button
              type="button"
              onClick={() => copy(r)}
              disabled={copying !== null}
              aria-label={`Kopyala: ${r.proposal.proposal_no}`}
              title="Kopyala"
              className={iconBtn}
            >
              <Copy className="h-4 w-4" aria-hidden />
            </button>
            <Link
              href={`/teklifler/${r.proposal.id}/yazdir`}
              prefetch={false}
              aria-label={`PDF / yazdır: ${r.proposal.proposal_no}`}
              title="PDF / yazdır"
              className={iconBtn}
            >
              <Printer className="h-4 w-4" aria-hidden />
            </Link>
          </RowActions>
        )}
        empty={
          <EmptyState
            title={query || filter !== "all" ? "Eşleşen teklif yok" : "Henüz teklif yok"}
            hint={query || filter !== "all" ? "Filtreyi veya aramayı değiştir." : "Bir paket seçerek dakikalar içinde ilk teklifini hazırla."}
            action={query || filter !== "all" ? undefined : { label: "Yeni Teklif", onClick: () => setCreating(true) }}
          />
        }
      />

      {creating && <NewProposalModal clients={clients} today={today} onClose={() => setCreating(false)} />}
      {toDelete && (
        <ConfirmDialog
          title="Teklif silinsin mi?"
          message={
            <>
              <p><strong className="text-foreground">{toDelete.proposal_no} · {toDelete.title}</strong> ve tüm kalemleri kalıcı olarak silinecek. Bu işlem geri alınamaz.</p>
              {toDelete.status !== "draft" && <p className="mt-2 text-warning">Bu teklif müşteriye gönderilmiş olabilir; kayıt için “Reddedildi” / “Süresi doldu” durumu da kullanılabilir.</p>}
            </>
          }
          onConfirm={confirmDelete}
          onCancel={() => setToDelete(null)}
        />
      )}
    </>
  );
}
