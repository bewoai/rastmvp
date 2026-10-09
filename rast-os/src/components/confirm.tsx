"use client";

import { useCallback, useState } from "react";
import { Modal, Button } from "./form";
import { useStore } from "@/lib/store";
import type { WritableCollection } from "@/lib/types";
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
  key: WritableCollection;
  id: string;
  /** Kaydın görünen adı (onay metninde ve toast'ta). */
  label: string;
  /** Bağlı kayıtlarla ilgili uyarı (ör. "Bağlı görevler de silinir"). */
  warning?: string;
  /**
   * Satır silindikten SONRA çalışan temizlik (ör. içeriğin Storage dosyaları). Satır silme başarısızsa
   * çalışmaz; kendisi başarısız olursa satır silinmiş kalır, döndürdüğü metin uyarı olarak gösterilir.
   */
  afterDelete?: () => Promise<string | null>;
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
      .then(async (r) => {
        const toasts = useToasts.getState();
        if (!r.ok) {
          toasts.push({ message: `“${t.label}” silinemedi${r.error ? `: ${r.error}` : ""}`, tone: "danger" });
          return;
        }
        toasts.push({ message: `“${t.label}” silindi` });
        if (!t.afterDelete) return;
        const warning = await t.afterDelete().catch((e: unknown) => (e instanceof Error ? e.message : String(e)));
        if (warning) toasts.push({ message: warning, tone: "danger" });
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

/**
 * Genel onay: `const c = useConfirm();` → `if (await c.ask({ title, message, confirmLabel })) …` ve JSX'te `{c.dialog}`.
 * Silme dışı ama geri dönüşü zor işlemler için (ör. adayı ret listesine almak).
 */
export function useConfirm() {
  const [req, setReq] = useState<{ title: string; message: React.ReactNode; confirmLabel?: string; resolve: (ok: boolean) => void } | null>(null);
  const ask = useCallback(
    (o: { title: string; message: React.ReactNode; confirmLabel?: string }) => new Promise<boolean>((resolve) => setReq({ ...o, resolve })),
    [],
  );
  const close = (ok: boolean) => {
    req?.resolve(ok);
    setReq(null);
  };
  const dialog = req ? (
    <ConfirmDialog title={req.title} message={req.message} confirmLabel={req.confirmLabel ?? "Onayla"} onConfirm={() => close(true)} onCancel={() => close(false)} />
  ) : null;
  return { ask, dialog };
}
