"use client";

import { PageHeader, Panel, Badge } from "@/components/ui";
import { Button, Field, Input } from "@/components/form";
import { useStore } from "@/lib/store";
import { useFx } from "@/lib/fx";

const roles = [
  { name: "Yönetici", desc: "Tüm müşteriler, finans, teklifler, raporlar, ekip, ayarlar" },
  { name: "Proje Yöneticisi", desc: "Müşteriler, projeler, içerikler, görevler, çekimler" },
  { name: "Editör / Tasarımcı", desc: "Kendine atanan işler, dosyalar, revizyonlar, teslim tarihleri" },
  { name: "Muhasebe", desc: "Gelir, gider, fatura, tahsilat" },
  { name: "Müşteri", desc: "Yalnızca kendi markası, onaylar, dosyalar, faturalar, raporlar" },
];

export default function SettingsPage() {
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

        <Panel title="Döviz Kurları">
          <p className="text-sm text-muted">
            USD/EUR cinsinden girilen giderler (ör. yazılım abonelikleri) bu kurlarla
            TL&apos;ye çevrilir. Kuru güncelleyince tüm dolar/euro giderlerin TL karşılığı
            otomatik güncellenir.
          </p>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <Field label="USD/TRY">
              <Input type="number" min="0.01" step="0.01" value={usd} onChange={(e) => setRate("usd", Number(e.target.value))} />
            </Field>
            <Field label="EUR/TRY">
              <Input type="number" min="0.01" step="0.01" value={eur} onChange={(e) => setRate("eur", Number(e.target.value))} />
            </Field>
          </div>
          {updated && <p className="mt-2 text-xs text-muted">Son güncelleme: {updated}</p>}
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
