// Writing-draft (Claude Code "senaryo-uret" / rast-writer) markdown ayrıştırıcısı — saf, test edilir.
//
// Sözleşme (RAST-OS 08-Prompts/Skills/senaryo-uret/SKILL.md bölüm 5-6):
//   frontmatter: type: writing-draft, client, format, duration_seconds, canonical, approved, source, …
//   "# Final Script"  → contents.script   (crm_sync.parse_draft ile aynı aralık: "## Brief"e kadar)
//   "## Hook"         → contents.hook
//   "## Caption"      → contents.caption
//   "## Verification Notes" varsa → açık doğrulama maddesi: durum ilerletilmez (CRM medikal bloke kuralı)
//   regulation_gate: failed        → durum ilerletilmez
// Durum yalnız "brief" → "script_ready" ilerler (crm_sync ile aynı geçiş).

import type { ContentStatus } from "./types";

export const SCRIPT_SOURCE_CLAUDE_CODE = "claude-code";

export interface WritingDraft {
  meta: Record<string, string>;
  client: string;
  format: string;
  durationSeconds: number | null;
  source: string;
  regulationGate: "passed" | "failed" | "n/a" | "unknown";
  script: string;
  hook?: string;
  caption?: string;
  cover?: string;
  brief?: string;
  regulationCheck?: string;
  verificationNotes?: string;
  /** Kullanıcıya gösterilecek uyarılar (aktarımı engellemez). */
  warnings: string[];
}

export type ParseResult = { ok: true; draft: WritingDraft } | { ok: false; error: string };

const unquote = (v: string) => {
  const t = v.trim();
  return (t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'")) ? t.slice(1, -1) : t;
};

/** Basit YAML frontmatter: yalnız "anahtar: değer" satırları (iç içe yapı yok). */
function parseFrontmatter(text: string): { meta: Record<string, string>; body: string } | null {
  const m = /^﻿?---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n|$)/.exec(text);
  if (!m) return null;
  const meta: Record<string, string> = {};
  for (const line of m[1].split("\n")) {
    const kv = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line);
    if (kv) meta[kv[1].toLowerCase()] = unquote(kv[2]);
  }
  return { meta, body: text.slice(m[0].length) };
}

/** "# Başlık" / "## Başlık" bölümlerine ayırır; anahtar küçük harfli başlık. Aynı başlık iki kez gelirse ilki geçerli. */
function splitSections(body: string): Map<string, string> {
  const sections = new Map<string, string>();
  let current: string | null = null;
  let buffer: string[] = [];
  const flush = () => {
    if (current !== null && !sections.has(current)) sections.set(current, buffer.join("\n").trim());
  };
  for (const line of body.split("\n")) {
    const h = /^#{1,2}[ \t]+(.+?)[ \t]*#*[ \t]*$/.exec(line);
    if (h) {
      flush();
      current = h[1].trim().toLowerCase();
      buffer = [];
    } else if (current !== null) {
      buffer.push(line);
    }
  }
  flush();
  return sections;
}

const pick = (sections: Map<string, string>, ...names: string[]) => {
  for (const n of names) {
    const v = sections.get(n.toLowerCase());
    if (v !== undefined) return v;
  }
  return undefined;
};

const nonEmpty = (v?: string) => (v && v.trim() ? v.trim() : undefined);

export function parseWritingDraft(input: string): ParseResult {
  const text = input.replace(/\r\n?/g, "\n").trim();
  if (!text) return { ok: false, error: "Metin boş. senaryo-uret çıktısını yapıştırın." };

  const fm = parseFrontmatter(text);
  if (!fm) return { ok: false, error: "Frontmatter bulunamadı: dosya \"---\" satırıyla başlamalı (type: writing-draft)." };
  const { meta, body } = fm;
  if (meta.type !== "writing-draft") {
    return { ok: false, error: `Bu bir writing-draft değil (type: ${meta.type || "yok"}).` };
  }

  const sections = splitSections(body);
  const script = nonEmpty(pick(sections, "Final Script"));
  if (!script) return { ok: false, error: "\"# Final Script\" bölümü yok ya da boş." };

  const warnings: string[] = [];
  const verificationNotes = sections.has("verification notes") ? (sections.get("verification notes") ?? "") : undefined;
  const gateRaw = (meta.regulation_gate ?? "").toLowerCase();
  const regulationGate: WritingDraft["regulationGate"] =
    gateRaw === "passed" || gateRaw === "failed" || gateRaw === "n/a" ? gateRaw : "unknown";

  if (regulationGate === "failed") warnings.push("Mevzuat kapısı GEÇMEDİ (regulation_gate: failed). Yayın öncesi düzeltilmeli; gerekirse tabip odası görüşü alınmalı.");
  if (verificationNotes !== undefined) warnings.push("Açık doğrulama maddesi var (Verification Notes). Hekim doğrulayana kadar içerik \"Senaryo hazır\" yapılmaz.");
  if (/DOĞRULANACAK/u.test(script)) warnings.push("Senaryoda \"DOĞRULANACAK\" işareti var: hekim onayı olmadan bu cümleler çıkarılmalı.");
  if ((script.match(/^VARYASYON\s+\d+/gmu) ?? []).length > 1) warnings.push("Taslakta birden fazla varyasyon var: aktardıktan sonra birini seçip diğerlerini silin.");
  if (meta.approved === "true") warnings.push("Taslak \"approved: true\" diyor; uygulamada hekim onayı yine \"Onaya gönder\" ile alınır.");
  if (meta.source && meta.source !== SCRIPT_SOURCE_CLAUDE_CODE) warnings.push(`Kaynak "${meta.source}" (Claude Code değil).`);

  const duration = Number.parseInt(meta.duration_seconds ?? "", 10);

  return {
    ok: true,
    draft: {
      meta,
      client: meta.client ?? "",
      format: meta.format ?? "",
      durationSeconds: Number.isFinite(duration) && duration > 0 ? duration : null,
      source: meta.source ?? "",
      regulationGate,
      script,
      hook: nonEmpty(pick(sections, "Hook")),
      caption: nonEmpty(pick(sections, "Caption")),
      cover: nonEmpty(pick(sections, "Kapak", "Cover")),
      brief: nonEmpty(pick(sections, "Brief")),
      regulationCheck: nonEmpty(pick(sections, "Mevzuat Kontrolü")),
      verificationNotes,
      warnings,
    },
  };
}

/** Durum ilerletilebilir mi? (crm_sync: brief → script_ready; açık doğrulama / kapı hatası varken asla) */
export function canAdvanceToScriptReady(draft: WritingDraft): boolean {
  return draft.verificationNotes === undefined && draft.regulationGate !== "failed";
}

export interface DraftPatch {
  script: string;
  hook?: string;
  caption?: string;
  script_source: string;
  status?: ContentStatus;
}

/**
 * İçerik formuna yazılacak alanlar. Yalnız sözleşmedeki alanlar (hook, script, caption, status) +
 * script_source. Taslakta olmayan hook/caption mevcut değeri ezmez.
 */
export function draftToContentPatch(draft: WritingDraft, currentStatus: ContentStatus | undefined): DraftPatch {
  const patch: DraftPatch = { script: draft.script, script_source: SCRIPT_SOURCE_CLAUDE_CODE };
  if (draft.hook) patch.hook = draft.hook;
  if (draft.caption) patch.caption = draft.caption;
  if (currentStatus === "brief" && canAdvanceToScriptReady(draft)) patch.status = "script_ready";
  return patch;
}

/** Taslaktaki müşteri adı içerikteki müşteriyle uyuşuyor mu? (büyük/küçük harf ve "Dr./Op." öneklerinden bağımsız) */
export function clientMatches(draftClient: string, clientName: string | undefined): boolean {
  if (!draftClient.trim() || !clientName?.trim()) return true; // bilinmiyorsa uyarı üretme
  const norm = (s: string) =>
    s.toLocaleLowerCase("tr-TR").replace(/\b(op|dr|doç|prof|uzm)\.?/gu, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const a = norm(draftClient);
  const b = norm(clientName);
  return a === b || a.includes(b) || b.includes(a);
}
