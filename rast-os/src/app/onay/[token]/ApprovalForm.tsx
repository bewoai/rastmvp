"use client";

import { useId, useState } from "react";
import { CheckCircle2, Clock, FilePenLine, Printer, ShieldCheck } from "lucide-react";
import { Button } from "@/components/form";
import { createAnonClient } from "@/lib/supabase/anon";
import {
  NAME_MAX, NOTE_MAX, PHYSICIAN_DECLARATION, applyChecks, checkedCount, decisionErrorText, validateDecision,
} from "@/lib/approval-logic";
import type { DecisionError } from "@/lib/approval-logic";
import type { ApprovalChecklistItem, ApprovalDecision, PublicApproval } from "@/lib/types";

// Sunucu (SSR) ve tarayıcı aynı metni üretsin: saat dilimi sabit.
const fmt = (iso?: string | null) =>
  iso
    ? new Date(iso).toLocaleString("tr-TR", {
      timeZone: "Europe/Istanbul", day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit",
    })
    : "—";

const RETENTION_NOTE = "Bu kayıt mevzuat kapsamında saklanır.";

const PRINT_CSS = `
@media print {
  @page { size: A4; margin: 16mm; }
  html, body { background: #fff !important; color: #111 !important; }
  .onay-sheet, .onay-sheet * {
    color: #111 !important; background: transparent !important; border-color: #bbb !important;
    box-shadow: none !important; backdrop-filter: none !important;
  }
  .onay-no-print { display: none !important; }
}`;

interface Decided {
  status: ApprovalDecision;
  decided_at: string;
  name: string;
  note: string | null;
  checklist: ApprovalChecklistItem[];
}

export function ApprovalForm({ token, approval, demo }: { token: string; approval: PublicApproval; demo: boolean }) {
  const ids = useId();
  const [checked, setChecked] = useState<Set<string>>(() => new Set());
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<ApprovalDecision | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(approval.status === "expired");
  const [decided, setDecided] = useState<Decided | null>(() =>
    approval.status === "approved" || approval.status === "changes_requested"
      ? {
        status: approval.status,
        decided_at: approval.decided_at ?? approval.sent_at,
        name: approval.decided_by_name ?? "—",
        note: approval.note,
        checklist: approval.checklist,
      }
      : null,
  );

  const total = approval.checklist.length;
  const done = checked.size;

  function toggle(key: string) {
    setChecked((cur) => {
      const next = new Set(cur);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    setError(null);
  }

  async function submit(decision: ApprovalDecision) {
    if (busy) return;
    const input = { decision, name, note, checked };
    const invalid = validateDecision(input, approval.checklist);
    if (invalid) {
      setError(decisionErrorText[invalid]);
      return;
    }
    setBusy(decision);
    setError(null);
    const trimmedNote = note.trim() || null;
    const keys = [...checked];
    try {
      let decidedAt = new Date().toISOString();
      if (!demo) {
        const { data, error: rpcError } = await createAnonClient().rpc("approval_decide", {
          p_token: token,
          p_decision: decision,
          p_name: name.trim(),
          p_note: trimmedNote,
          p_checked: keys,
        });
        if (rpcError) throw new Error(rpcError.message);
        const res = data as { ok: boolean; error?: DecisionError; decided_at?: string } | null;
        if (!res?.ok) {
          const code = res?.error ?? "not_found";
          if (code === "expired") setExpired(true);
          setError(decisionErrorText[code] ?? "Karar kaydedilemedi.");
          return;
        }
        decidedAt = res.decided_at ?? decidedAt;
      }
      setDecided({
        status: decision,
        decided_at: decidedAt,
        name: name.trim(),
        note: trimmedNote,
        checklist: applyChecks(approval.checklist, keys),
      });
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch {
      setError("Bağlantı hatası: karar kaydedilemedi. İnternet bağlantınızı kontrol edip tekrar deneyin.");
    } finally {
      setBusy(null);
    }
  }

  const header = (
    <header className="mb-4">
      <p className="text-[13px] font-semibold text-accent">{approval.agency_name || "Ajans"}</p>
      <h1 className="mt-1 text-xl font-semibold tracking-tight text-foreground sm:text-2xl">{approval.title}</h1>
      <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        {approval.client_name && <div><dt className="inline">Müşteri: </dt><dd className="inline text-foreground">{approval.client_name}</dd></div>}
        {approval.brand_name && <div><dt className="inline">Marka: </dt><dd className="inline text-foreground">{approval.brand_name}</dd></div>}
        <div><dt className="inline">Senaryo sürümü: </dt><dd className="inline text-foreground">v{approval.version}</dd></div>
        <div><dt className="inline">Gönderim: </dt><dd className="inline text-foreground">{fmt(approval.sent_at)}</dd></div>
      </dl>
      {demo && (
        <p className="onay-no-print mt-3 rounded-lg border border-border bg-surface px-3 py-2 text-xs text-muted">
          <strong className="font-medium text-foreground">Demo modu:</strong> veritabanı bağlı değil; karar kaydedilmez, yalnızca akış gösterilir.
        </p>
      )}
    </header>
  );

  if (decided) {
    const approved = decided.status === "approved";
    return (
      <div className="onay-sheet">
        <style>{PRINT_CSS}</style>
        {header}
        <section className="card p-5" aria-live="polite">
          <div className="flex items-start gap-3">
            {approved
              ? <CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0 text-success" aria-hidden />
              : <FilePenLine className="mt-0.5 h-6 w-6 shrink-0 text-warning" aria-hidden />}
            <div>
              <h2 className="text-base font-semibold text-foreground">
                {approved ? "İçerik onaylandı" : "Değişiklik talebiniz iletildi"}
              </h2>
              <p className="mt-1 text-sm text-muted">
                {approved
                  ? "Teşekkürler. İçerik bu metinle yayına hazırlanacak; metin değişirse yeniden onayınıza sunulur."
                  : "Teşekkürler. Ajans metni düzenleyip yeni sürümü onayınıza gönderecek."}
              </p>
            </div>
          </div>

          <h3 className="mt-5 text-[13px] font-semibold text-muted">Onay kaydı özeti</h3>
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
            <dt className="text-muted">Ajans</dt><dd className="text-foreground">{approval.agency_name || "—"}</dd>
            <dt className="text-muted">İçerik</dt><dd className="text-foreground">{approval.title}</dd>
            {approval.client_name && <><dt className="text-muted">Müşteri</dt><dd className="text-foreground">{approval.client_name}</dd></>}
            <dt className="text-muted">Sürüm</dt><dd className="text-foreground">v{approval.version}</dd>
            <dt className="text-muted">Karar</dt><dd className="font-medium text-foreground">{approved ? "Onaylıyorum" : "Değişiklik istiyorum"}</dd>
            <dt className="text-muted">Karar veren</dt><dd className="text-foreground">{decided.name}</dd>
            <dt className="text-muted">Tarih / saat</dt><dd className="text-foreground">{fmt(decided.decided_at)}</dd>
            <dt className="text-muted">Kontrol listesi</dt><dd className="text-foreground">{checkedCount(decided.checklist)}/{decided.checklist.length} madde işaretlendi</dd>
          </dl>

          <ul className="mt-3 space-y-1 text-xs">
            {decided.checklist.map((item, i) => (
              <li key={item.key} className="flex gap-2">
                <span aria-hidden className={item.checked ? "text-success" : "text-muted"}>{item.checked ? "☑" : "☐"}</span>
                <span className={item.checked ? "text-foreground" : "text-muted"}>
                  {i + 1}. {item.label}{item.basis ? ` (md. ${item.basis})` : ""}
                  <span className="sr-only">{item.checked ? " — işaretlendi" : " — işaretlenmedi"}</span>
                </span>
              </li>
            ))}
          </ul>

          {decided.note && (
            <div className="mt-3">
              <p className="text-xs text-muted">Not</p>
              <p className="mt-0.5 whitespace-pre-wrap rounded-lg bg-surface-2/60 px-3 py-2 text-sm text-foreground">{decided.note}</p>
            </div>
          )}
          {approved && <p className="mt-3 text-xs italic text-muted">Beyan: “{PHYSICIAN_DECLARATION}”</p>}

          <p className="mt-4 border-t border-border pt-3 text-xs font-medium text-foreground">{RETENTION_NOTE}</p>
          <div className="onay-no-print mt-4">
            <Button variant="ghost" onClick={() => window.print()}><Printer className="h-4 w-4" aria-hidden /> Yazdır / PDF kaydet</Button>
          </div>
        </section>
      </div>
    );
  }

  if (expired) {
    return (
      <div className="onay-sheet">
        {header}
        <section className="card p-5 text-center">
          <Clock className="mx-auto h-8 w-8 text-warning" aria-hidden />
          <h2 className="mt-3 text-base font-semibold text-foreground">Bu onay bağlantısı artık geçerli değil</h2>
          <p className="mx-auto mt-2 max-w-sm text-sm text-muted">{decisionErrorText.expired}</p>
          <p className="mt-3 text-xs text-muted">Son geçerlilik: {fmt(approval.expires_at)}</p>
        </section>
      </div>
    );
  }

  const noteId = `${ids}-note`;
  const nameId = `${ids}-name`;

  return (
    <div className="onay-sheet">
      {header}

      <section className="card p-4 sm:p-5" aria-labelledby={`${ids}-script`}>
        <h2 id={`${ids}-script`} className="text-sm font-semibold text-foreground">Senaryo / metin</h2>
        {approval.script_snapshot?.trim()
          ? <div className="mt-2 max-h-[60vh] overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-background/60 p-3 text-sm leading-6 text-foreground">{approval.script_snapshot}</div>
          : <p className="mt-2 text-sm text-muted">Bu sürüme senaryo metni eklenmemiş; onay başlık ve ajansın ilettiği görsel/video için verilir.</p>}
        <p className="mt-2 text-xs text-muted">Kapsam: video, altyazı, kapak, caption, hashtag ve yayın metni. Bağlantı {fmt(approval.expires_at)} tarihine kadar geçerlidir.</p>
      </section>

      <fieldset className="card mt-4 p-4 sm:p-5">
        <legend className="sr-only">Mevzuat kontrol listesi</legend>
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-sm font-semibold text-foreground">Mevzuat kontrol listesi</h2>
          <span className={`text-xs font-medium ${done === total ? "text-success" : "text-muted"}`} aria-live="polite">{done}/{total}</span>
        </div>
        <p className="mt-1 text-xs text-muted">Onaylamak için her maddeyi okuyup işaretleyin (2025 Sağlık Hizmetlerinde Tanıtım Yönetmeliği).</p>
        <ul className="mt-3 space-y-2">
          {approval.checklist.map((item, i) => {
            const id = `${ids}-c-${item.key}`;
            const on = checked.has(item.key);
            return (
              <li key={item.key}>
                <label htmlFor={id} className={`flex cursor-pointer gap-3 rounded-lg border p-3 transition-colors ${on ? "border-success/50 bg-success/5" : "border-border bg-background/40 hover:border-accent/40"}`}>
                  <input id={id} type="checkbox" checked={on} onChange={() => toggle(item.key)} className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--accent)]" />
                  <span className="text-sm leading-5 text-foreground">
                    <span className="text-muted">{i + 1}.</span> {item.label}
                    {item.basis && <span className="mt-0.5 block text-[11px] text-muted">Dayanak: md. {item.basis}</span>}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      </fieldset>

      <section className="card mt-4 space-y-4 p-4 sm:p-5" aria-label="Karar">
        <div>
          <label htmlFor={noteId} className="mb-1 block text-xs font-medium text-muted">Not <span className="font-normal">(değişiklik istiyorsanız zorunlu)</span></label>
          <textarea
            id={noteId}
            rows={4}
            maxLength={NOTE_MAX}
            value={note}
            onChange={(e) => { setNote(e.target.value); setError(null); }}
            placeholder="Ör. 2. paragraftaki ifade uzmanlık alanım dışında, çıkarılsın."
            className="w-full rounded-lg border border-border/80 bg-background/70 px-3.5 py-2.5 text-base text-foreground outline-none placeholder:text-faint focus:border-accent/70 md:text-sm"
          />
        </div>
        <div>
          <label htmlFor={nameId} className="mb-1 block text-xs font-medium text-muted">Adınız soyadınız *</label>
          <input
            id={nameId}
            type="text"
            autoComplete="name"
            maxLength={NAME_MAX}
            value={name}
            onChange={(e) => { setName(e.target.value); setError(null); }}
            placeholder="Ör. Uzm. Dr. Ayşe Yılmaz"
            className="w-full rounded-lg border border-border/80 bg-background/70 px-3.5 py-2.5 text-base text-foreground outline-none placeholder:text-faint focus:border-accent/70 md:text-sm"
          />
        </div>

        <p className="rounded-lg bg-surface-2/60 px-3 py-2 text-xs leading-5 text-muted">
          <span className="font-medium text-foreground">Beyan (Onaylıyorum):</span> {PHYSICIAN_DECLARATION}
        </p>

        {error && <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}

        <div className="flex flex-col gap-2 sm:flex-row-reverse">
          <Button className="w-full sm:w-auto" loading={busy === "approved"} disabled={busy !== null} onClick={() => submit("approved")}>
            <ShieldCheck className="h-4 w-4" aria-hidden /> Onaylıyorum
          </Button>
          <Button variant="ghost" className="w-full sm:w-auto" loading={busy === "changes_requested"} disabled={busy !== null} onClick={() => submit("changes_requested")}>
            <FilePenLine className="h-4 w-4" aria-hidden /> Değişiklik istiyorum
          </Button>
          {done < total && <p className="text-xs text-muted sm:mr-auto sm:self-center">Onay için {total - done} madde daha işaretlenmeli.</p>}
        </div>
      </section>

      <footer className="mt-4 text-center text-xs text-muted">
        <p className="font-medium text-foreground/90">{RETENTION_NOTE}</p>
        <p className="mt-1">Kararınız, adınız, karar zamanı ve bağlantı (IP) bilgisi kanıt kaydı olarak tutulur. Bu bağlantı kişiseldir; başkasıyla paylaşmayın.</p>
      </footer>
    </div>
  );
}
