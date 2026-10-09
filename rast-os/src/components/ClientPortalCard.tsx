"use client";

import { useMemo, useState } from "react";
import { Check, Copy, ExternalLink, Globe, Link2, MessageCircle, Plus, Ban } from "lucide-react";
import { Badge } from "@/components/ui";
import { Button, Field, Input } from "@/components/form";
import { ConfirmDialog } from "@/components/confirm";
import { useStore, nowISO } from "@/lib/store";
import { useToasts } from "@/lib/toast";
import { dateTimeTR } from "@/lib/labels";
import { whatsappShareUrl } from "@/lib/approval-logic";
import { portalPath, portalShareText, portalTokenState } from "@/lib/portal-logic";
import { createPortalLink, revokePortalLink } from "@/lib/portalActions";
import type { Client, ClientPortalToken } from "@/lib/types";

const toast = (message: string, tone: "default" | "danger" = "default") => useToasts.getState().push({ message, tone });

const linkBtn =
  "inline-flex min-h-9 items-center gap-2 rounded-lg border border-border px-3 text-xs font-medium text-foreground hover:bg-surface-2";

/**
 * Müşteri sayfasındaki "Portal" kartı: hesapsız, salt okunur müşteri portalı (/portal/<token>) için gizli
 * bağlantı oluştur, kopyala, WhatsApp'la gönder, iptal et; son görüntülenmeyi göster. Token sunucuda
 * üretilir (0018); iptal geri alınamaz.
 */
export function ClientPortalCard({ client }: { client: Pick<Client, "id" | "name"> }) {
  const all = useStore((s) => s.client_portal_tokens);
  const supabase = useStore((s) => s.supabase);
  // Sabit "şimdi" (render saf kalır); oluşturma / iptalden sonra yenilenir.
  const [now, setNow] = useState(() => nowISO());
  const [label, setLabel] = useState("");
  const [contact, setContact] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ClientPortalToken | null>(null);

  const { active, inactive } = useMemo(() => {
    const own = all
      .filter((t) => t.client_id === client.id)
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    return {
      active: own.filter((t) => portalTokenState(t, now) === "active"),
      inactive: own.filter((t) => portalTokenState(t, now) !== "active"),
    };
  }, [all, client.id, now]);

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const urlOf = (t: ClientPortalToken) => `${origin}${portalPath(t.token)}`;

  async function create() {
    setBusy(true);
    const r = await createPortalLink(client.id, { label, contactLine: contact });
    setBusy(false);
    if (!r.ok) {
      toast(r.error ? `Portal bağlantısı oluşturulamadı: ${r.error}` : "Portal bağlantısı oluşturulamadı", "danger");
      return;
    }
    setLabel("");
    setContact("");
    setCopied(null);
    setNow(nowISO());
    toast("Portal bağlantısı oluşturuldu");
  }

  async function revoke(t: ClientPortalToken) {
    setConfirm(null);
    setBusy(true);
    const r = await revokePortalLink(t.id);
    setBusy(false);
    setNow(nowISO());
    toast(r.ok ? "Portal bağlantısı iptal edildi" : `İptal edilemedi: ${r.error ?? ""}`, r.ok ? "default" : "danger");
  }

  async function copy(t: ClientPortalToken) {
    try {
      await navigator.clipboard.writeText(urlOf(t));
      setCopied(t.id);
      toast("Bağlantı kopyalandı");
    } catch {
      toast("Kopyalanamadı — bağlantıyı seçip elle kopyalayın.", "danger");
    }
  }

  return (
    <section aria-labelledby="portal-card-title" className="card p-4">
      <div className="flex items-center gap-2">
        <Globe className="h-4 w-4 text-muted" aria-hidden />
        <h2 id="portal-card-title" className="text-sm font-semibold text-foreground">Portal</h2>
        <span className="ml-auto">
          <Badge tone={active.length ? "success" : "muted"}>{active.length ? `${active.length} aktif bağlantı` : "Bağlantı yok"}</Badge>
        </span>
      </div>
      <p className="mt-1 text-xs text-muted">
        Müşteri giriş yapmadan bu ay ve geçen ayın içeriklerini, çekim günlerini, onay bekleyen içerikleri ve kayıtlı aylık
        raporları görür. Bağlantıya sahip olan herkes bu bilgileri görür ve bekleyen içerikleri onaylayabilir: yalnızca
        hekime / yetkili kişiye birebir gönderin.
      </p>

      {active.length > 0 && (
        <ul className="mt-3 space-y-3" aria-label="Aktif portal bağlantıları">
          {active.map((t) => (
            <li key={t.id} className="rounded-lg border border-border bg-surface-2/50 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Link2 className="h-3.5 w-3.5 text-muted" aria-hidden />
                <p className="text-xs font-medium text-foreground">{t.label?.trim() || "Portal bağlantısı"}</p>
                <span className="ml-auto text-[11px] text-muted">Oluşturuldu: {dateTimeTR(t.created_at)}</span>
              </div>
              <p className="mt-1.5 select-all break-all font-mono text-xs text-foreground">{urlOf(t)}</p>
              <p className="mt-1 text-[11px] text-muted">
                {t.last_seen_at ? <>Son görüntülenme: <span className="text-foreground">{dateTimeTR(t.last_seen_at)}</span></> : "Henüz açılmadı"}
                {t.expires_at ? <> · {dateTimeTR(t.expires_at)} tarihine kadar geçerli</> : " · Süresiz (iptal edilene kadar)"}
              </p>
              {t.contact_line?.trim() && <p className="mt-0.5 text-[11px] text-muted">İletişim satırı: {t.contact_line}</p>}
              <div className="mt-2 flex flex-wrap gap-2">
                <Button variant="ghost" className="min-h-9 px-3 text-xs" onClick={() => copy(t)}>
                  {copied === t.id ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
                  {copied === t.id ? "Kopyalandı" : "Kopyala"}
                </Button>
                <a
                  href={whatsappShareUrl(portalShareText({ clientName: client.name, url: urlOf(t) }))}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={linkBtn}
                >
                  <MessageCircle className="h-3.5 w-3.5" aria-hidden /> WhatsApp
                </a>
                <a href={portalPath(t.token)} target="_blank" rel="noopener noreferrer" className={linkBtn}>
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden /> Önizle
                </a>
                <Button variant="danger" className="min-h-9 px-3 text-xs" disabled={busy} onClick={() => setConfirm(t)}>
                  <Ban className="h-3.5 w-3.5" aria-hidden /> İptal et
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Kime / nereden gönderildi (iç not)">
          <Input value={label} maxLength={120} placeholder="Ör. Dr. Kemal Sarı — WhatsApp" onChange={(e) => setLabel(e.target.value)} />
        </Field>
        <Field label="Portalda görünecek iletişim satırı">
          <Input value={contact} maxLength={200} placeholder="Ör. Rast Creative · Berat · 0532 …" onChange={(e) => setContact(e.target.value)} />
        </Field>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button className="min-h-9 px-3 text-xs" loading={busy} onClick={create}>
          <Plus className="h-3.5 w-3.5" aria-hidden /> {active.length ? "Yeni bağlantı oluştur" : "Bağlantı oluştur"}
        </Button>
        <span className="text-[11px] text-muted">İletişim satırı boşsa ajans adı ve bağlantıyı oluşturan kişinin adı gösterilir.</span>
      </div>
      {!supabase && (
        <p className="mt-2 text-[11px] text-muted">
          Demo modu: yeni bağlantılar yalnızca bu tarayıcı oturumunda tutulur ve herkese açık sayfada açılmaz; örnek bağlantı açılır.
        </p>
      )}

      {inactive.length > 0 && (
        <details className="mt-3 text-xs">
          <summary className="cursor-pointer text-muted">İptal edilen / süresi dolan bağlantılar ({inactive.length})</summary>
          <ul className="mt-2 space-y-1.5">
            {inactive.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-background px-2.5 py-2">
                <span className="text-foreground">{t.label?.trim() || "Portal bağlantısı"}</span>
                <Badge tone="muted">{t.revoked_at ? "İptal edildi" : "Süresi doldu"}</Badge>
                <span className="ml-auto text-muted">
                  {t.revoked_at ? `İptal: ${dateTimeTR(t.revoked_at)}` : `Bitiş: ${dateTimeTR(t.expires_at ?? undefined)}`}
                  {t.last_seen_at ? ` · Son görüntülenme: ${dateTimeTR(t.last_seen_at)}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {confirm && (
        <ConfirmDialog
          title="Portal bağlantısı iptal edilsin mi?"
          message={
            <>
              <strong className="text-foreground">{confirm.label?.trim() || "Bu bağlantı"}</strong> hemen çalışmaz hale gelir ve
              müşteri &ldquo;bulunamadı&rdquo; ekranını görür. İptal geri alınamaz; gerekirse yeni bağlantı oluşturup yeniden gönderin.
            </>
          }
          confirmLabel="İptal et"
          onConfirm={() => revoke(confirm)}
          onCancel={() => setConfirm(null)}
        />
      )}
    </section>
  );
}
