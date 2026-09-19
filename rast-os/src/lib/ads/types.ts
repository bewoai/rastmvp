export type AdsPlatform = "google" | "meta";

export type AdsConnectionStatus = {
  platform: AdsPlatform;
  configured: boolean;
  missingCount: number;
};

export type AdAccount = {
  id: string;
  name: string;
  platform: AdsPlatform;
  currency: string;
  timezone?: string;
};

export type AdCampaignMetric = {
  id: string;
  name: string;
  status: string;
  objective?: string;
  budget: number;
  spend: number;
  impressions: number;
  reach: number;
  clicks: number;
  ctr: number;
  cpc: number;
  cpm: number;
  results: number;
  costPerResult: number;
  roas: number;
};

export type AdsInsight = {
  platform: AdsPlatform;
  accountId: string;
  from: string;
  to: string;
  totals: Omit<AdCampaignMetric, "id" | "name" | "status" | "objective" | "budget">;
  campaigns: AdCampaignMetric[];
};
