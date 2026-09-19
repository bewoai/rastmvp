"use client";

import { useState } from "react";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { PageHeader, Badge } from "@/components/ui";
import { Modal, Field, Input, Select, Textarea, Button } from "@/components/form";
import { useStore, useHydrated, uid, nowISO } from "@/lib/store";
import { TRY, dateTR } from "@/lib/labels";
import type { Client } from "@/lib/types";

const empty: Client = {
  id: "", name: "", tax_id: "", monthly_fee: undefined, contract_start: "",
  contract_end: "", payment_day: undefined, is_active: true, notes: "", created_at: "",
};

function formatDateInput(value?: string) {
  const raw = value?.slice(0, 10) ?? "";
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  return match ? `${match[3]}.${match[2]}.${match[1]}` : raw;
}

function normalizeDateInput(value?: string): string | null {
  const raw = value?.trim() ?? "";
  if (!raw) return "";

  const parts = raw.split(/[./-]/).map((part) => Number(part));
  if (parts.length !== 3 || parts.some((part) => !Number.isInteger(part))) return null;

  const [first, second, third] = parts;
  const year = first > 31 ? first : third;
  const month = second;
  const day = first > 31 ? third : first;
  if (year < 1900 || month < 1 || month > 12 || day < 1 || day > 31) return null;

  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export default function ClientsPage() {
  const hydrated = useHydrated();
  const clients = useStore((s) => s.clients);
  const brands = useStore((s) => s.brands);
  const add = useStore((s) => s.add);
  const update = useStore((s) => s.update);
  const remove = useStore((s) => s.remove);

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Client>(empty);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editing = Boolean(form.id);

  function startNew() {
    setForm({ ...empty });
    setError(null);
    setOpen(true);
  }

  function startEdit(client: Client) {
    setForm({
      ...client,
      contract_start: formatDateInput(client.contract_start),
      contract_end: formatDateInput(client.contract_end),
    });
    setError(null);
    setOpen(true);
  }

  async function save() {
    setError(null);
    if (!form.name.trim()) {
      setError("Müşteri / firma adı zorunludur.");
      return;
    }

    const contractStart = normalizeDateInput(form.contract_start);
    const contractEnd = normalizeDateInput(form.contract_end);
    if (contractStart === null || contractEnd === null) {
      setError("Tarihleri GG.AA.YYYY veya YYYY-AA-GG formatında girin.");
      return;
    }
    if (form.payment_day !== undefined && (form.payment_day < 1 || form.payment_day > 31)) {
      setError("Ödeme günü 1 ile 31 arasında olmalıdır.");
      return;
    }

    const normalized: Client = {
      ...form,
      name: form.name.trim(),
      contract_start: contractStart,
      contract_end: contractEnd,
    };

    setSaving(true);
    try {
      const result = editing
        ? await update("clients", form.id, normalized)
        : await add("clients", { ...normalized, id: uid(), created_at: nowISO() });
      if (!result.ok) {
        setError(result.error ?? "Müşteri kaydedilemedi. Lütfen tekrar deneyin.");
        return;
      }
      setOpen(false);
      setForm({ ...empty });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Müşteri kaydedilemedi. Lütfen tekrar deneyin.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Müşteriler"
        subtitle="Aktif müşteriler, hizmet paketleri ve sözleşme takibi"
        action={
          <Button onClick={startNew}>
            <span className="flex items-center gap-1.5"><Plus className="h-4 w-4" /> Yeni Müşteri</span>
          </Button>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {hydrated && clients.map((c) => {
          const brandCount = brands.filter((b) => b.client_id === c.id).length;
          return (
            <div key={c.id} className="card p-4">
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-semibold text-foreground">{c.name}</p>
                  <p className="mt-0.5 text-xs text-muted">{brandCount} marka</p>
                </div>
                <Badge tone={c.is_active ? "success" : "muted"}>
                  {c.is_active ? "Aktif" : "Pasif"}
                </Badge>
              </div>
              <dl className="mt-3 space-y-1 text-sm">
                <div className="flex justify-between">
                  <dt className="text-muted">Aylık ücret</dt>
                  <dd className="text-foreground">{c.monthly_fee ? TRY(c.monthly_fee) : "—"}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted">Ödeme günü</dt>
                  <dd className="text-foreground">{c.payment_day ? `Ayın ${c.payment_day}.` : "—"}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted">Sözleşme bitiş</dt>
                  <dd className="text-foreground">{dateTR(c.contract_end)}</dd>
                </div>
              </dl>
              <div className="mt-3 flex justify-end gap-1 border-t border-border pt-2">
                <button onClick={() => startEdit(c)} className="rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-foreground"><Pencil className="h-4 w-4" /></button>
                <button onClick={() => remove("clients", c.id)} className="rounded-md p-1.5 text-muted hover:bg-danger/15 hover:text-danger"><Trash2 className="h-4 w-4" /></button>
              </div>
            </div>
          );
        })}
        {hydrated && clients.length === 0 && (
          <p className="col-span-full py-10 text-center text-muted">Henüz müşteri yok.</p>
        )}
      </div>

      <Modal
        open={open}
        onClose={() => { setOpen(false); setError(null); }}
        title={editing ? "Müşteri düzenle" : "Yeni müşteri"}
        footer={
          <>
            <Button variant="ghost" onClick={() => { setOpen(false); setError(null); }}>Vazgeç</Button>
            <Button disabled={saving} onClick={save}>{saving ? "Kaydediliyor…" : "Kaydet"}</Button>
          </>
        }
      >
        {error && <p className="mb-3 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger" role="alert">{error}</p>}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field label="Müşteri / firma adı *">
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
          </div>
          <Field label="Vergi no">
            <Input value={form.tax_id} onChange={(e) => setForm({ ...form, tax_id: e.target.value })} />
          </Field>
          <Field label="Aylık ücret (₺)">
            <Input type="number" value={form.monthly_fee ?? ""} onChange={(e) => setForm({ ...form, monthly_fee: e.target.value ? Number(e.target.value) : undefined })} />
          </Field>
          <Field label="Sözleşme başlangıç">
            <Input type="text" inputMode="numeric" placeholder="GG.AA.YYYY" value={form.contract_start ?? ""} onChange={(e) => setForm({ ...form, contract_start: e.target.value })} />
          </Field>
          <Field label="Sözleşme bitiş">
            <Input type="text" inputMode="numeric" placeholder="GG.AA.YYYY" value={form.contract_end ?? ""} onChange={(e) => setForm({ ...form, contract_end: e.target.value })} />
          </Field>
          <Field label="Ödeme günü">
            <Input type="text" inputMode="numeric" pattern="[0-9]*" maxLength={2} placeholder="1-31" value={form.payment_day ?? ""} onChange={(e) => {
              const digits = e.target.value.replace(/\D/g, "").slice(0, 2);
              setForm({ ...form, payment_day: digits ? Number(digits) : undefined });
            }} />
          </Field>
          <Field label="Durum">
            <Select value={form.is_active ? "1" : "0"} onChange={(e) => setForm({ ...form, is_active: e.target.value === "1" })}>
              <option value="1">Aktif</option>
              <option value="0">Pasif</option>
            </Select>
          </Field>
          <div className="sm:col-span-2">
            <Field label="Notlar">
              <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </Field>
          </div>
        </div>
      </Modal>
    </>
  );
}
