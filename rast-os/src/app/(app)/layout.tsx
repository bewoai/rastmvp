import AppShell from "@/components/AppShell";
import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export default async function AppGroupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let userName: string | null = null;

  if (isSupabaseConfigured) {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("full_name")
        .eq("id", user.id)
        .single();
      userName = profile?.full_name ?? user.email ?? null;
    }
  }

  return (
    <AppShell userName={userName}>
      {!isSupabaseConfigured && (
        <div className="mb-4 rounded-lg border border-amber/40 bg-amber/10 px-4 py-3 text-sm text-foreground">
          <strong className="text-amber">Kurulum bekliyor:</strong> Supabase
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
