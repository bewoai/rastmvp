"use client";

import { FormModal, Field, Input, Select, Textarea, MoreFields, useFormState } from "@/components/form";
import { useStore, uid, nowISO } from "@/lib/store";
import { leadStatus, leadPipeline } from "@/lib/labels";
import type { Lead } from "@/lib/types";

const empty: Lead = {
  id: "", company_name: "", contact_person: "", phone: "", email: "",
  source: "", interested_in: "", est_budget: undefined, status: "new",
  next_followup_at: "", notes: "", created_at: "",
};

/** Lead oluştur/düzenle — hem Potansiyel Müşteriler hem Satış Pipeline sayfasında kullanılır. */
export default function LeadModal({ initial, onClose }: { initial: Lead | null; onClose: () => void }) {
  const f = useFormState<Lead>(initial ?? empty);
  const editing = Boolean(initial?.id);
  const { form } = f;

  async function submit() {
    if (!form.company_name.trim()) return { ok: false, error: "Firma adı zorunludur." };
    const payload = { ...form, company_name: form.company_name.trim() };
    const s = useStore.getState();
    return editing ? s.update("leads", form.id, payload) : s.add("leads", { ...payload, id: uid(), created_at: nowISO() });
  }

  return (
    <FormModal
      title={editing ? "Lead düzenle" : "Yeni lead"}
      onClose={onClose}
      onSubmit={submit}
      successMessage={editing ? "Lead güncellendi" : "Lead eklendi"}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field label="Firma adı *"><Input {...f.text("company_name")} placeholder="Firma" autoComplete="off" /></Field>
        </div>
        <Field label="Yetkili kişi"><Input {...f.text("contact_person")} /></Field>
        <Field label="Telefon"><Input type="tel" inputMode="tel" {...f.text("phone")} /></Field>
        <Field label="Durum">
          <Select {...f.text("status")}>
            {leadPipeline.map((s) => <option key={s} value={s}>{leadStatus[s].label}</option>)}
          </Select>
        </Field>
        <Field label="Sonraki takip"><Input type="date" {...f.text("next_followup_at")} /></Field>
        <MoreFields label="Ek alanlar (e-posta, kaynak, bütçe, not…)" defaultOpen={editing}>
          <Field label="E-posta"><Input type="email" inputMode="email" {...f.text("email")} /></Field>
          <Field label="Kaynak">
            <Select {...f.text("source")}>
              <option value="">Seçin</option>
              {["Referans", "Instagram", "Web sitesi", "Reklam", "LinkedIn", "Organik"].map((s) => <option key={s}>{s}</option>)}
            </Select>
          </Field>
          <Field label="Tahmini bütçe (₺)"><Input type="number" inputMode="decimal" min="0" {...f.num("est_budget")} /></Field>
          <Field label="İlgilendiği hizmet"><Input {...f.text("interested_in")} /></Field>
          <div className="sm:col-span-2"><Field label="Notlar"><Textarea {...f.text("notes")} /></Field></div>
        </MoreFields>
      </div>
    </FormModal>
  );
}
