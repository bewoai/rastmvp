"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { PageHeader, Badge, EmptyState } from "@/components/ui";
import { Select } from "@/components/form";
import { DataTable, FilterChips, PageLoading, SearchBox, Toolbar, useListSearch } from "@/components/list";
import type { Column } from "@/components/list";
import { useStore, useHydrated } from "@/lib/store";
import {
  activityAction, activityEntity, activityEntityLabel, activityField, activityHref, activityRecord, activityValue, dateTimeTR,
} from "@/lib/labels";
import type { ActivityAction, ActivityLog } from "@/lib/types";

type ActionFilter = "all" | ActivityAction;
const ACTIONS: ActivityAction[] = ["insert", "update", "delete"];

/** Değişiklik özeti: güncellemede "alan: eski → yeni" (en fazla 3), ekleme/silmede alan adları. */
function Changes({ log }: { log: ActivityLog }) {
  const entries = Object.entries(log.diff ?? {});
  if (!entries.length) return <span>—</span>;
  if (log.action !== "update") {
    const names = entries.map(([k]) => activityField[k] ?? k);
    return <span className="block max-w-[22rem] truncate" title={names.join(", ")}>{names.join(", ")}</span>;
  }
  const shown = entries.slice(0, 3);
  return (
    <span className="block max-w-[22rem] space-y-0.5">
      {shown.map(([k, v]) => (
        <span key={k} className="block truncate">
          <span className="text-foreground/80">{activityField[k] ?? k}:</span>{" "}
          {activityValue(log.entity, k, v?.old)} → {activityValue(log.entity, k, v?.new)}
        </span>
      ))}
      {entries.length > shown.length && <span className="block text-muted/80">+{entries.length - shown.length} alan daha</span>}
    </span>
  );
}

export default function ActivityHistoryPage() {
  const hydrated = useHydrated(["activity_logs"]);
  const logs = useStore((s) => s.activity_logs);
  const [action, setAction] = useState<ActionFilter>("all");
  const [entity, setEntity] = useState("all");
  const [query, setQuery] = useState("");

  // Modül listesi: bilinen tablolar + loglarda geçen diğerleri
  const entities = useMemo(() => {
    const set = new Set([...Object.keys(activityEntity), ...logs.map((l) => l.entity)]);
    return [...set].sort((a, b) => activityEntityLabel(a).localeCompare(activityEntityLabel(b), "tr-TR"));
  }, [logs]);

  const byEntity = useMemo(
    () => [...logs]
      .filter((l) => entity === "all" || l.entity === entity)
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))),
    [logs, entity],
  );
  const filtered = useMemo(() => (action === "all" ? byEntity : byEntity.filter((l) => l.action === action)), [byEntity, action]);
  const visible = useListSearch(filtered, query, (l) => `${l.actor_name ?? ""} ${activityRecord(l)} ${activityEntityLabel(l.entity)}`);

  const counts = useMemo(() => {
    const c: Record<ActionFilter, number> = { all: byEntity.length, insert: 0, update: 0, delete: 0 };
    for (const l of byEntity) if (l.action in c) c[l.action] += 1;
    return c;
  }, [byEntity]);

  const columns = useMemo<Column<ActivityLog>[]>(() => [
    {
      key: "record", header: "Kayıt", tone: "primary", mobile: "title", sort: (l) => activityRecord(l),
      cell: (l) => {
        const href = activityHref(l);
        const record = activityRecord(l);
        return (
          <>
            {href ? (
              <Link prefetch={false} href={href} className="block max-w-[18rem] truncate rounded outline-none hover:text-amber focus-visible:ring-2 focus-visible:ring-amber/60">{record}</Link>
            ) : (
              <span className="block max-w-[18rem] truncate">{record}</span>
            )}
            <span className="block text-xs font-normal text-muted">{activityEntityLabel(l.entity)}</span>
          </>
        );
      },
    },
    {
      key: "action", header: "İşlem", mobile: "badge", sort: (l) => activityAction[l.action]?.label,
      cell: (l) => {
        const a = activityAction[l.action] ?? activityAction.update;
        return <Badge tone={a.tone}>{a.label}</Badge>;
      },
    },
    { key: "actor", header: "Kim", tone: "strong", sort: (l) => l.actor_name ?? "", cell: (l) => l.actor_name || "Sistem" },
    { key: "changes", header: "Değişiklik", cell: (l) => <Changes log={l} /> },
    { key: "at", header: "Zaman", sort: (l) => l.created_at, className: "whitespace-nowrap", cell: (l) => dateTimeTR(l.created_at) },
  ], []);

  if (!hydrated) return <PageLoading title="İşlem Geçmişi" />;

  return (
    <>
      <PageHeader
        title="İşlem Geçmişi"
        subtitle="Müşteri, proje, iş, görev, fatura, tahsilat, gider ve tekliflerde yapılan ekleme / güncelleme / silmeler. Kayıtları veritabanı otomatik tutar; buradan değiştirilemez."
        action={
          <Link prefetch={false} href="/settings" className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm text-muted outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-amber/60">
            <ArrowLeft className="h-4 w-4" aria-hidden /> Ayarlar
          </Link>
        }
      />

      <Toolbar>
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          <FilterChips
            label="İşlem türü"
            value={action}
            onChange={setAction}
            options={[
              { id: "all", label: "Tümü", count: counts.all },
              ...ACTIONS.map((a) => ({ id: a, label: activityAction[a].label, count: counts[a] })),
            ]}
          />
          <Select value={entity} onChange={(e) => setEntity(e.target.value)} aria-label="Modül" className="sm:w-48">
            <option value="all">Tüm modüller</option>
            {entities.map((e) => <option key={e} value={e}>{activityEntityLabel(e)}</option>)}
          </Select>
        </div>
        <SearchBox value={query} onChange={setQuery} placeholder="Kişi, kayıt ara…" label="İşlem geçmişinde ara" />
      </Toolbar>

      <DataTable
        columns={columns}
        rows={visible}
        rowKey={(l) => l.id}
        empty={
          <EmptyState
            title={logs.length ? "Eşleşen işlem yok" : "Henüz işlem yok"}
            hint={logs.length ? "Filtreleri veya aramayı değiştir." : "Kayıt eklendikçe, güncellendikçe ve silindikçe burada listelenir (veritabanında 0012 migration'ı gerekir)."}
          />
        }
      />
      {logs.length >= 500 && <p className="mt-3 text-xs text-muted">En yeni 500 işlem gösteriliyor.</p>}
    </>
  );
}
