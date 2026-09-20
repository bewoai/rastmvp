"use client";

import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { PageHeader, EmptyState } from "@/components/ui";
import { FormModal, Field, Input, Select, Textarea, MoreFields, Button, useFormState } from "@/components/form";
import { DataTable, FilterChips, PageLoading, RowActions, SearchBox, StatusSelect, Toolbar, useListSearch, useNewIntent, usePersistentState } from "@/components/list";
import type { Column } from "@/components/list";
import { useDeleteConfirm } from "@/components/confirm";
import { useStore, useHydrated, uid, nowISO } from "@/lib/store";
import { useToday } from "@/lib/useToday";
import { daysBetween } from "@/lib/taskLogic";
import { patchRecord } from "@/lib/mutate";
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

const activeOptions = [
  { value: "1", label: "Aktif", tone: "success" as const },
  { value: "0", label: "Pasif", tone: "muted" as const },
];

type Scope = "all" | "active" | "passive";
const SCOPES: readonly Scope[] = ["all", "active", "passive"];

function ClientModal({ initial, onClose }: { initial: Client | null; onClose: () => void }) {
  const f = useFormState<Client>(
    initial
      ? { ...initial, contract_start: formatDateInput(initial.contract_start), contract_end: formatDateInput(initial.contract_end) }
      : empty,
  );
  const editing = Boolean(initial?.id);
  const { form } = f;

  async function submit() {
    if (!form.name.trim()) return { ok: false, error: "Müşteri / firma adı zorunludur." };

    const contractStart = normalizeDateInput(form.contract_start);
    const contractEnd = normalizeDateInput(form.contract_end);
    if (contractStart === null || contractEnd === null) {
      return { ok: false, error: "Tarihleri GG.AA.YYYY veya YYYY-AA-GG formatında girin." };
    }
    if (form.payment_day !== undefined && (form.payment_day < 1 || form.payment_day > 31)) {
      return { ok: false, error: "Ödeme günü 1 ile 31 arasında olmalıdır." };
    }

    const normalized: Client = { ...form, name: form.name.trim(), contract_start: contractStart, contract_end: contractEnd };
    const s = useStore.getState();
    return editing ? s.update("clients", form.id, normalized) : s.add("clients", { ...normalized, id: uid(), created_at: nowISO() });
  }

  return (
    <FormModal
      title={editing ? "Müşteri düzenle" : "Yeni müşteri"}
      onClose={onClose}
      onSubmit={submit}
      successMessage={editing ? "Müşteri güncellendi" : "Müşteri eklendi"}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field label="Müşteri / firma adı *"><Input {...f.text("name")} autoComplete="off" /></Field>
        </div>
        <Field label="Aylık ücret (₺)"><Input type="number" inputMode="decimal" min="0" {...f.num("monthly_fee")} /></Field>
        <Field label="Ödeme günü">
          <Input
            type="text" inputMode="numeric" pattern="[0-9]*" maxLength={2} placeholder="1-31"
            value={form.payment_day ?? ""}
            onChange={(e) => {
              const digits = e.target.value.replace(/\D/g, "").slice(0, 2);
              f.set("payment_day", digits ? Number(digits) : undefined);
            }}
          />
        </Field>
        <Field label="Sözleşme başlangıç"><Input type="text" inputMode="numeric" placeholder="GG.AA.YYYY" {...f.text("contract_start")} /></Field>
        <Field label="Sözleşme bitiş"><Input type="text" inputMode="numeric" placeholder="GG.AA.YYYY" {...f.text("contract_end")} /></Field>
        <MoreFields label="Ek alanlar (vergi no, durum, not)" defaultOpen={editing}>
          <Field label="Vergi no"><Input {...f.text("tax_id")} /></Field>
          <Field label="Durum">
            <Select {...f.bool("is_active")}>
              <option value="1">Aktif</option>
              <option value="0">Pasif</option>
            </Select>
          </Field>
          <div className="sm:col-span-2"><Field label="Notlar"><Textarea {...f.text("notes")} /></Field></div>
        </MoreFields>
      </div>
    </FormModal>
  );
}

export default function ClientsPage() {
  const hydrated = useHydrated(["clients", "brands"]);
  const clients = useStore((s) => s.clients);
  const brands = useStore((s) => s.brands);
  const today = useToday();

  const wantNew = useNewIntent();
  const [modal, setModal] = useState<{ initial: Client | null } | null>(() => (wantNew ? { initial: null } : null));
  const [scope, setScope] = usePersistentState<Scope>("clients-scope", "all", SCOPES);
  const [query, setQuery] = useState("");
  const del = useDeleteConfirm();

  const brandCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const b of brands) if (b.client_id) counts.set(b.client_id, (counts.get(b.client_id) || 0) + 1);
    return counts;
  }, [brands]);

  const counts = useMemo(() => {
    let active = 0;
    for (const c of clients) if (c.is_active) active++;
    return { all: clients.length, active, passive: clients.length - active };
  }, [clients]);

  const scoped = useMemo(
    () => (scope === "all" ? clients : clients.filter((c) => c.is_active === (scope === "active"))),
    [clients, scope],
  );
  const visible = useListSearch(scoped, query, (c) => `${c.name} ${c.tax_id ?? ""}`);

  const columns = useMemo<Column<Client>[]>(() => [
    {
      key: "name", header: "Müşteri", tone: "primary", mobile: "title", sort: (c) => c.name,
      cell: (c) => (
        <>
          <span className="block max-w-[22rem] truncate">{c.name}</span>
          <span className="block text-xs font-normal text-muted">{brandCounts.get(c.id) || 0} marka</span>
        </>
      ),
    },
    {
      key: "status", header: "Durum", mobile: "badge", sort: (c) => (c.is_active ? 0 : 1),
      cell: (c) => (
        <StatusSelect
          value={c.is_active ? "1" : "0"}
          options={activeOptions}
          label={`Durum: ${c.name}`}
          onChange={(v) => patchRecord("clients", c.id, { is_active: v === "1" }, "Durum güncellenemedi")}
        />
      ),
    },
    { key: "fee", header: "Aylık ücret", tone: "strong", sort: (c) => c.monthly_fee, cell: (c) => (c.monthly_fee ? TRY(c.monthly_fee) : "—") },
    { key: "payday", header: "Ödeme günü", sort: (c) => c.payment_day, cell: (c) => (c.payment_day ? `Ayın ${c.payment_day}.` : "—") },
    {
      key: "end", header: "Sözleşme bitiş", sort: (c) => c.contract_end,
      cell: (c) => {
        const end = c.contract_end?.slice(0, 10);
        if (!end) return "—";
        const left = daysBetween(today, end);
        if (c.is_active && left < 0) return <span className="text-danger">{dateTR(end)} · bitti</span>;
        if (c.is_active && left <= 30) return <span className="text-warning">{dateTR(end)} · {left} gün</span>;
        return dateTR(end);
      },
    },
  ], [brandCounts, today]);

  if (!hydrated) return <PageLoading title="Müşteriler" />;

  return (
    <>
      <PageHeader
        title="Müşteriler"
        subtitle="Aktif müşteriler, hizmet paketleri ve sözleşme takibi"
        action={
          <Button onClick={() => setModal({ initial: null })}>
            <Plus className="h-4 w-4" aria-hidden /> Yeni Müşteri
          </Button>
        }
      />

      <Toolbar>
        <FilterChips
          label="Müşteri durumu"
          value={scope}
          onChange={setScope}
          options={[
            { id: "all", label: "Tümü", count: counts.all },
            { id: "active", label: "Aktif", count: counts.active },
            { id: "passive", label: "Pasif", count: counts.passive },
          ]}
        />
        <SearchBox value={query} onChange={setQuery} placeholder="Müşteri ara…" label="Müşteri ara" />
      </Toolbar>

      <DataTable
        columns={columns}
        rows={visible}
        rowKey={(c) => c.id}
        onOpen={(c) => setModal({ initial: c })}
        openLabel={(c) => `Düzenle: ${c.name}`}
        actions={(c) => (
          <RowActions
            label={c.name}
            onEdit={() => setModal({ initial: c })}
            onDelete={() => del.ask({ key: "clients", id: c.id, label: c.name, warning: (brandCounts.get(c.id) ?? 0) > 0 ? `Müşteriye bağlı ${brandCounts.get(c.id)} marka da silinir.` : undefined })}
          />
        )}
        empty={
          clients.length === 0 ? (
            <EmptyState title="Henüz müşteri yok" hint="İlk müşteriyi ekleyerek başla." action={{ label: "Yeni Müşteri", onClick: () => setModal({ initial: null }) }} />
          ) : (
            <EmptyState title="Eşleşen müşteri yok" hint={query ? "Aramayı değiştir." : "Bu durumda müşteri bulunmuyor."} />
          )
        }
      />

      {modal && <ClientModal initial={modal.initial} onClose={() => setModal(null)} />}
      {del.dialog}
    </>
  );
}
