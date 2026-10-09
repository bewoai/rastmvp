"use client";

import { useState } from "react";
import { Plus, Sparkles, Trash2 } from "lucide-react";
import { Button, Field, FormModal, Input, Select, Textarea } from "@/components/form";
import { Badge, EmptyState } from "@/components/ui";
import { RowActions } from "@/components/list";
import { useDeleteConfirm } from "@/components/confirm";
import { useStore, uid, nowISO } from "@/lib/store";
import { useToasts } from "@/lib/toast";
import { DEFAULT_SEQUENCES, SECTORS, SECTOR_KEYS, TEMPLATE_TOKENS, renderTemplate } from "@/lib/growth/logic";
import type { OutreachSequence, SequenceStep } from "@/lib/types";

const SAMPLE = { isim: "Demo Diş Polikliniği", sektor: "diş kliniği", sehir: "Serdivan / Sakarya", site: "demodis.com.tr", rast_vaka_link: "https://rastcreative.com" };

export function SequencesTab() {
  const sequences = useStore((s) => s.outreach_sequences);
  const [edit, setEdit] = useState<OutreachSequence | null | "new">(null);
  const del = useDeleteConfirm();
  const missing = DEFAULT_SEQUENCES.filter((d) => !sequences.some((s) => s.sector === d.sector));

  async function addDefaults() {
    for (const d of missing) {
      const r = await useStore.getState().add("outreach_sequences", { id: uid(), name: d.name, sector: d.sector, channel: "email", steps: d.steps, active: true, created_at: nowISO() });
      if (!r.ok) return useToasts.getState().push({ message: `Eklenemedi: ${r.error}`, tone: "danger" });
    }
    useToasts.getState().push({ message: `${missing.length} varsayılan dizi eklendi` });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => setEdit("new")}><Plus className="h-4 w-4" aria-hidden /> Yeni dizi</Button>
        {missing.length > 0 && (
          <Button variant="ghost" onClick={addDefaults}><Sparkles className="h-4 w-4" aria-hidden /> Varsayılan şablonları ekle ({missing.map((m) => SECTORS[m.sector].label).join(", ")})</Button>
        )}
        <p className="basis-full text-xs text-muted">
          Belirteçler: {TEMPLATE_TOKENS.map((t) => <code key={t} className="mr-1 rounded bg-surface-2 px-1 text-foreground">{`{{${t}}}`}</code>)}
          — gösterimde ve gönderimde canlı veriyle doldurulur. Hekim şablonları reklam / ücretli tanıtım önermez; mevzuata uygun bilgilendirme içeriği anlatır.
        </p>
      </div>

      {sequences.length === 0 ? (
        <EmptyState title="Dizi yok" hint="Varsayılan şablonları ekleyerek başlayın (hekim / klinik, mobilya / perakende, inşaat / emlak)." />
      ) : (
        <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {sequences.map((s) => (
            <li key={s.id} className="card p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="truncate text-sm font-semibold text-foreground">{s.name}</h3>
                  <p className="mt-0.5 text-xs text-muted">{s.sector ? SECTORS[s.sector as keyof typeof SECTORS]?.label ?? s.sector : "—"} · {s.steps.length} adım · e-posta</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone={s.active ? "success" : "muted"}>{s.active ? "Etkin" : "Pasif"}</Badge>
                  <RowActions label={s.name} onEdit={() => setEdit(s)} onDelete={() => del.ask({ key: "outreach_sequences", id: s.id, label: s.name, warning: "Bu diziye bağlı mesajlar kalır (dizi bağı kaldırılır)." })} />
                </div>
              </div>
              <ol className="mt-3 space-y-1.5 text-xs">
                {s.steps.map((st, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="w-14 shrink-0 text-muted">{i + 1}. · {st.day}. gün</span>
                    <span className="truncate text-foreground">{renderTemplate(st.subject, SAMPLE).text}</span>
                  </li>
                ))}
              </ol>
            </li>
          ))}
        </ul>
      )}

      {edit && <SequenceModal initial={edit === "new" ? null : edit} onClose={() => setEdit(null)} />}
      {del.dialog}
    </div>
  );
}

function SequenceModal({ initial, onClose }: { initial: OutreachSequence | null; onClose: () => void }) {
  const [name, setName] = useState(initial?.name ?? "");
  const [sector, setSector] = useState(initial?.sector ?? "hekim");
  const [active, setActive] = useState(initial?.active ?? true);
  const [steps, setSteps] = useState<SequenceStep[]>(initial?.steps ?? [{ day: 0, subject: "", body: "" }]);
  const [preview, setPreview] = useState(0);

  const setStep = (i: number, patch: Partial<SequenceStep>) => setSteps((s) => s.map((st, j) => (j === i ? { ...st, ...patch } : st)));

  async function submit() {
    if (!name.trim()) return { ok: false, error: "Dizi adı zorunlu." };
    if (steps.length === 0 || steps.length > 10) return { ok: false, error: "1-10 adım olmalı." };
    for (const [i, st] of steps.entries()) {
      if (!st.subject.trim() || !st.body.trim()) return { ok: false, error: `${i + 1}. adımın konu ve gövdesi zorunlu.` };
      if (i > 0 && st.day <= steps[i - 1].day) return { ok: false, error: `${i + 1}. adımın günü öncekinden büyük olmalı.` };
      const unknown = renderTemplate(st.subject + st.body, {}).unknown;
      if (unknown.length) return { ok: false, error: `Tanınmayan belirteç: ${unknown.join(", ")}` };
    }
    const payload = { name: name.trim(), sector, active, steps: steps.map((s) => ({ day: Math.max(0, Math.round(s.day)), subject: s.subject.trim(), body: s.body.trim() })) };
    const st = useStore.getState();
    return initial ? st.update("outreach_sequences", initial.id, payload) : st.add("outreach_sequences", { ...payload, id: uid(), channel: "email", created_at: nowISO() });
  }

  const pv = steps[Math.min(preview, steps.length - 1)];
  return (
    <FormModal title={initial ? "Diziyi düzenle" : "Yeni dizi"} onClose={onClose} onSubmit={submit} size="xl" successMessage="Dizi kaydedildi">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[3fr_2fr]">
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="sm:col-span-2"><Field label="Ad *"><Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} /></Field></div>
            <Field label="Sektör">
              <Select value={sector} onChange={(e) => setSector(e.target.value)}>
                {SECTOR_KEYS.map((k) => <option key={k} value={k}>{SECTORS[k].label}</option>)}
              </Select>
            </Field>
          </div>
          <label className="inline-flex items-center gap-2 text-sm text-muted">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="h-4 w-4 accent-[var(--accent)]" /> Etkin (yeni taslak ve sonraki adımlar açılır)
          </label>
          {steps.map((st, i) => (
            <fieldset key={i} className="rounded-lg border border-border/70 p-3" onFocus={() => setPreview(i)}>
              <legend className="px-1 text-xs font-medium text-muted">{i + 1}. adım</legend>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-[6rem_1fr_auto] sm:items-end">
                <Field label="Gün"><Input type="number" min={0} max={90} value={st.day} onChange={(e) => setStep(i, { day: Number(e.target.value) })} /></Field>
                <Field label="Konu"><Input value={st.subject} onChange={(e) => setStep(i, { subject: e.target.value })} maxLength={300} /></Field>
                <Button variant="ghost" aria-label={`${i + 1}. adımı sil`} disabled={steps.length === 1} onClick={() => setSteps((s) => s.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" aria-hidden /></Button>
              </div>
              <div className="mt-2"><Field label="Gövde"><Textarea rows={6} value={st.body} onChange={(e) => setStep(i, { body: e.target.value })} maxLength={10000} /></Field></div>
            </fieldset>
          ))}
          <Button variant="ghost" disabled={steps.length >= 10} onClick={() => setSteps((s) => [...s, { day: (s.at(-1)?.day ?? 0) + 4, subject: "", body: "" }])}>
            <Plus className="h-4 w-4" aria-hidden /> Adım ekle
          </Button>
        </div>
        <aside className="rounded-lg border border-border/70 bg-background/40 p-3 text-sm">
          <p className="mb-2 text-xs font-medium text-muted">Önizleme · {Math.min(preview, steps.length - 1) + 1}. adım (örnek aday)</p>
          {pv && (
            <>
              <p className="font-medium text-foreground">{renderTemplate(pv.subject, SAMPLE).text || "—"}</p>
              <p className="mt-2 whitespace-pre-wrap text-[13px] leading-5 text-muted">{renderTemplate(pv.body, SAMPLE).text}</p>
              <p className="mt-3 border-t border-border/60 pt-2 text-[11px] text-muted">+ altbilgi: gönderen kimliği, iletişim nedeni (B2B) ve tek tıkla ret bağlantısı (otomatik eklenir)</p>
            </>
          )}
        </aside>
      </div>
    </FormModal>
  );
}
