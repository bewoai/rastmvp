"use client";

import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { PageHeader, Badge, EmptyState } from "@/components/ui";
import { FormModal, Field, Input, Select, Button, useFormState } from "@/components/form";
import { DataTable, PageLoading, RowActions, SearchBox, Toolbar, useListSearch, useNewIntent } from "@/components/list";
import type { Column } from "@/components/list";
import { useDeleteConfirm } from "@/components/confirm";
import { useStore, useHydrated, uid, nowISO } from "@/lib/store";
import type { Contact, Client } from "@/lib/types";

const empty: Contact = {
  id: "", client_id: "", full_name: "", title: "", phone: "", email: "",
  is_approver: false, created_at: "",
};

function ContactModal({ initial, clients, onClose }: { initial: Contact | null; clients: Client[]; onClose: () => void }) {
  const f = useFormState<Contact>(initial ?? empty);
  const editing = Boolean(initial?.id);
  const { form } = f;

  async function submit() {
    if (!form.full_name.trim()) return { ok: false, error: "Ad soyad zorunludur." };
    const payload = { ...form, full_name: form.full_name.trim() };
    const s = useStore.getState();
    return editing ? s.update("contacts", form.id, payload) : s.add("contacts", { ...payload, id: uid(), created_at: nowISO() });
  }

  return (
    <FormModal
      title={editing ? "Kişi düzenle" : "Yeni kişi"}
      onClose={onClose}
      onSubmit={submit}
      successMessage={editing ? "Kişi güncellendi" : "Kişi eklendi"}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Ad soyad *"><Input {...f.text("full_name")} autoComplete="off" /></Field>
        <Field label="Müşteri">
          <Select {...f.text("client_id")}>
            <option value="">Seçin</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
        <Field label="Telefon"><Input type="tel" inputMode="tel" {...f.text("phone")} /></Field>
        <Field label="E-posta"><Input type="email" inputMode="email" {...f.text("email")} /></Field>
        <Field label="Ünvan"><Input {...f.text("title")} /></Field>
        <Field label="Onay yetkisi">
          <Select {...f.bool("is_approver")}>
            <option value="0">Hayır</option><option value="1">Evet</option>
          </Select>
        </Field>
      </div>
    </FormModal>
  );
}

const linkCls = "rounded outline-none hover:text-amber focus-visible:ring-2 focus-visible:ring-amber/60";

export default function ContactsPage() {
  const hydrated = useHydrated(["contacts", "clients", "brands"]);
  const contacts = useStore((s) => s.contacts);
  const clients = useStore((s) => s.clients);

  const wantNew = useNewIntent();
  const [modal, setModal] = useState<{ initial: Contact | null } | null>(() => (wantNew ? { initial: null } : null));
  const [query, setQuery] = useState("");
  const del = useDeleteConfirm();

  const clientMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of clients) map.set(c.id, c.name);
    return map;
  }, [clients]);

  const visible = useListSearch(contacts, query, (ct) => `${ct.full_name} ${clientMap.get(ct.client_id ?? "") ?? ""} ${ct.title ?? ""} ${ct.phone ?? ""} ${ct.email ?? ""}`);

  const columns = useMemo<Column<Contact>[]>(() => [
    {
      key: "name", header: "İsim", tone: "primary", mobile: "title", sort: (ct) => ct.full_name,
      cell: (ct) => (
        <>
          <span className="block max-w-[20rem] truncate">{ct.full_name}</span>
          {ct.title && <span className="block max-w-[20rem] truncate text-xs font-normal text-muted">{ct.title}</span>}
        </>
      ),
    },
    { key: "client", header: "Müşteri", sort: (ct) => clientMap.get(ct.client_id ?? ""), cell: (ct) => clientMap.get(ct.client_id ?? "") || "—" },
    { key: "phone", header: "Telefon", cell: (ct) => (ct.phone ? <a className={linkCls} href={`tel:${ct.phone.replace(/[^\d+]/g, "")}`}>{ct.phone}</a> : "—") },
    { key: "email", header: "E-posta", cell: (ct) => (ct.email ? <a className={`${linkCls} block max-w-[16rem] truncate`} href={`mailto:${ct.email}`}>{ct.email}</a> : "—") },
    { key: "approver", header: "Onay", mobile: "badge", sort: (ct) => (ct.is_approver ? 0 : 1), cell: (ct) => (ct.is_approver ? <Badge tone="success">Onaycı</Badge> : <span className="text-muted">—</span>) },
  ], [clientMap]);

  if (!hydrated) return <PageLoading title="İletişim Kişileri" />;

  return (
    <>
      <PageHeader
        title="İletişim Kişileri"
        subtitle="Müşteri tarafındaki yetkililer ve onay verecek kişiler"
        action={
          <Button onClick={() => setModal({ initial: null })}>
            <Plus className="h-4 w-4" aria-hidden /> Yeni Kişi
          </Button>
        }
      />

      <Toolbar>
        <span className="text-xs text-muted">{visible.length} kişi</span>
        <SearchBox value={query} onChange={setQuery} placeholder="Kişi, müşteri, telefon ara…" label="Kişi ara" />
      </Toolbar>

      <DataTable
        columns={columns}
        rows={visible}
        rowKey={(ct) => ct.id}
        onOpen={(ct) => setModal({ initial: ct })}
        openLabel={(ct) => `Düzenle: ${ct.full_name}`}
        actions={(ct) => (
          <RowActions label={ct.full_name} onEdit={() => setModal({ initial: ct })} onDelete={() => del.ask({ key: "contacts", id: ct.id, label: ct.full_name })} />
        )}
        empty={
          contacts.length === 0 ? (
            <EmptyState title="Henüz kişi yok" hint="Müşteri tarafındaki yetkilileri ve onaycıları ekle." action={{ label: "Yeni Kişi", onClick: () => setModal({ initial: null }) }} />
          ) : (
            <EmptyState title="Eşleşen kişi yok" hint="Aramayı değiştir." />
          )
        }
      />

      {modal && <ContactModal initial={modal.initial} clients={clients} onClose={() => setModal(null)} />}
      {del.dialog}
    </>
  );
}
