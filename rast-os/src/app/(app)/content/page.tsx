"use client";

import { useState } from "react";
import {
  ArrowRight, CalendarDays, Download, Eye, FileText, Lightbulb, LoaderCircle,
  Paperclip, Pencil, Plus, Trash2, Upload,
} from "lucide-react";
import { PageHeader, Badge, EmptyState } from "@/components/ui";
import { Modal, Field, Input, Select, Textarea, Button } from "@/components/form";
import { useStore, useHydrated, uid, nowISO } from "@/lib/store";
import { contentStatus, dateTR } from "@/lib/labels";
import { createClient } from "@/lib/supabase/client";
import type { Content, ContentAttachment, ContentStatus } from "@/lib/types";

type ContentView = "calendar" | "ideas";
type FormMode = "content" | "idea";
type PendingFile = {
  id: string;
  file: File;
  loading: boolean;
  error?: string;
  attachment?: ContentAttachment;
};

const empty: Content = {
  id: "", client_id: "", brand_id: "", title: "", platform: "Instagram",
  content_type: "reels", status: "brief", planned_date: "", caption: "",
  goal: "", hook: "", script: "", cta: "", references_url: "", attachments: [], created_at: "",
};

const acceptedFiles = ".pdf,.xlsx,.xls,.csv,.tsv,.txt";

function readableSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function safeFileName(name: string) {
  return name.normalize("NFKD").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-").slice(-120);
}

export default function ContentPage() {
  const hydrated = useHydrated(["contents", "clients", "brands"]);
  const contents = useStore((s) => s.contents);
  const brands = useStore((s) => s.brands);
  const supabaseEnabled = useStore((s) => s.supabase);
  const orgId = useStore((s) => s.orgId);
  const add = useStore((s) => s.add);
  const update = useStore((s) => s.update);
  const remove = useStore((s) => s.remove);

  const [view, setView] = useState<ContentView>("calendar");
  const [open, setOpen] = useState(false);
  const [formMode, setFormMode] = useState<FormMode>("content");
  const [form, setForm] = useState<Content>(empty);
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [removedPaths, setRemovedPaths] = useState<string[]>([]);
  const [fileError, setFileError] = useState("");
  const [saving, setSaving] = useState(false);
  const [reading, setReading] = useState<ContentAttachment | null>(null);
  const editing = Boolean(form.id);

  const calendarItems = hydrated
    ? contents.filter((item) => item.status !== "idea").sort((a, b) => String(a.planned_date ?? "").localeCompare(String(b.planned_date ?? "")))
    : [];
  const ideas = hydrated
    ? contents.filter((item) => item.status === "idea").sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    : [];

  function openNew(mode: FormMode) {
    setFormMode(mode);
    setForm({ ...empty, status: mode === "idea" ? "idea" : "brief", attachments: [] });
    setPendingFiles([]);
    setRemovedPaths([]);
    setFileError("");
    setOpen(true);
  }

  function openEdit(item: Content, mode: FormMode = item.status === "idea" ? "idea" : "content") {
    setFormMode(mode);
    setForm({ ...empty, ...item, status: mode === "content" && item.status === "idea" ? "brief" : item.status, attachments: item.attachments ?? [] });
    setPendingFiles([]);
    setRemovedPaths([]);
    setFileError("");
    setOpen(true);
  }

  async function extractFiles(fileList: FileList | null) {
    if (!fileList?.length) return;
    setFileError("");
    const entries = Array.from(fileList).map((file) => ({ id: uid(), file, loading: true } satisfies PendingFile));
    setPendingFiles((current) => [...current, ...entries]);

    await Promise.all(entries.map(async (entry) => {
      if (entry.file.size > 20 * 1024 * 1024) {
        setPendingFiles((current) => current.map((item) => item.id === entry.id ? { ...item, loading: false, error: "Dosya 20 MB sınırını aşıyor." } : item));
        return;
      }
      try {
        const body = new FormData();
        body.append("file", entry.file);
        const response = await fetch("/api/content-files/extract", { method: "POST", body });
        const result = await response.json() as { error?: string; text?: string; sheet_names?: string[]; page_count?: number };
        if (!response.ok) throw new Error(result.error || "Dosya okunamadı.");
        const attachment: ContentAttachment = {
          id: entry.id,
          name: entry.file.name,
          mime_type: entry.file.type,
          size: entry.file.size,
          extracted_text: result.text ?? "",
          sheet_names: result.sheet_names,
          page_count: result.page_count,
          uploaded_at: nowISO(),
        };
        setPendingFiles((current) => current.map((item) => item.id === entry.id ? { ...item, loading: false, attachment } : item));
      } catch (error) {
        const message = error instanceof Error ? error.message : "Dosya okunamadı.";
        setPendingFiles((current) => current.map((item) => item.id === entry.id ? { ...item, loading: false, error: message } : item));
      }
    }));
  }

  function removeExistingAttachment(attachment: ContentAttachment) {
    setForm((current) => ({ ...current, attachments: (current.attachments ?? []).filter((item) => item.id !== attachment.id) }));
    if (attachment.storage_path) setRemovedPaths((current) => [...current, attachment.storage_path!]);
  }

  async function save() {
    if (!form.title.trim() || pendingFiles.some((item) => item.loading)) return;
    const failed = pendingFiles.find((item) => item.error || !item.attachment);
    if (failed) {
      setFileError("Okunamayan dosyayı listeden kaldırın veya yeniden yükleyin.");
      return;
    }

    setSaving(true);
    setFileError("");
    const contentId = form.id || uid();
    const uploadedAttachments: ContentAttachment[] = [];
    const uploadedPaths: string[] = [];

    try {
      for (const pending of pendingFiles) {
        if (!pending.attachment) continue;
        const attachment = { ...pending.attachment };
        if (supabaseEnabled && orgId) {
          const storagePath = `${orgId}/${contentId}/${uid()}-${safeFileName(pending.file.name)}`;
          const sb = createClient();
          const { error } = await sb.storage.from("content-files").upload(storagePath, pending.file, { upsert: false, contentType: pending.file.type || undefined });
          if (error) throw new Error(`Dosya yüklenemedi: ${error.message}. 0006_content_attachments.sql geçişini çalıştırın.`);
          attachment.storage_path = storagePath;
          uploadedPaths.push(storagePath);
        } else {
          attachment.url = URL.createObjectURL(pending.file);
        }
        uploadedAttachments.push(attachment);
      }

      const payload: Content = {
        ...form,
        id: contentId,
        status: formMode === "idea" ? "idea" : form.status,
        attachments: [...(form.attachments ?? []), ...uploadedAttachments],
        created_at: form.created_at || nowISO(),
      };

      if (editing) {
        const result = await update("contents", contentId, payload);
        if (!result.ok) throw new Error(`${result.error || "İçerik güncellenemedi."} 0006_content_attachments.sql geçişini çalıştırın.`);
      } else {
        const result = await add("contents", payload);
        if (!result.ok) throw new Error(result.error || "İçerik kaydedilemedi.");
      }

      if (supabaseEnabled && removedPaths.length) {
        await createClient().storage.from("content-files").remove(removedPaths);
      }
      setOpen(false);
      setPendingFiles([]);
    } catch (error) {
      if (supabaseEnabled && uploadedPaths.length) await createClient().storage.from("content-files").remove(uploadedPaths);
      setFileError(error instanceof Error ? error.message : "Kayıt tamamlanamadı.");
    } finally {
      setSaving(false);
    }
  }

  async function downloadAttachment(attachment: ContentAttachment) {
    if (attachment.storage_path) {
      const { data, error } = await createClient().storage.from("content-files").createSignedUrl(attachment.storage_path, 120);
      if (error || !data?.signedUrl) {
        setFileError("Dosya bağlantısı oluşturulamadı.");
        return;
      }
      window.open(data.signedUrl, "_blank", "noopener,noreferrer");
    } else if (attachment.url) {
      window.open(attachment.url, "_blank", "noopener,noreferrer");
    }
  }

  const attachmentActions = (attachments: ContentAttachment[] | undefined) => attachments?.length ? (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {attachments.map((attachment) => <div key={attachment.id} className="flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-xs text-muted">
        <FileText className="h-3.5 w-3.5 text-amber" />
        <span className="max-w-[180px] truncate">{attachment.name}</span>
        <button onClick={() => setReading(attachment)} title="İçeriği oku" className="p-0.5 hover:text-foreground"><Eye className="h-3.5 w-3.5" /></button>
        {(attachment.storage_path || attachment.url) && <button onClick={() => downloadAttachment(attachment)} title="Dosyayı aç" className="p-0.5 hover:text-foreground"><Download className="h-3.5 w-3.5" /></button>}
      </div>)}
    </div>
  ) : null;

  return (
    <>
      <PageHeader
        title="İçerik Merkezi"
        subtitle="Yayın takvimi, içerik fikirleri, briefler ve bağlı PDF/Excel dosyaları"
        action={<div className="flex flex-wrap gap-2">
          <Button variant="ghost" onClick={() => openNew("idea")}><span className="flex items-center gap-1.5"><Lightbulb className="h-4 w-4" /> Yeni Fikir</span></Button>
          <Button onClick={() => openNew("content")}><span className="flex items-center gap-1.5"><Plus className="h-4 w-4" /> Yeni İçerik</span></Button>
        </div>}
      />

      <div className="mb-5 flex flex-wrap gap-2 rounded-xl border border-border bg-surface p-2">
        <button onClick={() => setView("calendar")} className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm ${view === "calendar" ? "bg-amber text-background" : "text-muted hover:bg-surface-2 hover:text-foreground"}`}><CalendarDays className="h-4 w-4" /> İçerik Takvimi <Badge tone="muted">{calendarItems.length}</Badge></button>
        <button onClick={() => setView("ideas")} className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm ${view === "ideas" ? "bg-amber text-background" : "text-muted hover:bg-surface-2 hover:text-foreground"}`}><Lightbulb className="h-4 w-4" /> Fikir Havuzu <Badge tone="muted">{ideas.length}</Badge></button>
      </div>

      {view === "calendar" && <div className="space-y-2">
        {calendarItems.map((item) => {
          const brand = brands.find((brandItem) => brandItem.id === item.brand_id);
          return <div key={item.id} className="card flex flex-col gap-3 p-4 lg:flex-row lg:items-center">
            <div className="w-28 shrink-0">
              <p className="text-xs text-muted">{item.planned_date ? dateTR(item.planned_date) : "Tarihsiz"}</p>
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-foreground">{item.title}</p>
              <p className="text-xs text-muted">{brand?.name || "—"} · {item.platform} · {item.content_type}</p>
              {item.hook && <p className="mt-1 line-clamp-2 text-xs text-muted"><span className="text-foreground">Hook:</span> {item.hook}</p>}
              {attachmentActions(item.attachments)}
            </div>
            <select
              value={item.status}
              onChange={(event) => update("contents", item.id, { status: event.target.value as ContentStatus })}
              className="shrink-0 rounded-md border border-border bg-background px-2 py-1 text-xs text-muted outline-none focus:border-amber/60"
            >
              {Object.entries(contentStatus).filter(([key]) => key !== "idea").map(([key, value]) => <option key={key} value={key}>{value.label}</option>)}
            </select>
            <div className="flex shrink-0 gap-1">
              <button onClick={() => openEdit(item)} className="rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-foreground"><Pencil className="h-4 w-4" /></button>
              <button onClick={() => remove("contents", item.id)} className="rounded-md p-1.5 text-muted hover:bg-danger/15 hover:text-danger"><Trash2 className="h-4 w-4" /></button>
            </div>
          </div>;
        })}
        {hydrated && calendarItems.length === 0 && <EmptyState title="Takvimde içerik bulunmuyor" hint="Yeni içerik ekleyin veya fikir havuzundaki bir fikri takvime planlayın." />}
      </div>}

      {view === "ideas" && <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {ideas.map((idea) => {
          const brand = brands.find((brandItem) => brandItem.id === idea.brand_id);
          return <div key={idea.id} className="card flex flex-col p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium text-foreground">{idea.title}</p>
                <p className="mt-1 text-xs text-muted">{brand?.name || "Markasız"} · {idea.platform || "Platform yok"} · {idea.content_type || "Tür yok"}</p>
              </div>
              <Lightbulb className="h-5 w-5 shrink-0 text-amber" />
            </div>
            {idea.goal && <p className="mt-3 text-xs text-muted"><span className="font-medium text-foreground">Amaç:</span> {idea.goal}</p>}
            {idea.hook && <p className="mt-2 text-xs text-muted"><span className="font-medium text-foreground">Hook:</span> {idea.hook}</p>}
            {idea.script && <p className="mt-2 line-clamp-4 whitespace-pre-wrap text-sm text-muted">{idea.script}</p>}
            {attachmentActions(idea.attachments)}
            <div className="mt-4 flex items-center justify-end gap-1 border-t border-border pt-3">
              <button onClick={() => openEdit(idea, "content")} className="mr-auto flex items-center gap-1 rounded-md px-2 py-1.5 text-xs text-amber hover:bg-amber/10"><ArrowRight className="h-4 w-4" /> Takvime planla</button>
              <button onClick={() => openEdit(idea)} className="rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-foreground"><Pencil className="h-4 w-4" /></button>
              <button onClick={() => remove("contents", idea.id)} className="rounded-md p-1.5 text-muted hover:bg-danger/15 hover:text-danger"><Trash2 className="h-4 w-4" /></button>
            </div>
          </div>;
        })}
        {hydrated && ideas.length === 0 && <div className="lg:col-span-2"><EmptyState title="Fikir havuzu boş" hint="Aklınıza gelen içerik fikirlerini tarih vermeden burada biriktirebilirsiniz." /></div>}
      </div>}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        size="xl"
        title={editing ? (formMode === "idea" ? "Fikri düzenle" : "İçeriği düzenle") : (formMode === "idea" ? "Yeni içerik fikri" : "Yeni içerik")}
        footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Vazgeç</Button><Button onClick={save} disabled={saving || pendingFiles.some((item) => item.loading)}>{saving ? "Kaydediliyor…" : pendingFiles.some((item) => item.loading) ? "Dosya okunuyor…" : "Kaydet"}</Button></>}
      >
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1.15fr_0.85fr]">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2"><Field label={formMode === "idea" ? "Fikir başlığı *" : "İçerik başlığı *"}><Input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} /></Field></div>
            <Field label="Marka"><Select value={form.brand_id} onChange={(event) => setForm({ ...form, brand_id: event.target.value })}><option value="">Seçin</option>{brands.map((brand) => <option key={brand.id} value={brand.id}>{brand.name}</option>)}</Select></Field>
            <Field label="Platform"><Select value={form.platform} onChange={(event) => setForm({ ...form, platform: event.target.value })}>{["Instagram", "TikTok", "YouTube", "LinkedIn", "Facebook"].map((platform) => <option key={platform}>{platform}</option>)}</Select></Field>
            <Field label="İçerik türü"><Select value={form.content_type} onChange={(event) => setForm({ ...form, content_type: event.target.value })}>{["reels", "post", "story", "video", "carousel", "blog", "diğer"].map((type) => <option key={type}>{type}</option>)}</Select></Field>
            {formMode === "content" ? <>
              <Field label="Durum"><Select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as ContentStatus })}>{Object.entries(contentStatus).filter(([key]) => key !== "idea").map(([key, value]) => <option key={key} value={key}>{value.label}</option>)}</Select></Field>
              <Field label="Planlanan yayın"><Input type="date" value={form.planned_date} onChange={(event) => setForm({ ...form, planned_date: event.target.value })} /></Field>
            </> : <div className="flex items-end"><p className="rounded-lg bg-amber/10 px-3 py-2 text-xs text-amber">Tarih vermeden fikir havuzunda saklanır.</p></div>}
            <div className="sm:col-span-2"><Field label="İçeriğin amacı"><Input placeholder="Bilgilendirme, satış, etkileşim…" value={form.goal} onChange={(event) => setForm({ ...form, goal: event.target.value })} /></Field></div>
            <div className="sm:col-span-2"><Field label="Hook / giriş cümlesi"><Textarea rows={2} value={form.hook} onChange={(event) => setForm({ ...form, hook: event.target.value })} /></Field></div>
            <div className="sm:col-span-2"><Field label={formMode === "idea" ? "Fikir detayları" : "Senaryo / içerik notları"}><Textarea rows={6} value={form.script} onChange={(event) => setForm({ ...form, script: event.target.value })} /></Field></div>
            <div className="sm:col-span-2"><Field label="Caption"><Textarea rows={4} value={form.caption} onChange={(event) => setForm({ ...form, caption: event.target.value })} /></Field></div>
            <div className="sm:col-span-2"><Field label="CTA"><Input placeholder="Takip et, iletişime geç, web sitesini ziyaret et…" value={form.cta} onChange={(event) => setForm({ ...form, cta: event.target.value })} /></Field></div>
          </div>

          <div className="rounded-xl border border-border bg-surface-2/40 p-4">
            <div className="flex items-center gap-2"><Paperclip className="h-4 w-4 text-amber" /><h3 className="text-sm font-semibold text-foreground">Brief ve kaynak dosyaları</h3></div>
            <p className="mt-1 text-xs text-muted">PDF, Excel, CSV veya TXT yükleyin. Sistem içindeki metni ve tabloyu okuyarak bu kayıtta saklar.</p>
            <label className="mt-4 flex cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-border px-4 py-6 text-center hover:border-amber/50 hover:bg-amber/5">
              <Upload className="h-6 w-6 text-amber" />
              <span className="mt-2 text-sm font-medium text-foreground">Dosya seç</span>
              <span className="mt-1 text-xs text-muted">PDF / XLSX / XLS / CSV / TXT · en fazla 20 MB</span>
              <input type="file" multiple accept={acceptedFiles} className="hidden" onChange={(event) => { extractFiles(event.target.files); event.currentTarget.value = ""; }} />
            </label>

            <div className="mt-4 space-y-2">
              {(form.attachments ?? []).map((attachment) => <div key={attachment.id} className="rounded-lg border border-border bg-background p-3">
                <div className="flex items-start gap-2">
                  <FileText className="mt-0.5 h-4 w-4 shrink-0 text-amber" />
                  <div className="min-w-0 flex-1"><p className="truncate text-xs font-medium text-foreground">{attachment.name}</p><p className="text-[11px] text-muted">{readableSize(attachment.size)}{attachment.page_count ? ` · ${attachment.page_count} sayfa` : ""}{attachment.sheet_names?.length ? ` · ${attachment.sheet_names.length} çalışma sayfası` : ""}</p></div>
                  <button onClick={() => setReading(attachment)} type="button" title="İçeriği oku" className="p-1 text-muted hover:text-foreground"><Eye className="h-4 w-4" /></button>
                  <button onClick={() => removeExistingAttachment(attachment)} type="button" title="Kaldır" className="p-1 text-muted hover:text-danger"><Trash2 className="h-4 w-4" /></button>
                </div>
              </div>)}
              {pendingFiles.map((pending) => <div key={pending.id} className="rounded-lg border border-border bg-background p-3">
                <div className="flex items-start gap-2">
                  {pending.loading ? <LoaderCircle className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-amber" /> : <FileText className="mt-0.5 h-4 w-4 shrink-0 text-amber" />}
                  <div className="min-w-0 flex-1"><p className="truncate text-xs font-medium text-foreground">{pending.file.name}</p><p className={`text-[11px] ${pending.error ? "text-danger" : "text-muted"}`}>{pending.loading ? "Dosya okunuyor…" : pending.error || `${readableSize(pending.file.size)} · Okundu`}</p></div>
                  {pending.attachment && <button onClick={() => setReading(pending.attachment!)} type="button" title="İçeriği oku" className="p-1 text-muted hover:text-foreground"><Eye className="h-4 w-4" /></button>}
                  <button onClick={() => setPendingFiles((current) => current.filter((item) => item.id !== pending.id))} type="button" title="Kaldır" className="p-1 text-muted hover:text-danger"><Trash2 className="h-4 w-4" /></button>
                </div>
              </div>)}
            </div>
            {fileError && <p className="mt-3 rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger">{fileError}</p>}
          </div>
        </div>
      </Modal>

      <Modal
        open={Boolean(reading)}
        onClose={() => setReading(null)}
        size="lg"
        title={reading?.name ?? "Dosya içeriği"}
        footer={<>{reading && (reading.storage_path || reading.url) && <Button variant="ghost" onClick={() => downloadAttachment(reading)}><span className="flex items-center gap-1.5"><Download className="h-4 w-4" /> Dosyayı Aç</span></Button>}<Button onClick={() => setReading(null)}>Kapat</Button></>}
      >
        {reading?.sheet_names?.length ? <p className="mb-3 text-xs text-muted">Çalışma sayfaları: {reading.sheet_names.join(", ")}</p> : null}
        {reading?.page_count ? <p className="mb-3 text-xs text-muted">PDF sayfa sayısı: {reading.page_count}</p> : null}
        <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-background p-4 font-sans text-xs leading-6 text-muted">{reading?.extracted_text || "Bu dosyada okunabilir metin bulunamadı. PDF taranmış görüntülerden oluşuyor olabilir."}</pre>
      </Modal>
    </>
  );
}
