import { isSupabaseConfigured } from "@/lib/env";
import { clientIp } from "@/lib/lead-intake";
import { limiters } from "@/lib/growth/server";
import { isUnsubTokenShape } from "@/lib/growth/unsubscribe";
import { createAnonClient } from "@/lib/supabase/anon";

// Tek tıkla ret (unsubscribe). Oturumsuz (proxy'de yalnızca bu tam yol açık). Token = "<mesaj id>.<HMAC>";
// doğrulama ve yazma DB'de: outreach_unsubscribe() (0019, SECURITY DEFINER). GET (e-postadaki bağlantı) ve
// POST (RFC 8058 List-Unsubscribe-Post: tek tık) aynı işi yapar; işlem idempotenttir.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function page(title: string, message: string, status: number) {
  const html = `<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${title}</title>
<style>body{margin:0;font:16px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;background:#f6f5f2;color:#1d1c1a}
main{max-width:32rem;margin:15vh auto;padding:0 1rem}h1{font-size:1.4rem}p{color:#4a4844}small{color:#7a776f}</style></head>
<body><main><h1>${title}</h1><p>${message}</p><small>Rast Creative Studio · Serdivan / Sakarya</small></main></body></html>`;
  return new Response(html, { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });
}

async function handle(request: Request, asPage: boolean) {
  const rate = limiters.unsubscribe.check(`unsub:${clientIp(request.headers)}`);
  if (!rate.ok) return asPage ? page("Çok fazla istek", "Lütfen biraz sonra tekrar deneyin.", 429) : new Response(null, { status: 429 });

  const token = new URL(request.url).searchParams.get("t");
  if (!isUnsubTokenShape(token)) {
    return asPage ? page("Bağlantı geçersiz", "Bu ret bağlantısı geçersiz ya da eksik kopyalanmış. Yanıt vererek de listeden çıkabilirsiniz.", 400) : new Response(null, { status: 400 });
  }
  if (!isSupabaseConfigured) return asPage ? page("Geçici sorun", "Şu anda işlem yapılamıyor. Lütfen e-postaya yanıt vererek bildirin.", 503) : new Response(null, { status: 503 });

  const { data, error } = await createAnonClient().rpc("outreach_unsubscribe", { p_token: token });
  if (error) {
    console.error("[growth/unsubscribe] RPC hatası:", error.code);
    return asPage ? page("Geçici sorun", "Şu anda işlem yapılamıyor. Lütfen e-postaya yanıt vererek bildirin.", 502) : new Response(null, { status: 502 });
  }
  const ok = Boolean((data as { ok?: boolean } | null)?.ok);
  if (!ok) return asPage ? page("Bağlantı geçersiz", "Bu ret bağlantısı tanınmadı. Yanıt vererek de listeden çıkabilirsiniz.", 400) : new Response(null, { status: 400 });
  return asPage
    ? page("Listeden çıkarıldınız", "Adresiniz ret listemize eklendi; size bir daha e-posta göndermeyeceğiz. Bekleyen tüm iletiler iptal edildi.", 200)
    : new Response(null, { status: 200 });
}

export async function GET(request: Request) {
  return handle(request, true);
}

export async function POST(request: Request) {
  return handle(request, false);
}
