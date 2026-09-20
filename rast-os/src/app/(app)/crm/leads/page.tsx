"use client";

import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { PageHeader, EmptyState } from "@/components/ui";
import { Button } from "@/components/form";
import { DataTable, FilterChips, PageLoading, RowActions, SearchBox, StatusSelect, Toolbar, useListSearch, useNewIntent, usePersistentState } from "@/components/list";
import type { Column } from "@/components/list";
import LeadModal from "@/components/LeadModal";
import { useDeleteConfirm } from "@/components/confirm";
import { useStore, useHydrated } from "@/lib/store";
import { useToday } from "@/lib/useToday";
import { patchRecord } from "@/lib/mutate";
import { leadStatus, leadPipeline, TRY, dateTR } from "@/lib/labels";
import type { Lead } from "@/lib/types";

const statusOptions = leadPipeline.map((value) => ({ value, ...leadStatus[value] }));
type Scope = "all" | "open" | "won" | "lost";
const SCOPES: readonly Scope[] = ["all", "open", "won", "lost"];

export default function LeadsPage() {
  const hydrated = useHydrated(["leads"]);
  const leads = useStore((s) => s.leads);
  const today = useToday();

  const wantNew = useNewIntent();
  const [modal, setModal] = useState<{ initial: Lead | null } | null>(() => (wantNew ? { initial: null } : null));
  const [scope, setScope] = usePersistentState<Scope>("leads-scope", "all", SCOPES);
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

  const scoped = useMemo(() => {
    if (scope === "all") return leads;
    return leads.filter((l) => (scope === "open" ? l.status !== "won" && l.status !== "lost" : l.status === scope));
  }, [leads, scope]);
  const visible = useListSearch(scoped, query, (l) => `${l.company_name} ${l.contact_person ?? ""} ${l.source ?? ""} ${l.interested_in ?? ""} ${l.phone ?? ""}`);

  const columns = useMemo<Column<Lead>[]>(() => [
    {
      key: "company", header: "Firma", tone: "primary", mobile: "title", sort: (l) => l.company_name,
      cell: (l) => (
        <>
          <span className="block max-w-[20rem] truncate">{l.company_name}</span>
          {l.contact_person && <span className="block max-w-[20rem] truncate text-xs font-normal text-muted">{l.contact_person}</span>}
        </>
      ),
    },
    { key: "source", header: "Kaynak", sort: (l) => l.source, cell: (l) => l.source || "—" },
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
  ], [today]);

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

      {modal && <LeadModal initial={modal.initial} onClose={() => setModal(null)} />}
      {del.dialog}
    </>
  );
}
