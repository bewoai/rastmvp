"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronUp, FileDown, ShieldAlert, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui";
import { Button, Textarea } from "@/components/form";
import { useToasts } from "@/lib/toast";
import { contentStatus } from "@/lib/labels";
import {
  SCRIPT_SOURCE_CLAUDE_CODE, canAdvanceToScriptReady, clientMatches, draftToContentPatch, parseWritingDraft,
  type DraftPatch,
} from "@/lib/writing-draft";
import type { ContentStatus } from "@/lib/types";

const wordCount = (text: string) => text.replace(/\[[^\]]*\]/g, " ").split(/\s+/).filter(Boolean).length;

/**
 * İçerik düzenleyicide "Senaryo içe aktar": Claude Code'daki RAST-OS `senaryo-uret` komutunun yazdığı
 * writing-draft markdown'ını (yapıştırma veya .md dosyası) okur ve hook / script / caption alanlarına
 * aktarır. Yalnız FORMU doldurur; veritabanına "Kaydet" ile yazılır. Durum yalnız Brief → Senaryo hazır
 * ilerler ve açık doğrulama / mevzuat hatası varken ilerlemez (crm_sync ile aynı sözleşme).
 */
export function ScriptImportPanel({ status, scriptSource, clientName, onApply }: {
  status?: ContentStatus;
  scriptSource?: string | null;
  clientName?: string;
  onApply: (patch: DraftPatch) => void;
}) {
  const [open, setOpen] = useState(false);
  const [raw, setRaw] = useState("");
  const [fileError, setFileError] = useState("");
  const parsed = useMemo(() => (raw.trim() ? parseWritingDraft(raw) : null), [raw]);
  const draft = parsed?.ok ? parsed.draft : null;
  const mismatch = draft ? !clientMatches(draft.client, clientName) : false;
  const advances = draft ? status === "brief" && canAdvanceToScriptReady(draft) : false;
  const blocked = draft ? draft.regulationGate === "failed" || draft.verificationNotes !== undefined : false;

  async function readFile(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    setFileError("");
    if (file.size > 512 * 1024) {
      setFileError("Dosya çok büyük (en fazla 512 KB).");
      return;
    }
    try {
      setRaw(await file.text());
    } catch {
      setFileError("Dosya okunamadı.");
    }
  }

  function apply() {
    if (!draft) return;
    onApply(draftToContentPatch(draft, status));
    useToasts.getState().push({ message: "Taslak alanlara aktarıldı. Kalıcı olması için Kaydet'e basın." });
    setRaw("");
    setOpen(false);
  }

  return (
    <section aria-label="Senaryo içe aktar" className="rounded-xl border border-border bg-surface-2/40 p-4">
      <div className="flex items-center gap-2">
        <FileDown className="h-4 w-4 text-amber" aria-hidden />
        <h3 className="text-sm font-semibold text-foreground">Senaryo içe aktar</h3>
        {scriptSource === SCRIPT_SOURCE_CLAUDE_CODE && <span className="ml-auto"><Badge tone="amber">Claude Code</Badge></span>}
      </div>
      <p className="mt-1 text-xs text-muted">
        Claude Code&apos;da <span className="font-mono text-foreground">senaryo-uret</span> komutunun yazdığı taslağı (writing-draft .md) yapıştırın; hook, senaryo ve caption alanlarına aktarılır.
      </p>
      <Button variant="ghost" className="mt-3 min-h-9 px-3 text-xs" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {open ? <ChevronUp className="h-3.5 w-3.5" aria-hidden /> : <ChevronDown className="h-3.5 w-3.5" aria-hidden />}
        {open ? "Kapat" : "Taslağı yapıştır"}
      </Button>

      {open && (
        <div className="mt-3 space-y-3">
          <Textarea
            rows={8}
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            placeholder={"---\ntype: writing-draft\nclient: …\n---\n\n# Final Script\n…"}
            aria-label="Writing-draft markdown"
            className="font-mono text-xs"
            spellCheck={false}
          />
          <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-muted hover:text-foreground">
            <span className="rounded-lg border border-border px-2.5 py-1.5">.md dosyası seç</span>
            <input type="file" accept=".md,.markdown,.txt,text/markdown,text/plain" className="sr-only" onChange={(e) => { readFile(e.target.files); e.currentTarget.value = ""; }} />
          </label>
          {fileError && <p role="alert" className="text-xs text-danger">{fileError}</p>}

          {parsed && !parsed.ok && <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger">{parsed.error}</p>}

          {draft && (
            <div className="space-y-2 rounded-lg border border-border bg-background p-3 text-xs">
              {blocked && (
                <p role="alert" className="flex items-start gap-2 rounded-lg bg-danger/10 px-3 py-2 font-medium text-danger">
                  <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                  {draft.regulationGate === "failed" ? "Mevzuat kapısı geçmedi." : "Açık doğrulama maddesi var."} Aktarılabilir ama durum ilerlemez; yayın öncesi düzeltilmeli.
                </p>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-foreground">{draft.client || "Müşteri belirtilmemiş"}</span>
                {draft.format && <Badge tone="muted">{draft.format}</Badge>}
                {draft.durationSeconds && <Badge tone="muted">{draft.durationSeconds} sn</Badge>}
                {draft.regulationGate === "passed" && <Badge tone="success"><ShieldCheck className="mr-1 h-3 w-3" aria-hidden />Mevzuat geçti</Badge>}
                {draft.regulationGate === "failed" && <Badge tone="danger">Mevzuat geçmedi</Badge>}
                {draft.regulationGate === "unknown" && <Badge tone="warning">Mevzuat kontrolü yok</Badge>}
              </div>
              {mismatch && (
                <p className="flex items-start gap-2 text-warning"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />Taslak &quot;{draft.client}&quot; için yazılmış; bu içerik {clientName} müşterisine ait.</p>
              )}
              {draft.warnings.map((w) => (
                <p key={w} className="flex items-start gap-2 text-warning"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />{w}</p>
              ))}
              {draft.verificationNotes?.trim() && (
                <pre className="whitespace-pre-wrap rounded bg-danger/5 px-2 py-1 font-sans text-danger">{draft.verificationNotes}</pre>
              )}
              <ul className="space-y-0.5 text-muted">
                <li>Hook: {draft.hook ? <span className="text-foreground">{draft.hook}</span> : "taslakta yok (değişmez)"}</li>
                <li>Senaryo: <span className="text-foreground">{wordCount(draft.script)} kelime</span></li>
                <li>Caption: {draft.caption ? <span className="text-foreground">var</span> : "taslakta yok (değişmez)"}</li>
                <li>
                  Durum:{" "}
                  {advances
                    ? <span className="text-foreground">{contentStatus.brief.label} → {contentStatus.script_ready.label}</span>
                    : "değişmez"}
                </li>
              </ul>
              <div className="flex flex-wrap gap-2 pt-1">
                <Button className="min-h-9 px-3 text-xs" onClick={apply}>Alanlara aktar</Button>
                <Button variant="ghost" className="min-h-9 px-3 text-xs" onClick={() => setRaw("")}>Temizle</Button>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
