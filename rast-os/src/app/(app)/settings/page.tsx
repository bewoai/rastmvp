"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowRight } from "lucide-react";
import { PageHeader, Panel, Badge } from "@/components/ui";
import { Button, Field, Input } from "@/components/form";
import { useStore, useHydrated } from "@/lib/store";
import { useFx } from "@/lib/fx";
import { DEFAULT_MRR_LABEL, useOrgTargets } from "@/lib/orgSettings";
import { useToasts } from "@/lib/toast";

/**
 * Kur alanı: yazılan metin yerel taslakta tutulur, geçerli (>0) sayı olunca hemen kaydedilir.
 * Eskiden değer doğrudan store'a bağlıydı ve geçersiz/boş giriş yok sayıldığı için alan silinemiyor,
 * "46" → "50" yazmak için önce 46'nın üzerine tek tek yazmak gerekiyordu. Blur'da geçersizse eski değer döner.
 */
function RateInput({ value, onCommit, label }: { value: number; onCommit: (n: number) => void; label: string }) {
  const [draft, setDraft] = useState(String(value));
  return (
    <Field label={label}>
      <Input
        type="text"
        inputMode="decimal"
        value={draft}
        onChange={(e) => {
          const text = e.target.value;
          setDraft(text);
          const n = Number(text.replace(",", "."));
          if (text.trim() !== "" && Number.isFinite(n) && n > 0) onCommit(n);
        }}
        onBlur={() => setDraft(String(value))}
      />
    </Field>
  );
}

/** MRR eşiği (hastaneden ayrılma hedefi): org başına tutar + ad. Supabase'de yalnızca yönetici kaydedebilir. */
function MrrTargetForm({ hydrated }: { hydrated: boolean }) {
  const { loaded, target, label, canEdit, save } = useOrgTargets(hydrated);
  const push = useToasts((s) => s.push);
  // Yerel taslak: kayıtlı değer değişince (yükleme / başka sekme) taslak o değere döner.
  const saved = `${target ?? ""}|${label}`;
  const [draftKey, setDraftKey] = useState(saved);
  const [amount, setAmount] = useState(target === null ? "" : String(target));
  const [name, setName] = useState(label);
  const [busy, setBusy] = useState(false);
  if (draftKey !== saved) {
    setDraftKey(saved);
    setAmount(target === null ? "" : String(target));
    setName(label);
  }

  const parsed = amount.trim() === "" ? null : Number(amount.replace(/\./g, "").replace(",", "."));
  const invalid = parsed !== null && (!Number.isFinite(parsed) || parsed < 0);
  const dirty = saved !== `${parsed ?? ""}|${name.trim() || DEFAULT_MRR_LABEL}`;

  async function onSave() {
    if (invalid) return;
    setBusy(true);
    const r = await save(parsed === 0 ? null : parsed, name);
    setBusy(false);
    push(r.ok ? { message: "Eşik kaydedildi." } : { message: r.error ?? "Kaydedilemedi.", tone: "danger" });
  }

  return (
    <div id="mrr-esigi" className="scroll-mt-20">
      <Panel title="MRR Eşiği">
        <p className="text-sm text-muted">
          Dashboard&apos;daki aylık tekrarlayan gelir (MRR) kartının hedefi — ör. hastaneden ayrılmak için
          gereken aylık gelir. Tutar KDV hariç, TL cinsindendir. Boş bırakırsan hedef kaldırılır.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Field label="Hedef tutar (₺ / ay)" hint={invalid ? "Geçerli bir tutar gir." : undefined}>
            <Input
              type="text"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              disabled={!loaded || !canEdit}
              placeholder="ör. 90000"
              aria-invalid={invalid || undefined}
            />
          </Field>
          <Field label="Hedefin adı">
            <Input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} disabled={!loaded || !canEdit} placeholder={DEFAULT_MRR_LABEL} />
          </Field>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button onClick={onSave} loading={busy} disabled={!loaded || !canEdit || invalid || !dirty}>Kaydet</Button>
          {loaded && !canEdit && <span className="text-xs text-muted">Eşiği yalnızca yönetici değiştirebilir.</span>}
        </div>
      </Panel>
    </div>
  );
}

const roles = [
  { name: "Yönetici", desc: "Tüm müşteriler, finans, teklifler, raporlar, ekip, ayarlar" },
  { name: "Proje Yöneticisi", desc: "Müşteriler, projeler, içerikler, görevler, çekimler" },
  { name: "Editör / Tasarımcı", desc: "Kendine atanan işler, dosyalar, revizyonlar, teslim tarihleri" },
  { name: "Muhasebe", desc: "Gelir, gider, fatura, tahsilat" },
  { name: "Müşteri", desc: "Yalnızca kendi markası, onaylar, dosyalar, faturalar, raporlar" },
];

export default function SettingsPage() {
  // Yalnızca oturum/mod bilgisi için init (koleksiyon yüklenmez). Bu olmadan Ayarlar ilk açılan sayfaysa
  // "Yerel (demo)" yanlış gösteriliyordu.
  const hydrated = useHydrated();
  const supabase = useStore((s) => s.supabase);
  const { usd, eur, updated, setRate } = useFx();

  return (
    <>
      <PageHeader title="Ayarlar" subtitle="Roller, veri ve sistem bilgisi" />

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Roller ve Yetkiler">
          <ul className="space-y-3">
            {roles.map((r) => (
              <li key={r.name} className="flex items-start gap-3">
                <Badge tone="amber">{r.name}</Badge>
                <span className="text-sm text-muted">{r.desc}</span>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-xs text-muted">
            Rol bazlı erişim, Supabase bağlandığında veritabanı (RLS) seviyesinde
            uygulanır. Şema hazır: <code>0001_init.sql</code>.
          </p>
        </Panel>

        <Panel title="Veri Yönetimi">
          {supabase ? (
            <>
              <p className="text-sm text-muted">
                Veriler <strong className="text-foreground">Supabase</strong> veritabanında
                kalıcı olarak tutuluyor.
              </p>
              <p className="mt-4 rounded-lg border border-border bg-surface-2/50 px-3 py-2 text-xs text-muted">
                Canlı veritabanında toplu örnek veri yükleme kapalı. Veri eklemek için ilgili
                modüllerdeki formları veya İçeri Aktar ekranını kullan.
              </p>
            </>
          ) : (
            <p className="text-sm text-muted">
              Şu anda veriler tarayıcının yerel deposunda tutuluyor (demo modu). Veri
              sıfırlama işlemi bu ekrandan kapalıdır.
            </p>
          )}
        </Panel>

        <MrrTargetForm hydrated={hydrated} />

        <Panel title="Döviz Kurları">
          <p className="text-sm text-muted">
            USD/EUR cinsinden girilen giderler (ör. yazılım abonelikleri) bu kurlarla
            TL&apos;ye çevrilir. Kuru güncelleyince tüm dolar/euro giderlerin TL karşılığı
            otomatik güncellenir.
          </p>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <RateInput label="USD/TRY" value={usd} onCommit={(n) => setRate("usd", n)} />
            <RateInput label="EUR/TRY" value={eur} onCommit={(n) => setRate("eur", n)} />
          </div>
          {updated && <p className="mt-2 text-xs text-muted">Son güncelleme: {updated}</p>}
        </Panel>

        <Panel title="İşlem Geçmişi">
          <p className="text-sm text-muted">
            Müşteri, proje, iş, görev, fatura, tahsilat, gider ve tekliflerdeki her ekleme,
            güncelleme ve silme kim tarafından, ne zaman yapıldığıyla birlikte otomatik kaydedilir.
          </p>
          <Link
            prefetch={false}
            href="/settings/islem-gecmisi"
            className="mt-4 inline-flex items-center gap-1.5 rounded-lg text-sm font-medium text-amber outline-none hover:text-amber-hi focus-visible:ring-2 focus-visible:ring-amber/60"
          >
            İşlem geçmişini aç <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        </Panel>

        <Panel title="Sistem">
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between"><dt className="text-muted">Sürüm</dt><dd className="text-foreground">v0.1 MVP</dd></div>
            <div className="flex justify-between">
              <dt className="text-muted">Veri modu</dt>
              <dd className="text-foreground">{supabase ? "Supabase (canlı)" : "Yerel (demo)"}</dd>
            </div>
            <div className="flex justify-between"><dt className="text-muted">Backend</dt><dd className="text-foreground">Supabase</dd></div>
          </dl>
          {supabase && (
            <form action="/auth/signout" method="post" className="mt-4">
              <Button variant="ghost" type="submit">Çıkış yap</Button>
            </form>
          )}
        </Panel>
      </div>
    </>
  );
}
