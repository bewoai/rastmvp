"use client";

import { useMemo, useState } from "react";
import { Check, Copy, ExternalLink, MessageCircle, RotateCcw, Send, ShieldCheck, Undo2 } from "lucide-react";
import { Badge } from "@/components/ui";
import { Button } from "@/components/form";
import { useStore, nowISO } from "@/lib/store";
import { useToasts } from "@/lib/toast";
import { approvalStatus, dateTimeTR } from "@/lib/labels";
import {
  APPROVAL_CHECKLIST, approvalPath, approvalShareText, checkedCount, daysLeft, effectiveStatus,
  versionsFor, whatsappShareUrl,
} from "@/lib/approval-logic";
import { sendForApproval, withdrawApproval } from "@/lib/approvalActions";
import type { Content } from "@/lib/types";

const toast = (message: string, tone: "default" | "danger" = "default") => useToasts.getState().push({ message, tone });

/**
 * İçerik düzenleme modalındaki "Onay" paneli: sürümler, onaya gönder / yeniden gönder, gizli bağlantı
 * (kopyala + WhatsApp) ve geri çekme. Onaya giden metin KAYITLI senaryodur; formda kaydedilmemiş
 * değişiklik varsa gönderim kilitlenir.
 */
export function ContentApprovalPanel({ content, draftScript, draftTitle }: {
  content: Pick<Content, "id" | "title" | "script">;
  draftScript?: string;
  draftTitle?: string;
}) {
  const approvals = useStore((s) => s.content_approvals);
  const supabase = useStore((s) => s.supabase);
  // Sabit "şimdi" (render saf kalır); gönderimden sonra yenilenir ki kalan gün doğru görünsün.
  const [now, setNow] = useState(() => nowISO());
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const versions = useMemo(() => versionsFor(approvals, content.id), [approvals, content.id]);
  const latest = versions[0];
  const latestStatus = latest ? effectiveStatus(latest, now) : undefined;
  const activeLink = latest && latestStatus === "pending" ? latest : undefined;

  const unsaved = (draftScript ?? content.script ?? "") !== (content.script ?? "")
    || (draftTitle ?? content.title).trim() !== content.title.trim();
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const linkUrl = activeLink ? `${origin}${approvalPath(activeLink.token)}` : "";

  async function send() {
    setBusy(true);
    const r = await sendForApproval(content);
    setBusy(false);
    if (!r.ok) {
      toast(r.error ? `Onaya gönderilemedi: ${r.error}` : "Onaya gönderilemedi", "danger");
      return;
    }
    setCopied(false);
    setNow(nowISO());
    toast(`Onay bağlantısı oluşturuldu (v${r.approval?.version ?? 1})`);
  }

  async function withdraw(id: string) {
    setBusy(true);
    const r = await withdrawApproval(id);
    setBusy(false);
    toast(r.ok ? "Onay talebi geri çekildi" : `Geri çekilemedi: ${r.error ?? ""}`, r.ok ? "default" : "danger");
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(linkUrl);
      setCopied(true);
      toast("Bağlantı kopyalandı");
    } catch {
      toast("Kopyalanamadı — bağlantıyı seçip elle kopyalayın.", "danger");
    }
  }

  return (
    <section aria-label="İçerik onayı" className="rounded-lg border border-border bg-surface-2/40 p-4">
      <div className="flex items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-muted" aria-hidden />
        <h3 className="text-sm font-semibold text-foreground">Onay</h3>
        {latest && latestStatus && (
          <span className="ml-auto"><Badge tone={approvalStatus[latestStatus].tone}>{approvalStatus[latestStatus].label}</Badge></span>
        )}
      </div>
      <p className="mt-1 text-xs text-muted">
        Hekim / müşteri, senaryoyu {APPROVAL_CHECKLIST.length} maddelik mevzuat listesiyle hesapsız onaylar. Onay olmadan yayın yapılmaz; sessizlik onay sayılmaz.
      </p>

      {activeLink && (
        <div className="mt-3 rounded-lg border border-border bg-surface-2/50 p-3">
          <p className="text-xs font-medium text-muted">Onay bağlantısı · v{activeLink.version}</p>
          <p className="mt-1 select-all break-all font-mono text-xs text-foreground">{linkUrl}</p>
          <p className="mt-1 text-[11px] text-muted">
            {daysLeft(activeLink, now)} gün geçerli ({dateTimeTR(activeLink.expires_at)}). Bağlantı gizlidir; yalnızca onaylayacak kişiye gönderin.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button variant="ghost" className="min-h-9 px-3 text-xs" onClick={copy}>
              {copied ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />} {copied ? "Kopyalandı" : "Kopyala"}
            </Button>
            <a
              href={whatsappShareUrl(approvalShareText({ title: activeLink.title, version: activeLink.version, url: linkUrl, expiresAt: activeLink.expires_at }))}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-border px-3 text-xs font-medium text-foreground hover:bg-surface-2"
            >
              <MessageCircle className="h-3.5 w-3.5" aria-hidden /> WhatsApp
            </a>
            <a
              href={approvalPath(activeLink.token)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-border px-3 text-xs font-medium text-foreground hover:bg-surface-2"
            >
              <ExternalLink className="h-3.5 w-3.5" aria-hidden /> Önizle
            </a>
            <Button variant="danger" className="min-h-9 px-3 text-xs" disabled={busy} onClick={() => withdraw(activeLink.id)}>
              <Undo2 className="h-3.5 w-3.5" aria-hidden /> Geri çek
            </Button>
          </div>
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button className="min-h-9 px-3 text-xs" loading={busy} disabled={unsaved} onClick={send}>
          {latest ? <RotateCcw className="h-3.5 w-3.5" aria-hidden /> : <Send className="h-3.5 w-3.5" aria-hidden />}
          {latest ? "Yeniden gönder" : "Onaya gönder"}
        </Button>
        {latest && <span className="text-[11px] text-muted">Yeni sürüm (v{latest.version + 1}) ve yeni bağlantı oluşturur{activeLink ? "; mevcut bağlantı geçersiz olur" : ""}.</span>}
      </div>
      {unsaved && <p className="mt-2 rounded-lg bg-warning/10 px-3 py-2 text-xs text-warning">Kaydedilmemiş değişiklikler var. Onaya kayıtlı metin gider: önce kaydedin, sonra düzenleyip gönderin.</p>}
      {!unsaved && !content.script?.trim() && <p className="mt-2 text-xs text-warning">Senaryo boş: onaylayan yalnızca başlığı görür.</p>}
      {!supabase && <p className="mt-2 text-[11px] text-muted">Demo modu: yeni bağlantılar yalnızca bu tarayıcı oturumunda tutulur ve herkese açık sayfada açılmaz; örnek bağlantılar açılır.</p>}

      {versions.length > 0 && (
        <ol className="mt-3 space-y-2" aria-label="Onay sürümleri">
          {versions.map((a, i) => {
            const st = effectiveStatus(a, now, i > 0);
            return (
              <li key={a.id} className="rounded-lg border border-border bg-background p-2.5 text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-foreground">v{a.version}</span>
                  <Badge tone={approvalStatus[st].tone}>{approvalStatus[st].label}</Badge>
                  <span className="ml-auto text-muted">{checkedCount(a.checklist)}/{a.checklist?.length ?? 0} madde</span>
                </div>
                <p className="mt-1 text-muted">Gönderim: {dateTimeTR(a.sent_at)}</p>
                {a.decided_at && (
                  <p className="text-muted">Karar: <span className="text-foreground">{a.decided_by_name}</span> · {dateTimeTR(a.decided_at)}</p>
                )}
                {a.note && <p className="mt-1 whitespace-pre-wrap rounded bg-surface-2/60 px-2 py-1 text-foreground">“{a.note}”</p>}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
