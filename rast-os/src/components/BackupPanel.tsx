"use client";

import Link from "next/link";
import { useState } from "react";
import { Download, DatabaseBackup, TriangleAlert } from "lucide-react";
import { Panel } from "@/components/ui";
import { Button } from "@/components/form";
import { useStore } from "@/lib/store";
import { useOrgSettings } from "@/lib/orgSettings";
import { downloadBackup, useLastBackup } from "@/lib/backup";
import { useToasts } from "@/lib/toast";

/** Yedek yalnızca canlı (Supabase) modda ve yönetici (admin) rolüyle anlamlıdır. */
function useCanBackup() {
  const supabase = useStore((s) => s.supabase);
  const orgId = useStore((s) => s.orgId);
  const loaded = useOrgSettings((s) => s.loaded);
  const isAdmin = useOrgSettings((s) => s.canEdit);
  return supabase && Boolean(orgId) && loaded && isAdmin;
}

/**
 * Ayarlar → "Verileri yedekle". Yalnızca yönetici görür. Veriler oturumdaki kullanıcının yetkisiyle
 * (RLS altında) okunur; dosya sunucuya gönderilmez, doğrudan tarayıcıdan inmeye başlar.
 */
export default function BackupPanel() {
  const canBackup = useCanBackup();
  const push = useToasts((s) => s.push);
  const { label, stale } = useLastBackup();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string>("");

  if (!canBackup) return null;

  async function onBackup() {
    setBusy(true);
    setProgress("Hazırlanıyor…");
    const r = await downloadBackup((done, total, table) => setProgress(`${done}/${total} · ${table}`));
    setBusy(false);
    setProgress("");
    if (r.error) {
      push({ message: r.error, tone: "danger" });
    } else if (r.failed.length > 0) {
      push({ message: `Yedek indirildi ancak şu tablolar okunamadı: ${r.failed.join(", ")}. Bu yedek eksik.`, tone: "danger" });
    } else {
      push({ message: `Yedek indirildi (${r.rowCount.toLocaleString("tr-TR")} kayıt).` });
    }
  }

  return (
    <div id="yedek" className="scroll-mt-20">
      <Panel title="Verileri yedekle">
        <p className="text-sm text-muted">
          Uygulamadaki tüm tabloları (müşteriler, işler, faturalar, teklifler, işlem geçmişi…) tek bir JSON
          dosyası olarak bilgisayarına indirir. Dosya yalnızca senin tarayıcında oluşur; müşteri portalı
          bağlantı anahtarları dahil hassas veri içerir, güvenli bir yerde sakla.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button onClick={onBackup} loading={busy}>
            {!busy && <Download className="h-4 w-4" aria-hidden />}
            {busy ? "Yedekleniyor…" : "Yedeği indir"}
          </Button>
          <span className="text-xs text-muted" role="status" aria-live="polite">
            {busy ? progress : label}
          </span>
        </div>
        {stale && !busy && (
          <p className="mt-3 flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-foreground">
            <TriangleAlert className="mt-px h-3.5 w-3.5 shrink-0 text-warning" aria-hidden />
            Son yedek 7 günden eski. Düzenli yedek almanı öneririz.
          </p>
        )}
        <p className="mt-3 flex items-start gap-2 text-xs text-muted">
          <DatabaseBackup className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
          Son yedek tarihi yalnızca bu tarayıcıda saklanır; başka bir cihazdan yedek aldıysan burada görünmez.
        </p>
      </Panel>
    </div>
  );
}

/** Ana panel için küçük uyarı: yönetici + yedek yok/7 günden eski ise görünür, aksi halde hiçbir şey çizmez. */
export function BackupReminder() {
  const canBackup = useCanBackup();
  const { label, stale } = useLastBackup();
  if (!canBackup || !stale) return null;
  return (
    <Link
      href="/settings#yedek"
      prefetch={false}
      className="mb-4 flex items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-foreground outline-none transition-colors hover:bg-warning/15 focus-visible:ring-2 focus-visible:ring-amber/60"
    >
      <TriangleAlert className="h-3.5 w-3.5 shrink-0 text-warning" aria-hidden />
      <span>
        <strong className="font-medium">{label}.</strong> Verilerini yedeklemek için Ayarlar&apos;a git.
      </span>
    </Link>
  );
}
