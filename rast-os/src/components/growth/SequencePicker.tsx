"use client";

import { useState } from "react";
import { Button, Field, Modal, Select } from "@/components/form";
import { useStore } from "@/lib/store";
import { useToasts } from "@/lib/toast";
import { addToSequence } from "@/lib/growth/client";
import type { Prospect } from "@/lib/types";

/** "Diziye ekle": dizi seç → e-postası olan her aday için 1. adım taslağı (onay kuyruğuna düşer). */
export function SequencePicker({ prospects, onClose, onDone }: { prospects: Prospect[]; onClose: () => void; onDone?: () => void }) {
  const sequences = useStore((s) => s.outreach_sequences).filter((s) => s.active);
  const [seqId, setSeqId] = useState(sequences[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const withEmail = prospects.filter((p) => p.email).length;

  async function submit() {
    const seq = sequences.find((s) => s.id === seqId);
    if (!seq) return;
    setBusy(true);
    const r = await addToSequence(seq, prospects);
    setBusy(false);
    const parts = [`${r.created} taslak oluşturuldu`];
    if (r.noEmail) parts.push(`${r.noEmail} adayın e-postası yok (WhatsApp / Instagram / telefonla ulaşın)`);
    if (r.skipped) parts.push(`${r.skipped} atlandı (zaten dizide ya da kapalı)`);
    useToasts.getState().push(r.error ? { message: `Hata: ${r.error}`, tone: "danger" } : { message: parts.join(" · ") });
    onDone?.();
    onClose();
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Diziye ekle"
      size="sm"
      locked={busy}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Vazgeç</Button>
          <Button onClick={submit} loading={busy} disabled={!seqId}>Taslak oluştur</Button>
        </>
      }
    >
      {sequences.length === 0 ? (
        <p className="text-sm text-muted">Etkin dizi yok. Önce &quot;Diziler&quot; sekmesinden varsayılan şablonları ekleyin.</p>
      ) : (
        <div className="space-y-3 text-sm">
          <Field label="Dizi">
            <Select value={seqId} onChange={(e) => setSeqId(e.target.value)}>
              {sequences.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </Field>
          <p className="text-muted">
            {prospects.length} aday seçili, {withEmail} tanesinin e-postası var. Taslaklar <strong className="text-foreground">onaysız</strong> oluşur;
            Onay kuyruğunda düzenleyip onaylarsınız.
          </p>
        </div>
      )}
    </Modal>
  );
}
