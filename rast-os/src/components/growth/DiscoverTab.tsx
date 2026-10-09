"use client";

import { useMemo, useRef, useState } from "react";
import { FileUp, Globe, ListPlus, Search, Sparkles, Star } from "lucide-react";
import { Button, Field, Input, Select } from "@/components/form";
import { Badge, EmptyState, Panel } from "@/components/ui";
import { useStore } from "@/lib/store";
import { useToasts } from "@/lib/toast";
import { apiPost, enrichProspects, importTargetClinics, mergeDiscovered, setProspectStatus } from "@/lib/growth/client";
import type { GrowthStatus } from "@/lib/growth/client";
import type { LivePlace } from "@/lib/growth/logic";
import type { Prospect, ScoreItem } from "@/lib/types";
import { GoogleAttribution, ScoreBadge, prospectStatusLabel } from "./GrowthChrome";
import { SequencePicker } from "./SequencePicker";

interface DiscoverResult {
  place: LivePlace & { lat?: number; lng?: number };
  prospectId: string | null;
  score: number;
  breakdown: ScoreItem[];
}

const PRESETS = ["diş kliniği", "dermatoloji kliniği", "göz merkezi", "mobilya mağazası", "ev tekstili", "inşaat firması", "emlak ofisi"];

/** Keşfet: Places araması (sonuçlar CANLI — yalnızca bu bileşenin durumunda; sayfadan çıkınca gider). */
export function DiscoverTab({ status }: { status: GrowthStatus | null }) {
  const prospects = useStore((s) => s.prospects);
  const [form, setForm] = useState({ query: "diş kliniği", city: "Sakarya", district: "", max: "20" });
  const [results, setResults] = useState<DiscoverResult[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [picker, setPicker] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const toast = useToasts.getState().push;

  const byId = useMemo(() => new Map(prospects.map((p) => [p.id, p])), [prospects]);
  const byExt = useMemo(() => new Map(prospects.filter((p) => p.external_id).map((p) => [p.external_id!, p])), [prospects]);
  const rowProspect = (r: DiscoverResult) => (r.prospectId ? byId.get(r.prospectId) : undefined) ?? byExt.get(r.place.placeId);
  const selectedProspects = (results ?? []).filter((r) => selected.has(r.place.placeId)).map(rowProspect).filter((p): p is Prospect => Boolean(p));

  async function search(e: React.FormEvent) {
    e.preventDefault();
    setBusy("search");
    const r = await apiPost<{ results: DiscoverResult[]; prospects: Prospect[]; mode: string }>("/api/growth/discover", {
      query: form.query, city: form.city, district: form.district || undefined, max: Number(form.max),
    });
    setBusy(null);
    if (!r.ok) return toast({ message: r.error, tone: "danger" });
    mergeDiscovered(r.data.prospects);
    setResults(r.data.results);
    setSelected(new Set());
    toast({ message: `${r.data.results.length} sonuç${r.data.mode === "mock" ? " (örnek veri)" : ""}` });
  }

  async function qualify() {
    const r = await setProspectStatus(selectedProspects.filter((p) => p.status === "new").map((p) => p.id), "qualified");
    toast(r.ok ? { message: "Kalifiye edildi — Bugün listesine girebilir" } : { message: `Hata: ${r.error}`, tone: "danger" });
  }

  async function enrich() {
    setBusy("enrich");
    const r = await enrichProspects(selectedProspects);
    setBusy(null);
    toast(r.error ? { message: `Tarama hatası: ${r.error}`, tone: "danger" } : { message: `${r.updated} site tarandı, ${r.emails} yeni e-posta` });
  }

  async function importCsv(text?: string) {
    setBusy("csv");
    const r = await importTargetClinics(text);
    setBusy(null);
    toast(r.error ? { message: `İçe aktarılamadı: ${r.error}`, tone: "danger" } : { message: `${r.added} aday eklendi (kalifiye), ${r.skipped} zaten vardı` });
  }

  const all = results?.length ? results.every((r) => selected.has(r.place.placeId)) : false;
  const toggle = (id: string) => setSelected((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  });

  return (
    <div className="space-y-4">
      <Panel
        title="Google Haritalar'da işletme ara"
        action={status && <Badge tone={status.places === "google" ? "success" : "muted"}>{status.places === "google" ? "Google Places" : "Örnek veri (API anahtarı yok)"}</Badge>}
      >
        <form onSubmit={search} className="grid grid-cols-1 gap-3 sm:grid-cols-[2fr_1fr_1fr_6rem_auto] sm:items-end">
          <Field label="Ne arıyorsunuz?">
            <Input list="growth-presets" value={form.query} onChange={(e) => setForm({ ...form, query: e.target.value })} required minLength={2} maxLength={80} />
            <datalist id="growth-presets">{PRESETS.map((p) => <option key={p} value={p} />)}</datalist>
          </Field>
          <Field label="İl"><Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} required minLength={2} maxLength={40} /></Field>
          <Field label="İlçe (isteğe bağlı)"><Input value={form.district} onChange={(e) => setForm({ ...form, district: e.target.value })} maxLength={40} /></Field>
          <Field label="En fazla">
            <Select value={form.max} onChange={(e) => setForm({ ...form, max: e.target.value })}>
              {["10", "20", "40", "60"].map((n) => <option key={n}>{n}</option>)}
            </Select>
          </Field>
          <Button type="submit" loading={busy === "search"}><Search className="h-4 w-4" aria-hidden /> Ara</Button>
        </form>
        <p className="mt-2 text-xs text-muted">
          Her arama 20 sonuçluk sayfa başına bir Text Search isteğidir (ücretli SKU). Sonuçlardaki ad / adres / telefon / puan saklanmaz;
          yalnızca place_id ve puan kaydedilir.
        </p>
      </Panel>

      {results && (
        <section aria-label="Arama sonuçları" className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <label className="mr-2 inline-flex items-center gap-2 text-sm text-muted">
              <input type="checkbox" checked={all} onChange={() => setSelected(all ? new Set() : new Set(results.map((r) => r.place.placeId)))} className="h-4 w-4 accent-[var(--accent)]" />
              Tümünü seç ({selected.size}/{results.length})
            </label>
            <Button variant="ghost" disabled={selected.size === 0} onClick={qualify}><Star className="h-4 w-4" aria-hidden /> Kalifiye et</Button>
            <Button variant="ghost" disabled={selected.size === 0} loading={busy === "enrich"} onClick={enrich}><Globe className="h-4 w-4" aria-hidden /> Siteleri tara</Button>
            <Button variant="ghost" disabled={selected.size === 0} onClick={() => setPicker(true)}><ListPlus className="h-4 w-4" aria-hidden /> Diziye ekle</Button>
            <GoogleAttribution className="ml-auto" />
          </div>
          {results.length === 0 ? (
            <EmptyState title="Sonuç yok" hint="Aramayı genişletin (ilçeyi boş bırakın ya da farklı bir ifade deneyin)." />
          ) : (
            <ul className="card divide-y divide-border/60">
              {results.map((r) => {
                const p = rowProspect(r);
                const host = r.place.website ? r.place.website.replace(/^https?:\/\/(www\.)?/, "").replace(/\/.*$/, "") : null;
                return (
                  <li key={r.place.placeId} className="flex items-start gap-3 px-3 py-2.5">
                    <input type="checkbox" aria-label={`Seç: ${r.place.name ?? r.place.placeId}`} checked={selected.has(r.place.placeId)} onChange={() => toggle(r.place.placeId)} className="mt-1 h-4 w-4 accent-[var(--accent)]" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-foreground">{r.place.name ?? "—"}</p>
                      <p className="truncate text-xs text-muted">{r.place.address ?? ""}</p>
                      <p className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-muted">
                        {typeof r.place.rating === "number" && <span>★ {r.place.rating.toLocaleString("tr-TR")} ({r.place.reviewsCount ?? 0})</span>}
                        {r.place.phone && <span>{r.place.phone}</span>}
                        {host && <a href={r.place.website} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">{host}</a>}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <ScoreBadge score={r.score} breakdown={r.breakdown} />
                      {p && <Badge tone={prospectStatusLabel[p.status].tone}>{prospectStatusLabel[p.status].label}</Badge>}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      <Panel title="Listeden içe aktar">
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => importCsv()} loading={busy === "csv"}><Sparkles className="h-4 w-4" aria-hidden /> Hedef klinik listesini aktar (18)</Button>
          <Button variant="ghost" onClick={() => fileRef.current?.click()}><FileUp className="h-4 w-4" aria-hidden /> CSV yükle</Button>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              if (file.size > 1_000_000) return toast({ message: "CSV en fazla 1 MB olabilir", tone: "danger" });
              await importCsv(await file.text());
            }}
          />
        </div>
        <p className="mt-2 text-xs text-muted">
          Elle araştırılmış liste (Firma adı, Kaynak, Instagram, Web sitesi, İlgilendiği hizmet, Notlar sütunları; şehir notta
          &quot;Şehir: Sakarya / Serdivan&quot;). Adaylar doğrudan <strong className="text-foreground">kalifiye</strong> gelir ve Bugün listesine girer.
        </p>
      </Panel>

      {picker && <SequencePicker prospects={selectedProspects} onClose={() => setPicker(false)} />}
    </div>
  );
}
