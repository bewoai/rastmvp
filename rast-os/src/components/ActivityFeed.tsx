"use client";

import Link from "next/link";
import { Badge, EmptyState } from "@/components/ui";
import { activityAction, activityEntityLabel, activityFields, activityHref, activityRecord, dateTimeTR } from "@/lib/labels";
import type { ActivityLog } from "@/lib/types";

/** Dashboard "Son işlemler": kim, ne yaptı, hangi kayıt, ne zaman. Loglar en yeni önce gelir. */
export default function ActivityFeed({ logs, limit = 15 }: { logs: ActivityLog[]; limit?: number }) {
  const items = [...logs]
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    .slice(0, limit);

  if (!items.length) {
    return <EmptyState title="Henüz işlem yok" hint="Kayıt ekleme, güncelleme ve silmeler burada listelenir." />;
  }

  return (
    <ul className="divide-y divide-border/50">
      {items.map((log) => {
        const action = activityAction[log.action] ?? activityAction.update;
        const fields = log.action === "update" ? activityFields(log) : [];
        const href = activityHref(log);
        const record = activityRecord(log);
        return (
          <li key={log.id} className="flex items-start justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
            <div className="min-w-0">
              <p className="text-sm text-foreground">
                <span className="font-medium">{log.actor_name || "Sistem"}</span>{" "}
                <span className="text-muted">{activityEntityLabel(log.entity).toLocaleLowerCase("tr-TR")} {action.verb}:</span>{" "}
                {href ? (
                  <Link prefetch={false} href={href} className="rounded outline-none hover:text-accent focus-visible:ring-2 focus-visible:ring-accent/60">
                    {record}
                  </Link>
                ) : (
                  <span>{record}</span>
                )}
              </p>
              {fields.length > 0 && <p className="mt-0.5 truncate text-xs text-muted">Değişen: {fields.join(", ")}</p>}
            </div>
            <div className="shrink-0 text-right">
              <Badge tone={action.tone}>{action.label}</Badge>
              <p className="mt-1 whitespace-nowrap text-xs text-muted">{dateTimeTR(log.created_at)}</p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
