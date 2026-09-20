"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  CircleDollarSign,
  Eye,
  Gauge,
  MousePointerClick,
  RefreshCw,
  Target,
} from "lucide-react";
import { Badge, EmptyState, PageHeader, StatCard } from "@/components/ui";
import type { AdAccount, AdsConnectionStatus, AdsInsight, AdsPlatform } from "@/lib/ads/types";

type AccountsResponse = {
  status: AdsConnectionStatus[];
  accounts: AdAccount[];
  errors: Record<AdsPlatform, string | null>;
};

const platformNames: Record<AdsPlatform, string> = {
  google: "Google Ads",
  meta: "Meta Ads",
};

function inputDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function initialRange() {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 29);
  return { from: inputDate(from), to: inputDate(to) };
}

function formatMoney(value: number, currency = "TRY") {
  return new Intl.NumberFormat("tr-TR", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(value || 0);
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 }).format(value || 0);
}

function formatPercent(value: number) {
  return `%${new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 2 }).format(value || 0)}`;
}

function friendlyObjective(value?: string) {
  if (!value) return "—";
  return value.replaceAll("_", " ").toLocaleLowerCase("tr-TR").replace(/^./, (letter) => letter.toLocaleUpperCase("tr-TR"));
}

function statusTone(status: string): "success" | "warning" | "muted" {
  if (status === "Aktif") return "success";
  if (status === "Durduruldu") return "warning";
  return "muted";
}

export default function AdsPage() {
  const [accountsData, setAccountsData] = useState<AccountsResponse | null>(null);
  const [platform, setPlatform] = useState<AdsPlatform>("google");
  const [accountId, setAccountId] = useState("");
  const [from, setFrom] = useState(() => initialRange().from);
  const [to, setTo] = useState(() => initialRange().to);
  const [insight, setInsight] = useState<AdsInsight | null>(null);
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [reportLoading, setReportLoading] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const [reportError, setReportError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const loadAccounts = useCallback(async () => {
    setAccountsLoading(true);
    setPageError(null);
    try {
      const response = await fetch("/api/ads/accounts", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Reklam hesapları alınamadı.");
      setAccountsData(payload);
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "Reklam hesapları alınamadı.");
    } finally {
      setAccountsLoading(false);
    }
  }, []);

  useEffect(() => {
    // Initial account discovery is the external synchronization performed by this effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadAccounts();
  }, [loadAccounts]);

  const platformAccounts = useMemo(
    () => accountsData?.accounts.filter((account) => account.platform === platform) ?? [],
    [accountsData, platform],
  );

  const effectiveAccountId = platformAccounts.some((account) => account.id === accountId)
    ? accountId
    : platformAccounts[0]?.id || "";

  useEffect(() => {
    if (!effectiveAccountId || !from || !to || from > to) return;
    const controller = new AbortController();
    async function loadReport() {
      setReportLoading(true);
      setReportError(null);
      try {
        const params = new URLSearchParams({ platform, accountId: effectiveAccountId, from, to });
        const response = await fetch(`/api/ads/insights?${params}`, { cache: "no-store", signal: controller.signal });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Reklam raporu alınamadı.");
        setInsight(payload);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setInsight(null);
        setReportError(error instanceof Error ? error.message : "Reklam raporu alınamadı.");
      } finally {
        if (!controller.signal.aborted) setReportLoading(false);
      }
    }
    void loadReport();
    return () => controller.abort();
  }, [effectiveAccountId, from, platform, refreshKey, to]);

  const selectedAccount = platformAccounts.find((account) => account.id === effectiveAccountId);
  const currency = selectedAccount?.currency || "TRY";
  const currentStatus = accountsData?.status.find((item) => item.platform === platform);
  const currentInsight = insight?.platform === platform && insight.accountId === effectiveAccountId ? insight : null;
  const maxSpend = Math.max(...(currentInsight?.campaigns.map((campaign) => campaign.spend) ?? [0]), 1);

  function applyPreset(days: number | "month") {
    const end = new Date();
    const start = new Date();
    if (days === "month") start.setDate(1);
    else start.setDate(start.getDate() - (days - 1));
    setFrom(inputDate(start));
    setTo(inputDate(end));
  }

  return (
    <>
      <PageHeader
        title="Reklam Merkezi"
        subtitle="Google Ads ve Meta Ads performansı"
        action={
          <button
            type="button"
            onClick={() => { void loadAccounts(); setRefreshKey((value) => value + 1); }}
            disabled={accountsLoading || reportLoading}
            className="btn-amber inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${accountsLoading || reportLoading ? "animate-spin" : ""}`} />
            Yenile
          </button>
        }
      />

      {pageError && (
        <div role="alert" className="mb-4 flex items-center gap-3 rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden /> <span className="min-w-0 break-words">{pageError}</span>
        </div>
      )}

      <div className="mb-4 grid gap-3 md:grid-cols-2">
        {(["google", "meta"] as AdsPlatform[]).map((item) => {
          const status = accountsData?.status.find((entry) => entry.platform === item);
          const count = accountsData?.accounts.filter((account) => account.platform === item).length ?? 0;
          const error = accountsData?.errors[item];
          const active = platform === item;
          return (
            <button
              type="button"
              key={item}
              onClick={() => { setPlatform(item); setAccountId(""); setReportError(null); }}
              className={`card card-hover flex items-center justify-between gap-4 p-4 text-left outline-none focus-visible:ring-2 focus-visible:ring-amber/70 ${active ? "border-amber/50 bg-amber/[0.055]" : ""}`}
            >
              <span className="flex min-w-0 items-center gap-3">
                <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl text-sm font-semibold ${item === "google" ? "bg-[#4285f4]/15 text-[#8ab4f8]" : "bg-[#1877f2]/15 text-[#70a7ff]"}`}>
                  {item === "google" ? "G" : "M"}
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-foreground">{platformNames[item]}</span>
                  <span className="mt-0.5 block truncate text-xs text-muted">
                    {accountsLoading ? "Kontrol ediliyor…" : error || (status?.configured ? `${count} hesap bağlı` : "Bağlantı ayarları bekleniyor")}
                  </span>
                </span>
              </span>
              {status?.configured && !error ? <CheckCircle2 className="h-5 w-5 shrink-0 text-success" /> : <AlertTriangle className="h-5 w-5 shrink-0 text-warning" />}
            </button>
          );
        })}
      </div>

      <section className="card mb-4 p-4">
        <div className="grid gap-4 xl:grid-cols-[minmax(230px,1fr)_auto_auto] xl:items-end">
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-muted">Reklam hesabı</span>
            <select
              value={effectiveAccountId}
              onChange={(event) => setAccountId(event.target.value)}
              disabled={!platformAccounts.length}
              className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-amber/60 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {!platformAccounts.length && <option value="">Bağlı hesap bulunamadı</option>}
              {platformAccounts.map((account) => <option key={account.id} value={account.id}>{account.name} · {account.currency}</option>)}
            </select>
          </label>

          <div>
            <span className="mb-1.5 block text-xs font-medium text-muted">Hızlı tarih</span>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => applyPreset(7)} className="rounded-lg bg-surface-2 px-3 py-2 text-xs text-muted transition-colors hover:text-foreground">7 gün</button>
              <button type="button" onClick={() => applyPreset(30)} className="rounded-lg bg-surface-2 px-3 py-2 text-xs text-muted transition-colors hover:text-foreground">30 gün</button>
              <button type="button" onClick={() => applyPreset("month")} className="rounded-lg bg-surface-2 px-3 py-2 text-xs text-muted transition-colors hover:text-foreground">Bu ay</button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <label>
              <span className="mb-1.5 block text-xs font-medium text-muted">Başlangıç</span>
              <input type="date" value={from} max={to} onChange={(event) => setFrom(event.target.value)} className="h-10 rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-amber/60" />
            </label>
            <label>
              <span className="mb-1.5 block text-xs font-medium text-muted">Bitiş</span>
              <input type="date" value={to} min={from} onChange={(event) => setTo(event.target.value)} className="h-10 rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-amber/60" />
            </label>
          </div>
        </div>
      </section>

      {!accountsLoading && !currentStatus?.configured ? (
        <div className="card px-5 py-12">
          <EmptyState title={`${platformNames[platform]} bağlantısı bekleniyor`} hint="Bağlantı bilgileri güvenli şekilde tanımlandığında hesaplar ve raporlar burada otomatik görünecek." />
        </div>
      ) : !accountsLoading && currentStatus?.configured && !platformAccounts.length ? (
        <div className="card px-5 py-12">
          <EmptyState title="Kullanılabilir reklam hesabı bulunamadı" hint={accountsData?.errors[platform] || "Bu bağlantının erişebildiği aktif bir reklam hesabı yok."} />
        </div>
      ) : reportError ? (
        <div className="card px-5 py-12">
          <EmptyState title="Rapor alınamadı" hint={reportError} />
        </div>
      ) : effectiveAccountId ? (
        <div className={reportLoading ? "opacity-60 transition-opacity" : "transition-opacity"} aria-busy={reportLoading}>
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-3 2xl:grid-cols-6">
            <StatCard label="Harcama" value={formatMoney(currentInsight?.totals.spend ?? 0, currency)} icon={CircleDollarSign} tone="amber" />
            <StatCard label="Gösterim" value={formatNumber(currentInsight?.totals.impressions ?? 0)} icon={Eye} />
            <StatCard label="Tıklama" value={formatNumber(currentInsight?.totals.clicks ?? 0)} icon={MousePointerClick} />
            <StatCard label="Tıklama oranı" value={formatPercent(currentInsight?.totals.ctr ?? 0)} icon={Gauge} />
            <StatCard label="Sonuç" value={formatNumber(currentInsight?.totals.results ?? 0)} icon={Target} tone="success" />
            <StatCard label="ROAS" value={`${(currentInsight?.totals.roas ?? 0).toLocaleString("tr-TR", { maximumFractionDigits: 2 })}x`} icon={Activity} />
          </div>

          <section className="card overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/80 px-5 py-4">
              <div>
                <h2 className="text-sm font-semibold text-foreground">Kampanyalar</h2>
                <p className="mt-1 text-xs text-muted">{selectedAccount?.name} · {currentInsight?.campaigns.length ?? 0} kampanya</p>
              </div>
              {reportLoading && <span className="inline-flex items-center gap-2 text-xs text-muted"><RefreshCw className="h-3.5 w-3.5 animate-spin" /> Rapor yenileniyor</span>}
            </div>
            {currentInsight && currentInsight.campaigns.length ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1120px] text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs text-muted">
                      <th className="px-5 py-3 font-medium">Kampanya</th>
                      <th className="px-4 py-3 font-medium">Durum</th>
                      <th className="px-4 py-3 font-medium">Amaç / tür</th>
                      <th className="px-4 py-3 text-right font-medium">Bütçe</th>
                      <th className="px-4 py-3 text-right font-medium">Harcama</th>
                      <th className="px-4 py-3 text-right font-medium">Sonuç</th>
                      <th className="px-4 py-3 text-right font-medium">Sonuç maliyeti</th>
                      <th className="px-4 py-3 text-right font-medium">CTR</th>
                      <th className="px-5 py-3 text-right font-medium">ROAS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {currentInsight.campaigns.map((campaign) => (
                      <tr key={campaign.id} className="border-b border-border/60 transition-colors last:border-0 hover:bg-surface-2/40">
                        <td className="px-5 py-3.5">
                          <div className="min-w-52">
                            <p className="font-medium text-foreground">{campaign.name}</p>
                            <div className="mt-2 h-1 overflow-hidden rounded-full bg-surface-2">
                              <div className="h-full rounded-full bg-amber/70" style={{ width: `${Math.max((campaign.spend / maxSpend) * 100, campaign.spend ? 3 : 0)}%` }} />
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3.5"><Badge tone={statusTone(campaign.status)}>{campaign.status}</Badge></td>
                        <td className="px-4 py-3.5 text-muted">{friendlyObjective(campaign.objective)}</td>
                        <td className="px-4 py-3.5 text-right text-muted">{campaign.budget ? formatMoney(campaign.budget, currency) : "—"}</td>
                        <td className="px-4 py-3.5 text-right font-medium text-foreground">{formatMoney(campaign.spend, currency)}</td>
                        <td className="px-4 py-3.5 text-right text-muted">{formatNumber(campaign.results)}</td>
                        <td className="px-4 py-3.5 text-right text-muted">{campaign.results ? formatMoney(campaign.costPerResult, currency) : "—"}</td>
                        <td className="px-4 py-3.5 text-right text-muted">{formatPercent(campaign.ctr)}</td>
                        <td className="px-5 py-3.5 text-right text-muted">{campaign.roas ? `${campaign.roas.toLocaleString("tr-TR", { maximumFractionDigits: 2 })}x` : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : !reportLoading ? (
              <div className="p-5"><EmptyState title="Bu tarihlerde kampanya verisi yok" hint="Tarih aralığını genişletip yeniden deneyebilirsin." /></div>
            ) : (
              <div className="grid min-h-48 place-items-center text-sm text-muted"><span className="inline-flex items-center gap-2"><RefreshCw className="h-4 w-4 animate-spin" /> Rapor hazırlanıyor</span></div>
            )}
          </section>
        </div>
      ) : accountsLoading ? (
        <div className="card grid min-h-52 place-items-center text-sm text-muted"><span className="inline-flex items-center gap-2"><RefreshCw className="h-4 w-4 animate-spin" /> Reklam hesapları alınıyor</span></div>
      ) : null}
    </>
  );
}
