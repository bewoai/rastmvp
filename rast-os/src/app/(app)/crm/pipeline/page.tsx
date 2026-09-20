"use client";

import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/ui";
import { Button } from "@/components/form";
import { PageLoading } from "@/components/list";
import LeadModal from "@/components/LeadModal";
import { useStore, useHydrated } from "@/lib/store";
import { useToday } from "@/lib/useToday";
import { patchRecord } from "@/lib/mutate";
import { leadStatus, leadPipeline, TRY, dateTR } from "@/lib/labels";
import type { Lead, LeadStatus } from "@/lib/types";

export default function PipelinePage() {
  const hydrated = useHydrated(["leads"]);
  const leads = useStore((s) => s.leads);
  const today = useToday();
  const [modal, setModal] = useState<{ initial: Lead | null } | null>(null);

  const columnsData = useMemo(() => {
    const cols: Record<string, Lead[]> = {};
    const totals: Record<string, number> = {};
    for (const col of leadPipeline) {
      cols[col] = [];
      totals[col] = 0;
    }
    if (hydrated) {
      for (const l of leads) {
        if (cols[l.status]) {
          cols[l.status].push(l);
          totals[l.status] += l.est_budget ?? 0;
        }
      }
    }
    return { cols, totals };
  }, [leads, hydrated]);

  if (!hydrated) return <PageLoading title="Satış Pipeline" />;

  return (
    <>
      <PageHeader
        title="Satış Pipeline"
        subtitle="Lead'leri sürece göre takip edin — karta tıklayıp düzenleyin, aşamayı listeden değiştirin"
        action={
          <Button onClick={() => setModal({ initial: null })}>
            <Plus className="h-4 w-4" aria-hidden /> Yeni Lead
          </Button>
        }
      />

      <div className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-4 md:mx-0 md:px-0">
        {leadPipeline.map((col) => {
          const items = columnsData.cols[col] || [];
          const total = columnsData.totals[col] || 0;
          return (
            <section key={col} aria-label={leadStatus[col].label} className="flex w-[78vw] max-w-72 shrink-0 snap-start flex-col md:w-64">
              <div className="mb-2 flex items-baseline justify-between gap-2 px-1">
                <h2 className="truncate text-xs font-semibold text-foreground">
                  {leadStatus[col].label} <span className="font-normal text-muted">{items.length}</span>
                </h2>
                {total > 0 && <span className="shrink-0 text-[11px] text-muted">{TRY(total)}</span>}
              </div>
              <div className="flex-1 space-y-2 rounded-lg bg-surface/40 p-2">
                {items.map((l) => {
                  const due = l.next_followup_at?.slice(0, 10);
                  const overdue = Boolean(due) && due! < today && col !== "won" && col !== "lost";
                  return (
                    <div key={l.id} className="card p-3">
                      <button
                        type="button"
                        onClick={() => setModal({ initial: l })}
                        aria-label={`Düzenle: ${l.company_name}`}
                        className="block w-full rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-amber/60"
                      >
                        <span className="block truncate text-sm font-medium text-foreground">{l.company_name}</span>
                        {l.contact_person && <span className="mt-0.5 block truncate text-xs text-muted">{l.contact_person}</span>}
                        {l.est_budget ? <span className="mt-1 block text-xs text-amber">{TRY(l.est_budget)}</span> : null}
                        {due && <span className={`mt-1 block text-xs ${overdue ? "text-danger" : "text-muted"}`}>Takip: {dateTR(l.next_followup_at)}{overdue ? " · gecikti" : ""}</span>}
                      </button>
                      <select
                        aria-label={`Aşama: ${l.company_name}`}
                        value={l.status}
                        onChange={(e) => patchRecord("leads", l.id, { status: e.target.value as LeadStatus }, "Aşama güncellenemedi")}
                        className="mt-2 h-9 w-full rounded-md border border-border bg-background px-2 text-base text-muted outline-none focus:border-amber/60 md:h-8 md:text-xs"
                      >
                        {leadPipeline.map((s) => (
                          <option key={s} value={s}>{leadStatus[s].label}</option>
                        ))}
                      </select>
                    </div>
                  );
                })}
                {items.length === 0 && <p className="px-1 py-4 text-center text-xs text-muted">—</p>}
              </div>
            </section>
          );
        })}
      </div>

      {modal && <LeadModal initial={modal.initial} onClose={() => setModal(null)} />}
    </>
  );
}
