import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { AdAccount, AdCampaignMetric, AdsConnectionStatus, AdsInsight, AdsPlatform } from "./types";

const GOOGLE_API_VERSION = process.env.GOOGLE_ADS_API_VERSION || "v25";
const META_API_VERSION = process.env.META_ADS_API_VERSION || "v25.0";

type GoogleStream<T> = Array<{ results?: T[] }>;
type MetaPage<T> = { data?: T[]; paging?: { next?: string } };

export class AdsApiError extends Error {
  constructor(message: string, public status = 502) {
    super(message);
  }
}

export async function requireAdsUser() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) throw new AdsApiError("Oturum gerekli.", 401);
  return user;
}

function requiredGoogleConfig() {
  return {
    developerToken: process.env.GOOGLE_ADS_DEVELOPER_TOKEN,
    clientId: process.env.GOOGLE_ADS_CLIENT_ID,
    clientSecret: process.env.GOOGLE_ADS_CLIENT_SECRET,
    refreshToken: process.env.GOOGLE_ADS_REFRESH_TOKEN,
    managerId: process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID?.replace(/-/g, ""),
  };
}

function requiredMetaConfig() {
  return { accessToken: process.env.META_ADS_ACCESS_TOKEN };
}

export function getAdsConnectionStatus(): AdsConnectionStatus[] {
  const google = requiredGoogleConfig();
  const meta = requiredMetaConfig();
  const googleMissing = Object.values(google).filter((value) => !value).length;
  const metaMissing = Object.values(meta).filter((value) => !value).length;
  return [
    { platform: "google", configured: googleMissing === 0, missingCount: googleMissing },
    { platform: "meta", configured: metaMissing === 0, missingCount: metaMissing },
  ];
}

async function responseJson<T>(response: Response, provider: string): Promise<T> {
  const text = await response.text();
  let body: unknown = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!response.ok) {
    console.error(`${provider} API error`, response.status, body);
    throw new AdsApiError(`${provider} bağlantısı yanıt vermedi (${response.status}).`);
  }
  return body as T;
}

async function googleAccessToken() {
  const config = requiredGoogleConfig();
  if (!config.clientId || !config.clientSecret || !config.refreshToken) {
    throw new AdsApiError("Google Ads bağlantısı yapılandırılmadı.", 503);
  }
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: config.refreshToken,
      grant_type: "refresh_token",
    }),
    cache: "no-store",
  });
  const data = await responseJson<{ access_token?: string }>(response, "Google Ads");
  if (!data.access_token) throw new AdsApiError("Google Ads erişim anahtarı alınamadı.");
  return data.access_token;
}

async function googleQuery<T>(customerId: string, query: string) {
  const config = requiredGoogleConfig();
  if (!config.developerToken || !config.managerId) throw new AdsApiError("Google Ads bağlantısı yapılandırılmadı.", 503);
  const accessToken = await googleAccessToken();
  const response = await fetch(`https://googleads.googleapis.com/${GOOGLE_API_VERSION}/customers/${customerId}/googleAds:searchStream`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "developer-token": config.developerToken,
      "login-customer-id": config.managerId,
    },
    body: JSON.stringify({ query }),
    cache: "no-store",
  });
  const chunks = await responseJson<GoogleStream<T>>(response, "Google Ads");
  return chunks.flatMap((chunk) => chunk.results ?? []);
}

export async function getGoogleAccounts(): Promise<AdAccount[]> {
  const config = requiredGoogleConfig();
  if (Object.values(config).some((value) => !value)) return [];
  const rows = await googleQuery<{
    customerClient?: {
      clientCustomer?: string;
      descriptiveName?: string;
      currencyCode?: string;
      timeZone?: string;
      manager?: boolean;
      status?: string;
    };
  }>(config.managerId!, `
    SELECT customer_client.client_customer, customer_client.descriptive_name,
      customer_client.currency_code, customer_client.time_zone,
      customer_client.manager, customer_client.status
    FROM customer_client
    WHERE customer_client.status = 'ENABLED'
    ORDER BY customer_client.descriptive_name
  `);
  return rows
    .map((row) => row.customerClient)
    .filter((account) => account?.clientCustomer && !account.manager)
    .map((account) => ({
      id: account!.clientCustomer!.replace("customers/", ""),
      name: account!.descriptiveName || account!.clientCustomer!,
      platform: "google" as const,
      currency: account!.currencyCode || "TRY",
      timezone: account!.timeZone,
    }));
}

function micros(value?: string | number) {
  return Number(value || 0) / 1_000_000;
}

function normalizedStatus(value?: string) {
  if (value === "ENABLED" || value === "ACTIVE") return "Aktif";
  if (value === "PAUSED") return "Durduruldu";
  if (value === "REMOVED" || value === "ARCHIVED") return "Arşivlendi";
  return value || "Bilinmiyor";
}

export async function getGoogleInsights(accountId: string, from: string, to: string): Promise<AdsInsight> {
  const safeAccountId = accountId.replace(/\D/g, "");
  if (!safeAccountId) throw new AdsApiError("Geçersiz Google Ads hesabı.", 400);
  const rows = await googleQuery<{
    campaign?: { id?: string; name?: string; status?: string; advertisingChannelType?: string };
    campaignBudget?: { amountMicros?: string };
    metrics?: {
      costMicros?: string; impressions?: string; clicks?: string; ctr?: number;
      averageCpc?: string; conversions?: number; conversionsValue?: number;
    };
  }>(safeAccountId, `
    SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type,
      campaign_budget.amount_micros, metrics.cost_micros, metrics.impressions,
      metrics.clicks, metrics.ctr, metrics.average_cpc, metrics.conversions,
      metrics.conversions_value
    FROM campaign
    WHERE segments.date BETWEEN '${from}' AND '${to}'
      AND campaign.status != 'REMOVED'
    ORDER BY metrics.cost_micros DESC
  `);
  const campaigns: AdCampaignMetric[] = rows.map((row) => {
    const spend = micros(row.metrics?.costMicros);
    const results = Number(row.metrics?.conversions || 0);
    const impressions = Number(row.metrics?.impressions || 0);
    return {
      id: row.campaign?.id || crypto.randomUUID(),
      name: row.campaign?.name || "İsimsiz kampanya",
      status: normalizedStatus(row.campaign?.status),
      objective: row.campaign?.advertisingChannelType,
      budget: micros(row.campaignBudget?.amountMicros),
      spend,
      impressions,
      reach: 0,
      clicks: Number(row.metrics?.clicks || 0),
      ctr: Number(row.metrics?.ctr || 0) * 100,
      cpc: micros(row.metrics?.averageCpc),
      cpm: impressions ? (spend / impressions) * 1000 : 0,
      results,
      costPerResult: results ? spend / results : 0,
      roas: spend ? Number(row.metrics?.conversionsValue || 0) / spend : 0,
    };
  });
  return buildInsight("google", safeAccountId, from, to, campaigns);
}

async function metaPages<T>(initialUrl: string) {
  const rows: T[] = [];
  let next: string | undefined = initialUrl;
  let page = 0;
  while (next && page < 5) {
    const response: Response = await fetch(next, { cache: "no-store" });
    const payload: MetaPage<T> = await responseJson<MetaPage<T>>(response, "Meta Ads");
    rows.push(...(payload.data ?? []));
    next = payload.paging?.next;
    page += 1;
  }
  return rows;
}

function metaUrl(path: string, params: Record<string, string>) {
  const token = requiredMetaConfig().accessToken;
  if (!token) throw new AdsApiError("Meta Ads bağlantısı yapılandırılmadı.", 503);
  const search = new URLSearchParams({ ...params, access_token: token });
  return `https://graph.facebook.com/${META_API_VERSION}/${path}?${search}`;
}

export async function getMetaAccounts(): Promise<AdAccount[]> {
  if (!requiredMetaConfig().accessToken) return [];
  const rows = await metaPages<{ id: string; name?: string; account_status?: number; currency?: string; timezone_name?: string }>(
    metaUrl("me/adaccounts", { fields: "id,name,account_status,currency,timezone_name", limit: "100" }),
  );
  return rows
    .filter((account) => account.account_status === 1 || account.account_status === undefined)
    .map((account) => ({
      id: account.id,
      name: account.name || account.id,
      platform: "meta" as const,
      currency: account.currency || "TRY",
      timezone: account.timezone_name,
    }));
}

type MetaAction = { action_type?: string; value?: string };
type MetaCampaign = {
  id: string; name?: string; status?: string; objective?: string;
  daily_budget?: string; lifetime_budget?: string;
  insights?: { data?: Array<{
    spend?: string; impressions?: string; reach?: string; clicks?: string;
    ctr?: string; cpc?: string; cpm?: string; actions?: MetaAction[];
    purchase_roas?: MetaAction[];
  }> };
};

function metaResults(actions?: MetaAction[]) {
  const preferred = ["lead", "onsite_conversion.lead_grouped", "purchase", "offsite_conversion.fb_pixel_purchase", "onsite_conversion.messaging_conversation_started_7d"];
  for (const type of preferred) {
    const match = actions?.find((action) => action.action_type === type);
    if (match) return Number(match.value || 0);
  }
  return 0;
}

export async function getMetaInsights(accountId: string, from: string, to: string): Promise<AdsInsight> {
  const safeAccountId = accountId.startsWith("act_") ? accountId : `act_${accountId.replace(/\D/g, "")}`;
  if (!/^act_\d+$/.test(safeAccountId)) throw new AdsApiError("Geçersiz Meta Ads hesabı.", 400);
  const timeRange = JSON.stringify({ since: from, until: to });
  const fields = `id,name,status,objective,daily_budget,lifetime_budget,insights.time_range(${timeRange}){spend,impressions,reach,clicks,ctr,cpc,cpm,actions,purchase_roas}`;
  const rows = await metaPages<MetaCampaign>(metaUrl(`${safeAccountId}/campaigns`, { fields, limit: "100" }));
  const campaigns: AdCampaignMetric[] = rows.map((row) => {
    const metric = row.insights?.data?.[0];
    const spend = Number(metric?.spend || 0);
    const results = metaResults(metric?.actions);
    return {
      id: row.id,
      name: row.name || "İsimsiz kampanya",
      status: normalizedStatus(row.status),
      objective: row.objective,
      budget: Number(row.daily_budget || row.lifetime_budget || 0) / 100,
      spend,
      impressions: Number(metric?.impressions || 0),
      reach: Number(metric?.reach || 0),
      clicks: Number(metric?.clicks || 0),
      ctr: Number(metric?.ctr || 0),
      cpc: Number(metric?.cpc || 0),
      cpm: Number(metric?.cpm || 0),
      results,
      costPerResult: results ? spend / results : 0,
      roas: Number(metric?.purchase_roas?.[0]?.value || 0),
    };
  });
  return buildInsight("meta", safeAccountId, from, to, campaigns);
}

function buildInsight(platform: AdsPlatform, accountId: string, from: string, to: string, campaigns: AdCampaignMetric[]): AdsInsight {
  const sum = (field: keyof AdCampaignMetric) => campaigns.reduce((total, campaign) => total + Number(campaign[field] || 0), 0);
  const spend = sum("spend");
  const impressions = sum("impressions");
  const clicks = sum("clicks");
  const results = sum("results");
  const weightedRoasValue = campaigns.reduce((total, campaign) => total + campaign.spend * campaign.roas, 0);
  return {
    platform, accountId, from, to, campaigns,
    totals: {
      spend,
      impressions,
      reach: sum("reach"),
      clicks,
      ctr: impressions ? (clicks / impressions) * 100 : 0,
      cpc: clicks ? spend / clicks : 0,
      cpm: impressions ? (spend / impressions) * 1000 : 0,
      results,
      costPerResult: results ? spend / results : 0,
      roas: spend ? weightedRoasValue / spend : 0,
    },
  };
}

export async function getAllAdAccounts() {
  const status = getAdsConnectionStatus();
  const [google, meta] = await Promise.allSettled([getGoogleAccounts(), getMetaAccounts()]);
  return {
    status,
    accounts: [
      ...(google.status === "fulfilled" ? google.value : []),
      ...(meta.status === "fulfilled" ? meta.value : []),
    ],
    errors: {
      google: google.status === "rejected" ? (google.reason instanceof Error ? google.reason.message : "Google Ads bağlantı hatası") : null,
      meta: meta.status === "rejected" ? (meta.reason instanceof Error ? meta.reason.message : "Meta Ads bağlantı hatası") : null,
    },
  };
}
