"use client";

import { Suspense, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { PageHeader, EmptyState, Badge } from "@/components/ui";
import { Button } from "@/components/form";
import { DataTable, FilterChips, PageLoading, RowActions, SearchBox, StatusSelect, Toolbar, useListSearch, useNewIntent, useOpenIntent, usePersistentState } from "@/components/list";
import type { Column } from "@/components/list";
import LeadModal from "@/components/LeadModal";
import { useDeleteConfirm } from "@/components/confirm";
import { useStore, useHydrated } from "@/lib/store";
import { useToday } from "@/lib/useToday";
import { useNowMs } from "@/lib/useNowMs";
import { leadSourceKind, leadSourceKinds, leadsNeedingFirstCall } from "@/lib/lead-logic";
import type { LeadSourceKind } from "@/lib/lead-logic";
import { patchRecord } from "@/lib/mutate";
import { leadStatus, leadPipeline, TRY, dateTR } from "@/lib/labels";
import type { Lead } from "@/lib/types";

const statusOptions = leadPipeline.map((value) => ({ value, ...leadStatus[value] }));
type Scope = "all" | "open" | "won" | "lost";
const SCOPES: readonly Scope[] = ["all", "open", "won", "lost"];
type KindFilter = "all" | LeadSourceKind;
const KIND_FILTERS: readonly KindFilter[] = ["all", "hekim", "site", "manuel"];

// `?ac=<id>` (Ctrl/⌘K kayıt araması, bildirim zili) için useSearchParams → statik sayfada Suspense sınırı gerekir.
export default function LeadsPage() {
  return (
    <Suspense fallback={<PageLoading title="Potansiyel Müşteriler" />}>
      <LeadsList />
    </Suspense>
  );
}

function LeadsList() {
  const hydrated = useHydrated(["leads", "tasks"]);
  const leads = useStore((s) => s.leads);
  const tasks = useStore((s) => s.tasks);
  const today = useToday();
  const nowMs = useNowMs();

  const wantNew = useNewIntent();
  const [modal, setModal] = useState<{ initial: Lead | null } | null>(() => (wantNew ? { initial: null } : null));
  // `?ac=<id>`: kayıt araması / bildirimden gelinince düzenleme penceresi açılır.
  const intent = useOpenIntent(leads);
  const shown = modal ?? (intent.target ? { initial: intent.target } : null);
  function closeModal() {
    setModal(null);
    intent.dismiss();
  }
  const [scope, setScope] = usePersistentState<Scope>("leads-scope", "all", SCOPES);
  const [kind, setKind] = usePersistentState<KindFilter>("leads-kind", "all", KIND_FILTERS);
  const [query, setQuery] = useState("");
  const del = useDeleteConfirm();

  const counts = useMemo(() => {
    let won = 0, lost = 0;
    for (const l of leads) {
      if (l.status === "won") won++;
      else if (l.status === "lost") lost++;
    }
    return { all: leads.length, won, lost, open: leads.length - won - lost };
  }, [leads]);

  // Rozet: son 48 saatte açılmış, tamamlanmış "Lead'i ara" görevi olmayan açık lead'ler.
  const uncalled = useMemo(() => leadsNeedingFirstCall(leads, tasks, nowMs), [leads, tasks, nowMs]);

  const kindCounts = useMemo(() => {
    const c: Record<KindFilter, number> = { all: leads.length, hekim: 0, site: 0, manuel: 0 };
    for (const l of leads) c[leadSourceKind(l)]++;
    return c;
  }, [leads]);

  const scoped = useMemo(() => {
    const byScope = scope === "all" ? leads : leads.filter((l) => (scope === "open" ? l.status !== "won" && l.status !== "lost" : l.status === scope));
    return kind === "all" ? byScope : byScope.filter((l) => leadSourceKind(l) === kind);
  }, [leads, scope, kind]);
  const visible = useListSearch(scoped, query, (l) => `${l.company_name} ${l.contact_person ?? ""} ${l.source ?? ""} ${l.source_package ?? ""} ${l.interested_in ?? ""} ${l.phone ?? ""}`);

  const columns = useMemo<Column<Lead>[]>(() => [
    {
      key: "company", header: "Firma", tone: "primary", mobile: "title", sort: (l) => l.company_name,
      cell: (l) => (
        <>
          <span className="block max-w-[20rem] truncate">{l.company_name}</span>
          {l.contact_person && <span className="block max-w-[20rem] truncate text-xs font-normal text-muted">{l.contact_person}</span>}
          {uncalled.has(l.id) && (
            <span className="mt-1 block font-normal" title="Son 48 saatte geldi, henüz arama görevi tamamlanmadı">
              <Badge tone="danger">Aranmadı · yeni</Badge>
            </span>
          )}
        </>
      ),
    },
    {
      key: "source", header: "Kaynak", sort: (l) => leadSourceKind(l),
      cell: (l) => {
        const k = leadSourceKinds[leadSourceKind(l)];
        return (
          <>
            <Badge tone={k.tone}>{k.label}</Badge>
            {(l.source || l.source_package) && (
              <span className="mt-0.5 block max-w-[14rem] truncate text-xs font-normal text-muted">
                {[l.source, l.source_package].filter(Boolean).join(" · ")}
              </span>
            )}
          </>
        );
      },
    },
    { key: "interest", header: "İlgilendiği", mobile: "hide", sort: (l) => l.interested_in, cell: (l) => <span className="block max-w-[16rem] truncate">{l.interested_in || "—"}</span> },
    { key: "budget", header: "Bütçe", tone: "strong", sort: (l) => l.est_budget, cell: (l) => (l.est_budget ? TRY(l.est_budget) : "—") },
    {
      key: "status", header: "Durum", mobile: "badge", sort: (l) => leadPipeline.indexOf(l.status),
      cell: (l) => (
        <StatusSelect value={l.status} options={statusOptions} label={`Durum: ${l.company_name}`} onChange={(status) => patchRecord("leads", l.id, { status }, "Durum güncellenemedi")} />
      ),
    },
    {
      key: "followup", header: "Takip", sort: (l) => l.next_followup_at,
      cell: (l) => {
        const due = l.next_followup_at?.slice(0, 10);
        const overdue = Boolean(due) && due! < today && l.status !== "won" && l.status !== "lost";
        return <span className={overdue ? "text-danger" : undefined}>{dateTR(l.next_followup_at)}{overdue ? " · gecikti" : ""}</span>;
      },
    },
  ], [today, uncalled]);

  if (!hydrated) return <PageLoading title="Potansiyel Müşteriler" />;

  return (
    <>
      <PageHeader
        title="Potansiyel Müşteriler"
        subtitle="Henüz müşteriye dönüşmemiş firma ve kişiler"
        action={
          <Button onClick={() => setModal({ initial: null })}>
            <Plus className="h-4 w-4" aria-hidden /> Yeni Lead
          </Button>
        }
      />

      <Toolbar>
        <FilterChips
          label="Lead durumu"
          value={scope}
          onChange={setScope}
          options={[
            { id: "all", label: "Tümü", count: counts.all },
            { id: "open", label: "Açık", count: counts.open },
            { id: "won", label: "Kazanıldı", count: counts.won },
            { id: "lost", label: "Kaybedildi", count: counts.lost },
          ]}
        />
        <FilterChips
          label="Lead kaynağı"
          value={kind}
          onChange={setKind}
          options={[
            { id: "all", label: "Tüm kaynaklar", count: kindCounts.all },
            { id: "hekim", label: "Hekim", count: kindCounts.hekim },
            { id: "site", label: "Site", count: kindCounts.site },
            { id: "manuel", label: "Manuel", count: kindCounts.manuel },
          ]}
        />
        <SearchBox value={query} onChange={setQuery} placeholder="Firma, kişi, kaynak ara…" label="Lead ara" />
      </Toolbar>

      <DataTable
        columns={columns}
        rows={visible}
        rowKey={(l) => l.id}
        onOpen={(l) => setModal({ initial: l })}
        openLabel={(l) => `Düzenle: ${l.company_name}`}
        actions={(l) => (
          <RowActions label={l.company_name} onEdit={() => setModal({ initial: l })} onDelete={() => del.ask({ key: "leads", id: l.id, label: l.company_name })} />
        )}
        empty={
          leads.length === 0 ? (
            <EmptyState title="Henüz lead yok" hint="Potansiyel müşterileri ekleyip satış sürecini takip et." action={{ label: "Yeni Lead", onClick: () => setModal({ initial: null }) }} />
          ) : (
            <EmptyState title="Eşleşen lead yok" hint={query ? "Aramayı değiştir." : "Bu durumda lead bulunmuyor."} />
          )
        }
      />

      {shown && <LeadModal initial={shown.initial} onClose={closeModal} />}
      {del.dialog}
    </>
  );
}
