import type { Metadata } from "next";
import AppShell from "@/components/AppShell";
import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Bugün · Rast OS" };

export default async function AppGroupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let userName: string | null = null;

  if (isSupabaseConfigured) {
    const supabase = await createClient();
    // Giriş koruması proxy'de (src/proxy.ts → updateSession: getClaims, oturumsuz → /login); burada yalnız
    // görünen ad okunur. İmzası YEREL doğrulanmış claims (ağ çağrısı yok; sunucuda güvenilmeyen getSession()
    // kullanılmaz). Önceden ad için `profiles` sorgusu her tam yüklemede Supabase'e 1 tur atıp HTML'i (TTFB)
    // bekletiyordu; artık ilk ad JWT'den (kayıttaki user_metadata.full_name, yoksa e-posta), kesin ad
    // istemcide açılış isteğinin profilinden gelir (Topbar → store.profile.full_name).
    const { data } = await supabase.auth.getClaims();
    const claims = data?.claims;
    if (claims?.sub) {
      const meta = claims.user_metadata as { full_name?: unknown } | undefined;
      const metaName = typeof meta?.full_name === "string" && meta.full_name.trim() ? meta.full_name.trim() : null;
      userName = metaName ?? (typeof claims.email === "string" ? claims.email : null);
    }
  }

  return (
    <AppShell userName={userName}>
      {!isSupabaseConfigured && (
        <div className="mb-5 rounded-lg border border-border bg-surface px-4 py-3 text-[13px] leading-relaxed text-muted print:hidden">
          <strong className="font-medium text-foreground">Kurulum bekliyor:</strong> Supabase
          bağlantısı yapılandırılmadı. <code>.env.example</code> dosyasını{" "}
          <code>.env.local</code> olarak kopyalayıp Supabase anahtarlarını girin,
          ardından <code>supabase/migrations/0001_init.sql</code> dosyasını
          Supabase SQL editöründe çalıştırın. (Şimdilik örnek verilerle
          görüntüleniyor.)
        </div>
      )}
      {children}
    </AppShell>
  );
}
