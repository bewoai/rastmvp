import type { Metadata } from "next";
import { ShieldAlert } from "lucide-react";
import { getPublicApproval } from "@/lib/approval-public";
import { isSupabaseConfigured } from "@/lib/env";
import { ApprovalForm } from "./ApprovalForm";

// Herkese açık içerik onay sayfası. Oturum gerekmez (proxy /onay/* yolunu serbest bırakır); veri
// yalnızca token ile anon RPC'den (approval_get) gelir. Arama motorlarına kapalı; bağlantıdaki token
// başka sitelere Referer ile sızmasın diye no-referrer.
export const metadata: Metadata = {
  title: "İçerik onayı · Rast OS",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

export default async function OnayPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const result = await getPublicApproval(token);

  return (
    <main className="mx-auto w-full max-w-2xl px-4 pb-16 pt-6 sm:pt-10">
      {result.kind === "ok" ? (
        <ApprovalForm token={token} approval={result.approval} demo={!isSupabaseConfigured} />
      ) : (
        <div className="card p-6 text-center">
          <ShieldAlert className="mx-auto h-8 w-8 text-warning" aria-hidden />
          <h1 className="mt-3 text-lg font-semibold text-foreground">
            {result.kind === "not_found" ? "Onay bağlantısı bulunamadı" : "Onay sayfası şu anda açılamıyor"}
          </h1>
          <p className="mx-auto mt-2 max-w-sm text-sm text-muted">
            {result.kind === "not_found"
              ? "Bağlantı eksik kopyalanmış, geri çekilmiş ya da hiç oluşturulmamış olabilir. Ajanstan yeni bir bağlantı isteyin."
              : "Lütfen birkaç dakika sonra tekrar deneyin. Sorun sürerse ajansa haber verin."}
          </p>
        </div>
      )}
    </main>
  );
}
