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
    // Proxy kimliği zaten doğruladı; burada imzası YEREL doğrulanmış claims okunur (ağ çağrısı yok,
    // sunucuda güvenilmeyen getSession() kullanılmaz). Tek ağ çağrısı: görünen ad için profil.
    const { data } = await supabase.auth.getClaims();
    const claims = data?.claims;
    if (claims?.sub) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("full_name")
        .eq("id", claims.sub)
        .single();
      userName = profile?.full_name ?? claims.email ?? null;
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
