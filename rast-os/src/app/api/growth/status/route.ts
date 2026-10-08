import { emailSendingEnabled, parseDailyCap } from "@/lib/growth/logic";
import { smtpConfigFromEnv } from "@/lib/growth/mailer";
import { growthContext, json, unauthorized } from "@/lib/growth/server";

// Müşteri Bulma modülünün sunucu yapılandırması (sır DÖNMEZ; yalnızca açık/kapalı bilgisi).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const ctx = await growthContext(request);
  if (!ctx) return unauthorized();
  const env = process.env;
  return json({
    ok: true,
    demo: ctx.demo,
    places: ctx.demo || !(env.GOOGLE_PLACES_API_KEY ?? "").trim() ? "mock" : "google",
    emailEnabled: emailSendingEnabled(env),
    smtpConfigured: smtpConfigFromEnv(env) !== null,
    cronConfigured: (env.CRON_SECRET ?? "").length >= 16,
    dailyCap: parseDailyCap(env.DAILY_SEND_CAP),
  });
}
