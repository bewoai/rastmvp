"use client";

import { PageHeader } from "@/components/ui";
import { useStore, useHydrated } from "@/lib/store";
import { leadStatus, leadPipeline, TRY } from "@/lib/labels";
import type { LeadStatus } from "@/lib/types";

export default function PipelinePage() {
  const hydrated = useHydrated();
  const leads = useStore((s) => s.leads);
  const update = useStore((s) => s.update);

  const columns = leadPipeline;

  return (
    <>
      <PageHeader
        title="Satış Pipeline"
        subtitle="Lead'leri sürece göre takip edin — kartların durumunu değiştirin"
      />

      <div className="flex gap-3 overflow-x-auto pb-4">
        {columns.map((col) => {
          const items = hydrated ? leads.filter((l) => l.status === col) : [];
          const total = items.reduce((s, l) => s + (l.est_budget ?? 0), 0);
          return (
            <div key={col} className="flex w-64 shrink-0 flex-col">
              <div className="mb-2 flex items-center justify-between px-1">
                <span className="text-xs font-semibold text-foreground">
                  {leadStatus[col].label}
                </span>
                <span className="text-xs text-muted">{items.length}</span>
              </div>
              <div className="flex-1 space-y-2 rounded-lg bg-surface/40 p-2">
                {items.map((l) => (
                  <div key={l.id} className="card p-3">
                    <p className="text-sm font-medium text-foreground">{l.company_name}</p>
                    {l.contact_person && (
                      <p className="mt-0.5 text-xs text-muted">{l.contact_person}</p>
                    )}
                    {l.est_budget ? (
                      <p className="mt-1 text-xs text-amber">{TRY(l.est_budget)}</p>
                    ) : null}
                    <select
                      value={l.status}
                      onChange={(e) =>
                        update("leads", l.id, { status: e.target.value as LeadStatus })
                      }
                      className="mt-2 w-full rounded-md border border-border bg-background px-2 py-1 text-xs text-muted outline-none focus:border-amber/60"
                    >
                      {leadPipeline.map((s) => (
                        <option key={s} value={s}>{leadStatus[s].label}</option>
                      ))}
                    </select>
                  </div>
                ))}
                {items.length === 0 && (
                  <p className="px-1 py-4 text-center text-xs text-muted">—</p>
                )}
                {total > 0 && (
                  <p className="px-1 pt-1 text-[11px] text-muted">Toplam: {TRY(total)}</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
