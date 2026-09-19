import { AdsApiError, getGoogleInsights, getMetaInsights, requireAdsUser } from "@/lib/ads/server";
import type { AdsPlatform } from "@/lib/ads/types";

export const dynamic = "force-dynamic";

function validDate(value: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export async function GET(request: Request) {
  try {
    await requireAdsUser();
    const { searchParams } = new URL(request.url);
    const platform = searchParams.get("platform") as AdsPlatform | null;
    const accountId = searchParams.get("accountId") || "";
    const from = searchParams.get("from");
    const to = searchParams.get("to");
    if ((platform !== "google" && platform !== "meta") || !accountId || !validDate(from) || !validDate(to)) {
      throw new AdsApiError("Reklam raporu filtreleri geçersiz.", 400);
    }
    if (from! > to!) throw new AdsApiError("Başlangıç tarihi bitiş tarihinden sonra olamaz.", 400);
    const rangeDays = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
    if (rangeDays > 366) throw new AdsApiError("Tek raporda en fazla 367 günlük tarih aralığı seçilebilir.", 400);
    const insight = platform === "google"
      ? await getGoogleInsights(accountId, from!, to!)
      : await getMetaInsights(accountId, from!, to!);
    return Response.json(insight, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const status = error instanceof AdsApiError ? error.status : 500;
    return Response.json({ error: error instanceof Error ? error.message : "Reklam raporu alınamadı." }, { status });
  }
}
