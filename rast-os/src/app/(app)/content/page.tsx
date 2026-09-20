"use client";

import { useMemo, useState } from "react";
import {
  ArrowRight, CalendarDays, Download, Eye, FileText, Lightbulb, LoaderCircle,
  Paperclip, Plus, Trash2, Upload,
} from "lucide-react";
import { PageHeader, EmptyState } from "@/components/ui";
import { FormModal, Modal, Field, Input, Select, Textarea, MoreFields, Button, useFormState } from "@/components/form";
import { FilterChips, PageLoading, RowActions, SearchBox, StatusSelect, Tabs, Toolbar, useListSearch, useNewIntent, usePersistentState } from "@/components/list";
import { useDeleteConfirm } from "@/components/confirm";
import { useStore, useHydrated, uid, nowISO } from "@/lib/store";
import type { MutationResult } from "@/lib/store";
import { useToday } from "@/lib/useToday";
import { patchRecord } from "@/lib/mutate";
import { useToasts } from "@/lib/toast";
import { contentStatus } from "@/lib/labels";
import { createClient } from "@/lib/supabase/client";
import type { Brand, Content, ContentAttachment, ContentStatus } from "@/lib/types";

type ContentView = "calendar" | "ideas";
type FormMode = "content" | "idea";
type Scope = "active" | "done" | "all";
const VIEWS: readonly ContentView[] = ["calendar", "ideas"];
const SCOPES: readonly Scope[] = ["active", "done", "all"];
const DONE: ContentStatus[] = ["published", "archived"];

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

const calendarStatusOptions = (Object.keys(contentStatus) as ContentStatus[])
  .filter((value) => value !== "idea")
  .map((value) => ({ value, ...contentStatus[value] }));

const acceptedFiles = ".pdf,.xlsx,.xls,.csv,.tsv,.txt";

function readableSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function safeFileName(name: string) {
  return name.normalize("NFKD").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-").slice(-120);
}

const monthTitle = (key: string) => {
  if (key === "none") return "Tarihsiz";
  const [y, m] = key.split("-").map(Number);
  return new Intl.DateTimeFormat("tr-TR", { month: "long", year: "numeric" }).format(new Date(y, m - 1, 1));
};
const dayLabel = (d: string) => new Date(`${d.slice(0, 10)}T12:00:00`).toLocaleDateString("tr-TR", { day: "numeric", month: "short" });

async function downloadAttachment(attachment: ContentAttachment) {
  if (attachment.storage_path) {
    const { data, error } = await createClient().storage.from("content-files").createSignedUrl(attachment.storage_path, 120);
    if (error || !data?.signedUrl) {
      useToasts.getState().push({ message: "Dosya bağlantısı oluşturulamadı.", tone: "danger" });
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  } else if (attachment.url) {
    window.open(attachment.url, "_blank", "noopener,noreferrer");
  }
}

function AttachmentChips({ attachments, onRead }: { attachments?: ContentAttachment[]; onRead: (a: ContentAttachment) => void }) {
  if (!attachments?.length) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {attachments.map((attachment) => (
        <div key={attachment.id} className="flex items-center gap-0.5 rounded-md border border-border bg-background pl-2 text-xs text-muted">
          <FileText className="h-3.5 w-3.5 text-amber" aria-hidden />
          <span className="ml-1 max-w-[180px] truncate">{attachment.name}</span>
          <button type="button" onClick={() => onRead(attachment)} title="İçeriği oku" aria-label={`İçeriği oku: ${attachment.name}`} className="flex h-8 w-8 items-center justify-center hover:text-foreground"><Eye className="h-3.5 w-3.5" aria-hidden /></button>
          {(attachment.storage_path || attachment.url) && (
            <button type="button" onClick={() => downloadAttachment(attachment)} title="Dosyayı aç" aria-label={`Dosyayı aç: ${attachment.name}`} className="flex h-8 w-8 items-center justify-center hover:text-foreground"><Download className="h-3.5 w-3.5" aria-hidden /></button>
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * İçerik formu + dosya yükleme. Form/dosya durumu burada yaşar (eskiden sayfa düzeyindeydi: her tuş
 * vuruşunda tüm takvim listesi yeniden render oluyordu). Kayıt hatasında modal açık kalır, girilenler ve
 * okunmuş dosyalar korunur; yüklenmiş depolama dosyaları hata halinde geri silinir.
 */
function ContentModal({ initial, mode, brands, onRead, onClose }: {
  initial: Content | null; mode: FormMode; brands: Brand[]; onRead: (a: ContentAttachment) => void; onClose: () => void;
}) {
  const f = useFormState<Content>(
    initial
      ? { ...empty, ...initial, status: mode === "content" && initial.status === "idea" ? "brief" : initial.status, attachments: initial.attachments ?? [] }
      : { ...empty, status: mode === "idea" ? "idea" : "brief", attachments: [] },
  );
  const { form } = f;
  const editing = Boolean(initial?.id);
  const supabaseEnabled = useStore((s) => s.supabase);
  const orgId = useStore((s) => s.orgId);
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [removedPaths, setRemovedPaths] = useState<string[]>([]);
  const [fileError, setFileError] = useState("");
  const reading = pendingFiles.some((item) => item.loading);

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
    f.set("attachments", (form.attachments ?? []).filter((item) => item.id !== attachment.id));
    if (attachment.storage_path) setRemovedPaths((current) => [...current, attachment.storage_path!]);
  }

  async function submit(): Promise<MutationResult> {
    if (!form.title.trim()) return { ok: false, error: `${mode === "idea" ? "Fikir" : "İçerik"} başlığı zorunludur.` };
    const failed = pendingFiles.find((item) => item.error || !item.attachment);
    if (failed) {
      setFileError("Okunamayan dosyayı listeden kaldırın veya yeniden yükleyin.");
      return { ok: false, error: "Okunamayan bir dosya var." };
    }

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
        title: form.title.trim(),
        id: contentId,
        status: mode === "idea" ? "idea" : form.status,
        attachments: [...(form.attachments ?? []), ...uploadedAttachments],
        created_at: form.created_at || nowISO(),
      };

      const s = useStore.getState();
      const result = editing ? await s.update("contents", contentId, payload) : await s.add("contents", payload);
      if (!result.ok) {
        throw new Error(editing
          ? `${result.error || "İçerik güncellenemedi."} 0006_content_attachments.sql geçişini çalıştırın.`
          : result.error || "İçerik kaydedilemedi.");
      }

      if (supabaseEnabled && removedPaths.length) {
        await createClient().storage.from("content-files").remove(removedPaths);
      }
      return { ok: true };
    } catch (error) {
      if (supabaseEnabled && uploadedPaths.length) await createClient().storage.from("content-files").remove(uploadedPaths);
      return { ok: false, error: error instanceof Error ? error.message : "Kayıt tamamlanamadı." };
    }
  }

  return (
    <FormModal
      size="xl"
      title={editing ? (mode === "idea" ? "Fikri düzenle" : "İçeriği düzenle") : (mode === "idea" ? "Yeni içerik fikri" : "Yeni içerik")}
      onClose={onClose}
      onSubmit={submit}
      submitDisabled={reading}
      submitDisabledLabel="Dosya okunuyor…"
      successMessage={mode === "idea" ? "Fikir kaydedildi" : "İçerik kaydedildi"}
    >
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1.15fr_0.85fr]">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2"><Field label={mode === "idea" ? "Fikir başlığı *" : "İçerik başlığı *"}><Input {...f.text("title")} autoComplete="off" /></Field></div>
          <Field label="Marka">
            <Select {...f.text("brand_id")}><option value="">Seçin</option>{brands.map((brand) => <option key={brand.id} value={brand.id}>{brand.name}</option>)}</Select>
          </Field>
          <Field label="Platform">
            <Select {...f.text("platform")}>{["Instagram", "TikTok", "YouTube", "LinkedIn", "Facebook"].map((platform) => <option key={platform}>{platform}</option>)}</Select>
          </Field>
          <Field label="İçerik türü">
            <Select {...f.text("content_type")}>{["reels", "post", "story", "video", "carousel", "blog", "diğer"].map((type) => <option key={type}>{type}</option>)}</Select>
          </Field>
          {mode === "content" ? (
            <>
              <Field label="Durum"><Select {...f.text("status")}>{calendarStatusOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select></Field>
              <Field label="Planlanan yayın"><Input type="date" {...f.text("planned_date")} /></Field>
            </>
          ) : (
            <div className="flex items-end"><p className="rounded-lg bg-amber/10 px-3 py-2 text-xs text-amber">Tarih vermeden fikir havuzunda saklanır.</p></div>
          )}
          <div className="sm:col-span-2"><Field label="Hook / giriş cümlesi"><Textarea rows={2} {...f.text("hook")} /></Field></div>
          <div className="sm:col-span-2"><Field label={mode === "idea" ? "Fikir detayları" : "Senaryo / içerik notları"}><Textarea rows={5} {...f.text("script")} /></Field></div>
          <MoreFields label="Ek alanlar (amaç, caption, CTA)" defaultOpen={editing}>
            <div className="sm:col-span-2"><Field label="İçeriğin amacı"><Input placeholder="Bilgilendirme, satış, etkileşim…" {...f.text("goal")} /></Field></div>
            <div className="sm:col-span-2"><Field label="Caption"><Textarea rows={4} {...f.text("caption")} /></Field></div>
            <div className="sm:col-span-2"><Field label="CTA"><Input placeholder="Takip et, iletişime geç, web sitesini ziyaret et…" {...f.text("cta")} /></Field></div>
          </MoreFields>
        </div>

        <div className="self-start rounded-xl border border-border bg-surface-2/40 p-4">
          <div className="flex items-center gap-2"><Paperclip className="h-4 w-4 text-amber" aria-hidden /><h3 className="text-sm font-semibold text-foreground">Brief ve kaynak dosyaları</h3></div>
          <p className="mt-1 text-xs text-muted">PDF, Excel, CSV veya TXT yükleyin. Sistem içindeki metni ve tabloyu okuyarak bu kayıtta saklar.</p>
          <label className="mt-4 flex cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-border px-4 py-6 text-center focus-within:border-amber/60 hover:border-amber/50 hover:bg-amber/5">
            <Upload className="h-6 w-6 text-amber" aria-hidden />
            <span className="mt-2 text-sm font-medium text-foreground">Dosya seç</span>
            <span className="mt-1 text-xs text-muted">PDF / XLSX / XLS / CSV / TXT · en fazla 20 MB</span>
            <input type="file" multiple accept={acceptedFiles} className="sr-only" onChange={(event) => { extractFiles(event.target.files); event.currentTarget.value = ""; }} />
          </label>

          <div className="mt-4 space-y-2">
            {(form.attachments ?? []).map((attachment) => (
              <div key={attachment.id} className="rounded-lg border border-border bg-background p-3">
                <div className="flex items-start gap-2">
                  <FileText className="mt-0.5 h-4 w-4 shrink-0 text-amber" aria-hidden />
                  <div className="min-w-0 flex-1"><p className="truncate text-xs font-medium text-foreground">{attachment.name}</p><p className="text-[11px] text-muted">{readableSize(attachment.size)}{attachment.page_count ? ` · ${attachment.page_count} sayfa` : ""}{attachment.sheet_names?.length ? ` · ${attachment.sheet_names.length} çalışma sayfası` : ""}</p></div>
                  <button onClick={() => onRead(attachment)} type="button" title="İçeriği oku" aria-label={`İçeriği oku: ${attachment.name}`} className="p-1 text-muted hover:text-foreground"><Eye className="h-4 w-4" aria-hidden /></button>
                  <button onClick={() => removeExistingAttachment(attachment)} type="button" title="Kaldır" aria-label={`Kaldır: ${attachment.name}`} className="p-1 text-muted hover:text-danger"><Trash2 className="h-4 w-4" aria-hidden /></button>
                </div>
              </div>
            ))}
            {pendingFiles.map((pending) => (
              <div key={pending.id} className="rounded-lg border border-border bg-background p-3">
                <div className="flex items-start gap-2">
                  {pending.loading ? <LoaderCircle className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-amber" aria-hidden /> : <FileText className="mt-0.5 h-4 w-4 shrink-0 text-amber" aria-hidden />}
                  <div className="min-w-0 flex-1"><p className="truncate text-xs font-medium text-foreground">{pending.file.name}</p><p className={`text-[11px] ${pending.error ? "text-danger" : "text-muted"}`}>{pending.loading ? "Dosya okunuyor…" : pending.error || `${readableSize(pending.file.size)} · Okundu`}</p></div>
                  {pending.attachment && <button onClick={() => onRead(pending.attachment!)} type="button" title="İçeriği oku" aria-label={`İçeriği oku: ${pending.file.name}`} className="p-1 text-muted hover:text-foreground"><Eye className="h-4 w-4" aria-hidden /></button>}
                  <button onClick={() => setPendingFiles((current) => current.filter((item) => item.id !== pending.id))} type="button" title="Kaldır" aria-label={`Kaldır: ${pending.file.name}`} className="p-1 text-muted hover:text-danger"><Trash2 className="h-4 w-4" aria-hidden /></button>
                </div>
              </div>
            ))}
          </div>
          {fileError && <p role="alert" className="mt-3 rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger">{fileError}</p>}
        </div>
      </div>
    </FormModal>
  );
}

export default function ContentPage() {
  const hydrated = useHydrated(["contents", "clients", "brands"]);
  const contents = useStore((s) => s.contents);
  const brands = useStore((s) => s.brands);
  const today = useToday();

  const wantNew = useNewIntent();
  const [view, setView] = usePersistentState<ContentView>("content-view", "calendar", VIEWS);
  const [scope, setScope] = usePersistentState<Scope>("content-scope", "active", SCOPES);
  const [modal, setModal] = useState<{ initial: Content | null; mode: FormMode } | null>(() => (wantNew ? { initial: null, mode: "content" } : null));
  const [reading, setReading] = useState<ContentAttachment | null>(null);
  const [query, setQuery] = useState("");
  const del = useDeleteConfirm();

  // O(1) marka araması (eskiden her satırda brands.find → O(N·M))
  const brandMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const b of brands) map.set(b.id, b.name);
    return map;
  }, [brands]);

  const { calendarAll, ideasAll } = useMemo(() => {
    const cal: Content[] = [];
    const idea: Content[] = [];
    for (const item of contents) (item.status === "idea" ? idea : cal).push(item);
    cal.sort((a, b) => String(a.planned_date ?? "9999").localeCompare(String(b.planned_date ?? "9999")));
    idea.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    return { calendarAll: cal, ideasAll: idea };
  }, [contents]);

  const scopeCounts = useMemo(() => {
    let done = 0;
    for (const c of calendarAll) if (DONE.includes(c.status)) done++;
    return { active: calendarAll.length - done, done, all: calendarAll.length };
  }, [calendarAll]);

  const scopedCalendar = useMemo(
    () => (scope === "all" ? calendarAll : calendarAll.filter((c) => DONE.includes(c.status) === (scope === "done"))),
    [calendarAll, scope],
  );
  const haystack = (c: Content) => `${c.title} ${brandMap.get(c.brand_id ?? "") ?? ""} ${c.platform ?? ""} ${c.content_type ?? ""} ${c.hook ?? ""}`;
  const calendarItems = useListSearch(scopedCalendar, query, haystack);
  const ideas = useListSearch(ideasAll, query, haystack);

  // Aya göre gruplar (liste zaten tarihe göre sıralı); tarihsizler sonda
  const groups = useMemo(() => {
    const out: { key: string; items: Content[] }[] = [];
    for (const item of calendarItems) {
      const key = item.planned_date ? item.planned_date.slice(0, 7) : "none";
      const last = out[out.length - 1];
      if (last && last.key === key) last.items.push(item);
      else out.push({ key, items: [item] });
    }
    return out;
  }, [calendarItems]);

  if (!hydrated) return <PageLoading title="İçerik Merkezi" />;

  const openNew = (mode: FormMode) => setModal({ initial: null, mode });
  const openEdit = (item: Content, mode: FormMode = item.status === "idea" ? "idea" : "content") => setModal({ initial: item, mode });
  const label = (c: Content) => c.title;

  return (
    <>
      <PageHeader
        title="İçerik Merkezi"
        subtitle="Yayın takvimi, içerik fikirleri, briefler ve bağlı PDF/Excel dosyaları"
        action={
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" onClick={() => openNew("idea")}><Lightbulb className="h-4 w-4" aria-hidden /> Yeni Fikir</Button>
            <Button onClick={() => openNew("content")}><Plus className="h-4 w-4" aria-hidden /> Yeni İçerik</Button>
          </div>
        }
      />

      <Tabs
        label="İçerik görünümleri"
        value={view}
        onChange={setView}
        className="mb-3"
        tabs={[
          { id: "calendar", label: "İçerik Takvimi", count: scopeCounts.all, icon: <CalendarDays className="h-4 w-4" aria-hidden /> },
          { id: "ideas", label: "Fikir Havuzu", count: ideasAll.length, icon: <Lightbulb className="h-4 w-4" aria-hidden /> },
        ]}
      />

      <Toolbar>
        {view === "calendar" ? (
          <FilterChips
            label="İçerik kapsamı"
            value={scope}
            onChange={setScope}
            options={[
              { id: "active", label: "Aktif", count: scopeCounts.active },
              { id: "done", label: "Yayınlanan / arşiv", count: scopeCounts.done },
              { id: "all", label: "Tümü", count: scopeCounts.all },
            ]}
          />
        ) : (
          <span className="text-xs text-muted">{ideas.length} fikir</span>
        )}
        <SearchBox value={query} onChange={setQuery} placeholder="Başlık, marka, platform ara…" label="İçerik ara" />
      </Toolbar>

      {view === "calendar" && (
        <div role="tabpanel" aria-label="İçerik takvimi" className="space-y-4">
          {groups.map((g) => (
            <section key={g.key} aria-label={monthTitle(g.key)}>
              <h2 className="mb-1.5 flex items-baseline gap-2 px-1 text-xs font-semibold capitalize text-foreground">
                {monthTitle(g.key)}<span className="font-normal text-muted">{g.items.length}</span>
              </h2>
              <ul className="card divide-y divide-border/50 overflow-hidden">
                {g.items.map((item) => {
                  const late = Boolean(item.planned_date) && item.planned_date!.slice(0, 10) < today && !["published", "scheduled", "archived", "approved"].includes(item.status);
                  return (
                    <li key={item.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2.5 hover:bg-surface-2/40">
                      <div className="w-14 shrink-0 text-xs">
                        {item.planned_date ? <span className={late ? "font-medium text-danger" : "text-muted"}>{dayLabel(item.planned_date)}</span> : <span className="text-muted">—</span>}
                        {late && <span className="block text-[10px] text-danger">gecikti</span>}
                      </div>
                      <div className="min-w-0 flex-1 basis-56">
                        <button type="button" onClick={() => openEdit(item)} aria-label={`Düzenle: ${label(item)}`} className="block max-w-full truncate rounded text-left text-sm font-medium text-foreground outline-none hover:text-amber focus-visible:ring-2 focus-visible:ring-amber/60">{item.title}</button>
                        <p className="truncate text-xs text-muted">{brandMap.get(item.brand_id ?? "") || "Markasız"} · {item.platform} · {item.content_type}</p>
                        {item.hook && <p className="mt-0.5 line-clamp-1 text-xs text-muted"><span className="text-foreground/80">Hook:</span> {item.hook}</p>}
                        <AttachmentChips attachments={item.attachments} onRead={setReading} />
                      </div>
                      <StatusSelect value={item.status} options={calendarStatusOptions} label={`Durum: ${item.title}`} onChange={(status) => patchRecord("contents", item.id, { status }, "Durum güncellenemedi")} />
                      <RowActions label={item.title} onEdit={() => openEdit(item)} onDelete={() => del.ask({ key: "contents", id: item.id, label: item.title })} />
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
          {calendarItems.length === 0 && (
            <EmptyState
              title={query ? "Eşleşen içerik yok" : contents.length === 0 || calendarAll.length === 0 ? "Takvimde içerik bulunmuyor" : "Bu kapsamda içerik yok"}
              hint={query ? "Aramayı değiştir." : "Yeni içerik ekleyin veya fikir havuzundaki bir fikri takvime planlayın."}
              action={query ? undefined : { label: "Yeni İçerik", onClick: () => openNew("content") }}
            />
          )}
        </div>
      )}

      {view === "ideas" && (
        <div role="tabpanel" aria-label="Fikir havuzu" className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {ideas.map((idea) => (
            <div key={idea.id} className="card flex flex-col p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <button type="button" onClick={() => openEdit(idea)} aria-label={`Düzenle: ${idea.title}`} className="block max-w-full truncate rounded text-left font-medium text-foreground outline-none hover:text-amber focus-visible:ring-2 focus-visible:ring-amber/60">{idea.title}</button>
                  <p className="mt-1 text-xs text-muted">{brandMap.get(idea.brand_id ?? "") || "Markasız"} · {idea.platform || "Platform yok"} · {idea.content_type || "Tür yok"}</p>
                </div>
                <Lightbulb className="h-5 w-5 shrink-0 text-amber" aria-hidden />
              </div>
              {idea.goal && <p className="mt-3 text-xs text-muted"><span className="font-medium text-foreground">Amaç:</span> {idea.goal}</p>}
              {idea.hook && <p className="mt-2 text-xs text-muted"><span className="font-medium text-foreground">Hook:</span> {idea.hook}</p>}
              {idea.script && <p className="mt-2 line-clamp-4 whitespace-pre-wrap text-sm text-muted">{idea.script}</p>}
              <AttachmentChips attachments={idea.attachments} onRead={setReading} />
              <div className="mt-4 flex items-center justify-end gap-1 border-t border-border pt-2">
                <button type="button" onClick={() => openEdit(idea, "content")} className="mr-auto flex min-h-10 items-center gap-1 rounded-md px-2 text-xs text-amber hover:bg-amber/10"><ArrowRight className="h-4 w-4" aria-hidden /> Takvime planla</button>
                <RowActions label={idea.title} onEdit={() => openEdit(idea)} onDelete={() => del.ask({ key: "contents", id: idea.id, label: idea.title })} />
              </div>
            </div>
          ))}
          {ideas.length === 0 && (
            <div className="lg:col-span-2">
              <EmptyState
                title={query ? "Eşleşen fikir yok" : "Fikir havuzu boş"}
                hint={query ? "Aramayı değiştir." : "Aklınıza gelen içerik fikirlerini tarih vermeden burada biriktirebilirsiniz."}
                action={query ? undefined : { label: "Yeni Fikir", onClick: () => openNew("idea") }}
              />
            </div>
          )}
        </div>
      )}

      {modal && <ContentModal initial={modal.initial} mode={modal.mode} brands={brands} onRead={setReading} onClose={() => setModal(null)} />}

      <Modal
        open={Boolean(reading)}
        onClose={() => setReading(null)}
        size="lg"
        title={reading?.name ?? "Dosya içeriği"}
        footer={<>{reading && (reading.storage_path || reading.url) && <Button variant="ghost" onClick={() => downloadAttachment(reading)}><Download className="h-4 w-4" aria-hidden /> Dosyayı Aç</Button>}<Button onClick={() => setReading(null)}>Kapat</Button></>}
      >
        {reading?.sheet_names?.length ? <p className="mb-3 text-xs text-muted">Çalışma sayfaları: {reading.sheet_names.join(", ")}</p> : null}
        {reading?.page_count ? <p className="mb-3 text-xs text-muted">PDF sayfa sayısı: {reading.page_count}</p> : null}
        <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-background p-4 font-sans text-xs leading-6 text-muted">{reading?.extracted_text || "Bu dosyada okunabilir metin bulunamadı. PDF taranmış görüntülerden oluşuyor olabilir."}</pre>
      </Modal>
      {del.dialog}
    </>
  );
}
