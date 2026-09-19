import { AdsApiError, getAllAdAccounts, requireAdsUser } from "@/lib/ads/server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireAdsUser();
    return Response.json(await getAllAdAccounts(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const status = error instanceof AdsApiError ? error.status : 500;
    return Response.json({ error: error instanceof Error ? error.message : "Reklam hesapları alınamadı." }, { status });
  }
}
