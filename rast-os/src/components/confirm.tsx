"use client";

import { useCallback, useState } from "react";
import { Modal, Button } from "./form";
import { useStore } from "@/lib/store";
import type { RastData } from "@/lib/types";
import { useToasts } from "@/lib/toast";

export function ConfirmDialog({
  title,
  message,
  confirmLabel = "Sil",
  onConfirm,
  onCancel,
}: {
  title: string;
  message: React.ReactNode;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal
      open
      onClose={onCancel}
      title={title}
      size="sm"
      role="alertdialog"
      footer={
        <>
          {/* Güvenli varsayılan: odak "Vazgeç"te; yanlışlıkla Enter silmez */}
          <Button variant="ghost" onClick={onCancel} data-autofocus>Vazgeç</Button>
          <Button variant="danger" onClick={onConfirm}>{confirmLabel}</Button>
        </>
      }
    >
      <div className="text-sm leading-6 text-muted">{message}</div>
    </Modal>
  );
}

export interface DeleteTarget {
  key: keyof RastData;
  id: string;
  /** Kaydın görünen adı (onay metninde ve toast'ta). */
  label: string;
  /** Bağlı kayıtlarla ilgili uyarı (ör. "Bağlı görevler de silinir"). */
  warning?: string;
}

/**
 * Yıkıcı işlem güvenliği: her silme önce onay ister, sonra iyimser siler (`store.remove`).
 * Başarısızlıkta kayıt store tarafından listeye geri konur ve hata toast'ı çıkar.
 * Kullanım: `const del = useDeleteConfirm();` → `del.ask({...})` ve JSX'te `{del.dialog}`.
 */
export function useDeleteConfirm() {
  const [target, setTarget] = useState<DeleteTarget | null>(null);
  const ask = useCallback((t: DeleteTarget) => setTarget(t), []);
  const cancel = useCallback(() => setTarget(null), []);

  const confirm = useCallback(() => {
    if (!target) return;
    const t = target;
    setTarget(null); // önce kapat: çift tıklamada ikinci silme olmaz
    void useStore
      .getState()
      .remove(t.key, t.id)
      .catch((e: unknown) => ({ ok: false as const, error: e instanceof Error ? e.message : String(e) }))
      .then((r) => {
        const toasts = useToasts.getState();
        if (r.ok) toasts.push({ message: `“${t.label}” silindi` });
        else toasts.push({ message: `“${t.label}” silinemedi${r.error ? `: ${r.error}` : ""}`, tone: "danger" });
      });
  }, [target]);

  const dialog = target ? (
    <ConfirmDialog
      title="Silinsin mi?"
      message={
        <>
          <p><strong className="text-foreground">{target.label}</strong> kalıcı olarak silinecek. Bu işlem geri alınamaz.</p>
          {target.warning && <p className="mt-2 text-warning">{target.warning}</p>}
        </>
      }
      onConfirm={confirm}
      onCancel={cancel}
    />
  ) : null;

  return { ask, dialog };
}
