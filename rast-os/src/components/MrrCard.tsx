import Link from "next/link";
import { ArrowRight, Target } from "lucide-react";
import { Panel, EmptyState } from "@/components/ui";
import { TRY } from "@/lib/labels";
import { mrrProgress, type MrrResult } from "@/lib/mrr";

const SETTINGS_HREF = "/settings#mrr-esigi";

/** Dashboard: aylık tekrarlayan gelir (MRR, KDV hariç) ve "eşik" hedefine ilerleme. */
export default function MrrCard({
  result, target, label, loaded,
}: {
  result: MrrResult;
  target: number | null;
  label: string;
  /** Hedef ayarı yüklendi mi (Supabase'de ilk açılışta kısa süre false). */
  loaded: boolean;
}) {
  const p = mrrProgress(result.mrr, target);
  const top = result.byClient.slice(0, 5);
  const rest = result.byClient.length - top.length;

  const action = (
    <Link prefetch={false} href={SETTINGS_HREF} className="flex items-center gap-1 text-xs text-muted transition-colors hover:text-amber">
      {p.hasTarget ? "Eşiği düzenle" : "Eşik belirle"} <ArrowRight className="h-3.5 w-3.5" aria-hidden />
    </Link>
  );

  return (
    <Panel title="Aylık tekrarlayan gelir (MRR) ve eşik" action={loaded ? action : undefined}>
      <div className="grid gap-5 lg:grid-cols-[1.2fr_.8fr] lg:gap-8">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted">MRR · KDV hariç</p>
          <p className="mt-2 text-3xl font-semibold tracking-[-0.035em] text-foreground">{TRY(result.mrr)}</p>

          {!loaded ? (
            <div aria-hidden className="mt-5 h-16 animate-pulse rounded-lg bg-white/[0.04]" />
          ) : p.hasTarget ? (
            <div className="mt-5">
              <div className="mb-2 flex items-baseline justify-between gap-3 text-xs">
                <span className="flex min-w-0 items-center gap-1.5 text-muted"><Target className="h-3.5 w-3.5 shrink-0" aria-hidden /><span className="truncate">{label}</span></span>
                <span className="shrink-0 text-foreground">{TRY(p.target)}</span>
              </div>
              <div
                role="progressbar"
                aria-label={`${label}: yüzde ${p.pct}`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={p.pct}
                className="h-2 overflow-hidden rounded-full bg-white/[0.06]"
              >
                <div className={`h-full rounded-full ${p.reached ? "bg-success" : "bg-amber"}`} style={{ width: `${Math.max(p.pct, p.pct > 0 ? 2 : 0)}%` }} />
              </div>
              <div className="mt-2 flex items-center justify-between gap-3 text-xs">
                <span className="tabular-nums text-muted">%{String(p.pct).replace(".", ",")}</span>
                {p.reached ? (
                  <span className="font-medium text-success">Eşik aşıldı · +{TRY(p.surplus)}</span>
                ) : (
                  <span className="text-muted">Fark: <span className="font-medium text-foreground">{TRY(p.remaining)}</span> kaldı</span>
                )}
              </div>
            </div>
          ) : (
            <div className="mt-5 rounded-lg border border-dashed border-border bg-surface-2/40 p-3">
              <p className="text-sm text-muted">Henüz bir eşik belirlenmemiş. Hastaneden ayrılmak için gereken aylık tekrarlayan geliri girerek ilerlemeyi buradan izle.</p>
              <Link prefetch={false} href={SETTINGS_HREF} className="btn-amber mt-3 inline-flex min-h-10 items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-medium transition-all">
                Eşik belirle <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
            </div>
          )}
        </div>

        <div>
          <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted">Müşteri bazında</p>
          {top.length ? (
            <ul className="mt-2 space-y-1.5">
              {top.map((r) => (
                <li key={`${r.clientId ?? r.client}-${r.source}`} className="flex items-center justify-between gap-3 text-sm">
                  <span className="min-w-0 truncate text-foreground">
                    {r.client}
                    {r.source === "invoice" && <span className="ml-1.5 text-[11px] text-muted" title="Kabul edilmiş teklif yok; son 30 gündeki düzenli faturadan">fatura</span>}
                  </span>
                  <span className="shrink-0 tabular-nums text-muted">{TRY(r.amount)}</span>
                </li>
              ))}
              {rest > 0 && <li className="text-xs text-muted">+{rest} müşteri daha</li>}
            </ul>
          ) : (
            <EmptyState title="Tekrarlayan gelir yok" hint="Aylık kalemli bir teklifi “kabul edildi” yapınca burada görünür." />
          )}
        </div>
      </div>
    </Panel>
  );
}
