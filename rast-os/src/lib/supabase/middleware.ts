import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isAuthRequired } from "@/lib/env";

/**
 * Oturum çerezlerini tazeler ve giriş yapılmamışsa /login'e yönlendirir.
 * Supabase env değişkenleri yoksa (henüz kurulmadıysa) sessizce geçer.
 *
 * Kimlik doğrulama stratejisi (her belge + tıklama navigasyonu isteği için):
 * `auth.getClaims()`. Proje asimetrik (ES256) JWT imzalama anahtarı kullandığı için token imzası
 * + `exp` JWKS ile YEREL doğrulanır (JWKS süreç içinde önbelleklenir; ağ çağrısı yok). Süresi
 * dolmuşsa refresh token ile yenilenir ve çerezler güncellenir. Simetrik (HS256) anahtara
 * dönülürse getClaims() kendiliğinden `getUser()` ağ çağrısına düşer — güvenlik düşmez,
 * yalnızca hız kazancı kaybolur.
 * Not: oturum iptali (çıkış/kullanıcı silme) JWT süresi dolana dek yerelde görünmez; veri erişimi
 * zaten her sorguda Postgres RLS + JWT ile korunur (PostgREST de yalnızca JWT'yi doğrular).
 *
 * Prefetch'i ayırt edip atlamak MÜMKÜN DEĞİL: Next 16.2, proxy çalışmadan önce `RSC`,
 * `Next-Router-Prefetch`, `Next-Router-State-Tree` ve `Next-Router-Segment-Prefetch` başlıklarını
 * istekten siler (next/dist/server/web/adapter.js, FLIGHT_HEADERS). Gerek de yok: doğrulama artık
 * yerel olduğundan prefetch de Supabase'e ağ çağrısı yapmaz; asıl önlem <Link prefetch={false}>.
 */
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return supabaseResponse;

  // Fail-closed: giriş varsayılan olarak ZORUNLU. Yalnızca açıkça
  // NEXT_PUBLIC_REQUIRE_AUTH=false verilirse (yerel demo/kurulum) login duvarı kapanır.
  const requireAuth = isAuthRequired;

  const path = request.nextUrl.pathname;
  const isPublic =
    path.startsWith("/login") ||
    path.startsWith("/auth") ||
    path.startsWith("/portal-login") ||
    // Herkese açık içerik onay sayfası (/onay/<token>): hekim hesapsız açar; veriye yalnızca
    // token'la anon RPC (approval_get / approval_decide) üzerinden erişilir.
    path.startsWith("/onay/") ||
    // Web sitesi lead webhook'u (POST /api/leads): oturum yok; yetki x-rast-lead-secret başlığıyla
    // route içinde sabit-zamanlı karşılaştırılır (LEAD_WEBHOOK_SECRET). Yalnızca bu tam yol açık.
    path === "/api/leads" ||
    // Müşteri Bulma (0019): e-postadaki tek tıkla ret bağlantısı (HMAC token, DB'de doğrulanır) ve Vercel Cron
    // (Authorization: Bearer CRON_SECRET, route içinde sabit-zamanlı karşılaştırılır). Yalnızca bu tam yollar açık.
    path === "/api/growth/unsubscribe" ||
    path === "/api/growth/cron";

  const redirectToLogin = () => {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/login";
    return NextResponse.redirect(redirectUrl);
  };

  const supabase = createServerClient(url, anon, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value),
        );
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options),
        );
      },
    },
  });

  let authenticated = false;
  try {
    const { data } = await supabase.auth.getClaims();
    const claims = data?.claims;
    authenticated = Boolean(claims?.sub) && claims?.role === "authenticated";
  } catch {
    authenticated = false;
  }

  if (requireAuth && !authenticated && !isPublic) return redirectToLogin();

  return supabaseResponse;
}
