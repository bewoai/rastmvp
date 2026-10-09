"use client";

import Link from "next/link";
import { ShieldCheck, Sun, Radar } from "lucide-react";
import { Badge } from "@/components/ui";
import type { OutreachMessage, Prospect, ScoreItem } from "@/lib/types";

type Tone = "default" | "accent" | "success" | "warning" | "danger" | "muted";

export const prospectStatusLabel: Record<Prospect["status"], { label: string; tone: Tone }> = {
  new: { label: "Yeni", tone: "muted" },
  qualified: { label: "Kalifiye", tone: "accent" },
  queued: { label: "Dizide", tone: "default" },
  contacted: { label: "Temas edildi", tone: "default" },
  replied: { label: "Yanıt verdi", tone: "success" },
  converted: { label: "Müşteri oldu", tone: "success" },
  suppressed: { label: "Listeden çıkarıldı", tone: "danger" },
};

export const PROSPECT_STATUSES = Object.keys(prospectStatusLabel) as Prospect["status"][];

export const messageStatusLabel: Record<OutreachMessage["status"], { label: string; tone: Tone }> = {
  draft: { label: "Taslak", tone: "muted" },
  approved: { label: "Onaylandı", tone: "accent" },
  scheduled: { label: "Gönderimde", tone: "warning" },
  sent: { label: "Gönderildi", tone: "default" },
  bounced: { label: "Teslim edilemedi", tone: "danger" },
  replied: { label: "Yanıt geldi", tone: "success" },
  cancelled: { label: "İptal", tone: "muted" },
};

export const channelLabel: Record<OutreachMessage["channel"], string> = {
  email: "E-posta",
  phone: "Telefon",
  whatsapp: "WhatsApp",
  instagram: "Instagram DM",
};

export const sourceLabel: Record<Prospect["source"], string> = { places: "Google", csv: "CSV", manuel: "Manuel" };

/** KVKK aydınlatma metni bağlantısı (sahip doğrulamalı). */
export const KVKK_URL = "https://rastcreative.com/kvkk";
/** Mevzuat notu (vault; diğer ajan yazıyor). */
export const VAULT_NOTE = "07-Research/soguk-erisim-mevzuati.md";

/** Google Maps Platform atfı: Places verisi gösterilen her yerde (harita olmadan) "Google Maps" metni. */
export function GoogleAttribution({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] text-muted ${className}`} translate="no">
      Kaynak: <span className="font-medium text-foreground/80">Google Maps</span>
    </span>
  );
}

export function ScoreBadge({ score, breakdown }: { score: number; breakdown?: ScoreItem[] }) {
  const tone: Tone = score >= 70 ? "success" : score >= 50 ? "accent" : score >= 30 ? "default" : "muted";
  if (!breakdown?.length) return <Badge tone={tone}>{score}</Badge>;
  return (
    <details className="group relative inline-block">
      <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden" aria-label={`Puan ${score} — dökümü göster`}>
        <Badge tone={tone}>{score}</Badge>
      </summary>
      <div className="absolute left-0 z-20 mt-1 w-64 popover p-3 text-xs">
        <p className="mb-2 font-medium text-foreground">Puan dökümü · {score}/100</p>
        <ul className="space-y-1">
          {breakdown.map((i) => (
            <li key={i.key} className="flex justify-between gap-2">
              <span className="text-muted">{i.label} <span className="text-muted/70">({i.detail})</span></span>
              <span className="shrink-0 tabular-nums text-foreground">{i.points}/{i.max}</span>
            </li>
          ))}
        </ul>
      </div>
    </details>
  );
}

/** Modül başlığındaki uyum paneli (Türkçe, temkinli). Hukuki görüş yerine geçmez. */
export function CompliancePanel({ dailyCap, emailEnabled }: { dailyCap?: number; emailEnabled?: boolean }) {
  return (
    <details className="card mb-4 overflow-hidden text-sm">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 font-medium text-foreground [&::-webkit-details-marker]:hidden">
        <ShieldCheck className="h-4 w-4 text-muted" aria-hidden />
        Uyum notları — ticari ileti, İYS, ret hakkı, KVKK
        <span className="ml-auto text-xs font-normal text-muted">aç / kapat</span>
      </summary>
      <div className="grid gap-3 border-t border-border/70 px-4 py-3 text-[13px] leading-5 text-muted md:grid-cols-2">
        <p>
          <strong className="text-foreground">B2B ticari ileti.</strong> Yalnızca işletmelerin herkese açık kurumsal iletişim
          kanallarına, işle ilgili, kısa ve kim olduğumuzu açıkça söyleyen mesajlar. Bireylere (tüketicilere) yazılmaz.
        </p>
        <p>
          <strong className="text-foreground">İYS ve onay.</strong> E-posta / SMS ile ticari elektronik ileti için İYS kaydı ve
          onay / ret yönetimi gerekir; esnaf ve tacirlere yönelik istisnaların kapsamı için hukuki görüş alın.
          E-posta gönderimi {emailEnabled ? <span className="text-warning">AÇIK</span> : <span className="text-foreground">İYS kaydı tamamlanana kadar kapalı</span>}.
        </p>
        <p>
          <strong className="text-foreground">Ret hakkı.</strong> Her iletide kolay ret yolu vardır; &quot;istemiyorum&quot; diyen
          işletme <em>İlgilenmiyor</em> ile ret listesine alınır ve bir daha aranmaz / yazılmaz. E-postalarda tek tıkla ret bağlantısı.
        </p>
        <p>
          <strong className="text-foreground">KVKK.</strong> Kişisel veri en az düzeyde (yetkili adı, cep telefonu yalnızca gerekirse).{" "}
          <a href={KVKK_URL} target="_blank" rel="noreferrer" className="text-accent underline-offset-2 hover:underline">Aydınlatma metni</a>.
          Google Places verisi saklanmaz; gösterimde canlı çekilir.
        </p>
        <p>
          <strong className="text-foreground">WhatsApp / Instagram.</strong> Otomatik gönderim yok: uygulama yalnızca hazır metinle
          bağlantı açar, mesajı siz gönderirsiniz. Platform kuralları gereği toplu / tekrarlı mesaj atmayın; günde ~10 kişi.
        </p>
        <p>
          <strong className="text-foreground">Günlük limit.</strong> E-posta: günde en fazla {dailyCap ?? 20} ileti (DAILY_SEND_CAP).
          Ayrıntılı not: <code className="rounded bg-surface-2 px-1 text-[12px] text-foreground">{VAULT_NOTE}</code> (vault).
        </p>
      </div>
    </details>
  );
}

/** Modül içi gezinme (Bugün ↔ Müşteri Bulma). */
export function GrowthNav({ active }: { active: "bugun" | "modul" }) {
  const cls = (on: boolean) =>
    `inline-flex min-h-10 items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${on ? "border border-[#3a3a3a] bg-surface-2 text-foreground" : "border border-border text-muted hover:bg-surface-2 hover:text-foreground"}`;
  return (
    <nav aria-label="Müşteri Bulma" className="flex flex-wrap gap-2">
      <Link href="/musteri-bulma/bugun" prefetch={false} className={cls(active === "bugun")} aria-current={active === "bugun" ? "page" : undefined}>
        <Sun className="h-4 w-4" aria-hidden /> Bugün
      </Link>
      <Link href="/musteri-bulma" prefetch={false} className={cls(active === "modul")} aria-current={active === "modul" ? "page" : undefined}>
        <Radar className="h-4 w-4" aria-hidden /> Keşfet ve yönet
      </Link>
    </nav>
  );
}
