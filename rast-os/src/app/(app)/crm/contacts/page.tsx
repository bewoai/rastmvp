"use client";

import { useState, useMemo, memo } from "react";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { PageHeader, Badge } from "@/components/ui";
import { Modal, Field, Input, Select, Button } from "@/components/form";
import { useStore, useHydrated, uid, nowISO } from "@/lib/store";
import type { Contact, Client } from "@/lib/types";

const empty: Contact = {
  id: "", client_id: "", full_name: "", title: "", phone: "", email: "",
  is_approver: false, created_at: "",
};

const ContactModal = memo(function ContactModal({
  open, onClose, initial, clients
}: {
  open: boolean, onClose: () => void, initial: Contact | null, clients: Client[]
}) {
  const [form, setForm] = useState<Contact>(empty);
  const editing = Boolean(form.id);

  useMemo(() => {
    if (open) setForm(initial || empty);
  }, [open, initial]);

  const add = useStore((s) => s.add);
  const update = useStore((s) => s.update);

  function save() {
    if (!form.full_name.trim()) return;
    if (editing) update("contacts", form.id, form);
    else add("contacts", { ...form, id: uid(), created_at: nowISO() });
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? "Kişi düzenle" : "Yeni kişi"}
      footer={<><Button variant="ghost" onClick={onClose}>Vazgeç</Button><Button onClick={save}>Kaydet</Button></>}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Ad soyad *"><Input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} /></Field>
        <Field label="Müşteri">
          <Select value={form.client_id} onChange={(e) => setForm({ ...form, client_id: e.target.value })}>
            <option value="">Seçin</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
        <Field label="Ünvan"><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
        <Field label="Telefon"><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
        <Field label="E-posta"><Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
        <Field label="Onay yetkisi">
          <Select value={form.is_approver ? "1" : "0"} onChange={(e) => setForm({ ...form, is_approver: e.target.value === "1" })}>
            <option value="0">Hayır</option><option value="1">Evet</option>
          </Select>
        </Field>
      </div>
    </Modal>
  );
});

export default function ContactsPage() {
  const hydrated = useHydrated(["contacts", "clients", "brands"]);
  const contacts = useStore((s) => s.contacts);
  const clients = useStore((s) => s.clients);
  const remove = useStore((s) => s.remove);

  const [open, setOpen] = useState(false);
  const [initialForm, setInitialForm] = useState<Contact | null>(null);

  const clientMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of clients) map.set(c.id, c.name);
    return map;
  }, [clients]);

  if (!hydrated) return <PageHeader title="İletişim Kişileri" subtitle="Yükleniyor…" />;

  return (
    <>
      <PageHeader
        title="İletişim Kişileri"
        subtitle="Müşteri tarafındaki yetkililer ve onay verecek kişiler"
        action={
          <Button onClick={() => { setInitialForm(empty); setOpen(true); }}>
            <span className="flex items-center gap-1.5"><Plus className="h-4 w-4" /> Yeni Kişi</span>
          </Button>
        }
      />

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted">
              <th className="px-4 py-3 font-medium">İsim</th>
              <th className="px-4 py-3 font-medium">Müşteri</th>
              <th className="px-4 py-3 font-medium">Ünvan</th>
              <th className="px-4 py-3 font-medium">Telefon</th>
              <th className="px-4 py-3 font-medium">E-posta</th>
              <th className="px-4 py-3 font-medium">Onay</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {contacts.map((ct) => {
              const clientName = clientMap.get(ct.client_id || "") || "—";
              return (
                <tr key={ct.id} className="border-b border-border/60 hover:bg-surface-2/50">
                  <td className="px-4 py-3 font-medium text-foreground">{ct.full_name}</td>
                  <td className="px-4 py-3 text-muted">{clientName}</td>
                  <td className="px-4 py-3 text-muted">{ct.title || "—"}</td>
                  <td className="px-4 py-3 text-muted">{ct.phone || "—"}</td>
                  <td className="px-4 py-3 text-muted">{ct.email || "—"}</td>
                  <td className="px-4 py-3">{ct.is_approver ? <Badge tone="success">Onaycı</Badge> : <span className="text-muted">—</span>}</td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1">
                      <button onClick={() => { setInitialForm(ct); setOpen(true); }} className="rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-foreground"><Pencil className="h-4 w-4" /></button>
                      <button onClick={() => remove("contacts", ct.id)} className="rounded-md p-1.5 text-muted hover:bg-danger/15 hover:text-danger"><Trash2 className="h-4 w-4" /></button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {contacts.length === 0 && (
              <tr><td colSpan={7} className="py-6 text-center text-muted">Henüz kayıt yok.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <ContactModal open={open} onClose={() => setOpen(false)} initial={initialForm} clients={clients} />
    </>
  );
}
