// Çalıştırma: npm test  (Node'un yerleşik test runner'ı + type stripping)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  SCRIPT_SOURCE_CLAUDE_CODE, canAdvanceToScriptReady, clientMatches, draftToContentPatch, parseWritingDraft,
} from "../src/lib/writing-draft.ts";

// RAST-OS 08-Prompts/Skills/senaryo-uret/ornek-cikti.md'nin birebir kopyası
const EXAMPLE = readFileSync(new URL("./fixtures/writing-draft-claude-code.md", import.meta.url), "utf8");

// Eski rast-writer taslağı biçimi (09-Sources/Writing-Drafts/2026-09-19): Hook/Caption bölümü yok, varyasyonlu
const LEGACY = `---
type: writing-draft
client: Dr. Erdem Çalışkan
format: reel
duration_seconds: 40
canonical: false
approved: false
source: rast-writer
---

# Final Script

VARYASYON 1

Birinci metin. Harikasınız, kendinize iyi bakın.

VARYASYON 2

İkinci metin. Harikasınız, kendinize iyi bakın.

## Brief

Sıvı yüz germe nedir?

## Context Sources

- Client: \`03-Clients/dr-erdem-caliskan.md\`
`;

test("örnek çıktı: alanlar sözleşmeye göre ayrışır", () => {
  const r = parseWritingDraft(EXAMPLE);
  assert.equal(r.ok, true);
  const d = r.draft;
  assert.equal(d.client, "Dr. Erdem Çalışkan");
  assert.equal(d.format, "reel");
  assert.equal(d.durationSeconds, 45);
  assert.equal(d.source, SCRIPT_SOURCE_CLAUDE_CODE);
  assert.equal(d.regulationGate, "passed");
  assert.ok(d.script.startsWith("Her yorgun görünen yüz dolguya ihtiyaç duymaz."));
  assert.ok(d.script.endsWith("Harikasınız, kendinize iyi bakın."));
  // crm_sync.parse_draft ile aynı aralık: Brief ve sonrası senaryoya sızmaz
  assert.ok(!d.script.includes("## Brief"));
  assert.ok(!d.script.includes("#yüzanatomisi"));
  assert.equal(d.hook, "Her yorgun görünen yüz dolguya ihtiyaç duymaz.");
  assert.ok(d.caption?.startsWith("Yorgun görünüm"));
  assert.ok(d.caption?.includes("#yüzanatomisi #medikalestetik #doğalgörünüm"), "hashtag satırı başlık sanılmaz");
  assert.equal(d.cover, "Her yorgun yüz dolgu istemez");
  assert.ok(d.regulationCheck?.includes("9/9 geçti"));
  assert.equal(d.verificationNotes, undefined);
  assert.deepEqual(d.warnings, []);
  assert.equal(canAdvanceToScriptReady(d), true);
});

test("CRLF ve BOM tolere edilir", () => {
  const r = parseWritingDraft("﻿" + EXAMPLE.replace(/\n/g, "\r\n"));
  assert.equal(r.ok, true);
  assert.equal(r.draft.hook, "Her yorgun görünen yüz dolguya ihtiyaç duymaz.");
});

test("eski rast-writer taslağı: senaryo okunur, varyasyon ve kaynak uyarısı", () => {
  const r = parseWritingDraft(LEGACY);
  assert.equal(r.ok, true);
  assert.ok(r.draft.script.startsWith("VARYASYON 1"));
  assert.equal(r.draft.hook, undefined);
  assert.equal(r.draft.caption, undefined);
  assert.equal(r.draft.regulationGate, "unknown");
  assert.ok(r.draft.warnings.some((w) => w.includes("birden fazla varyasyon")));
  assert.ok(r.draft.warnings.some((w) => w.includes("rast-writer")));
});

test("Verification Notes / failed kapı: durum ilerlemez, uyarı verilir", () => {
  const withNotes = EXAMPLE.replace("## Context Sources", "## Verification Notes\n\n- DOĞRULANACAK: süre bilgisi\n\n## Context Sources");
  const a = parseWritingDraft(withNotes);
  assert.equal(a.ok, true);
  assert.ok(a.draft.verificationNotes?.includes("süre bilgisi"));
  assert.equal(canAdvanceToScriptReady(a.draft), false);
  assert.equal(draftToContentPatch(a.draft, "brief").status, undefined);
  assert.ok(a.draft.warnings.some((w) => w.includes("Verification Notes")));

  // Boş Verification Notes başlığı da bloke sayılır (crm_sync: başlığın varlığı yeterli)
  const emptyNotes = parseWritingDraft(EXAMPLE.replace("## Context Sources", "## Verification Notes\n\n## Context Sources"));
  assert.equal(canAdvanceToScriptReady(emptyNotes.draft), false);

  const failed = parseWritingDraft(EXAMPLE.replace("regulation_gate: passed", "regulation_gate: failed"));
  assert.equal(failed.draft.regulationGate, "failed");
  assert.equal(canAdvanceToScriptReady(failed.draft), false);
  assert.ok(failed.draft.warnings[0].includes("GEÇMEDİ"));
});

test("DOĞRULANACAK işareti senaryoda ise uyarı", () => {
  const r = parseWritingDraft(EXAMPLE.replace("Klinikte en sık", "DOĞRULANACAK: oran. Klinikte en sık"));
  assert.ok(r.draft.warnings.some((w) => w.includes("DOĞRULANACAK")));
});

test("geçersiz girdiler anlaşılır hata döndürür", () => {
  assert.equal(parseWritingDraft("").ok, false);
  assert.match(parseWritingDraft("# Final Script\n\nmetin").error, /Frontmatter/);
  assert.match(parseWritingDraft("---\ntype: research\n---\n# Final Script\nx").error, /writing-draft değil/);
  assert.match(parseWritingDraft("---\ntype: writing-draft\n---\n\n# Final Script\n\n## Brief\nkonu").error, /Final Script/);
  assert.match(parseWritingDraft("---\ntype: writing-draft\n---\n\n## Brief\nkonu").error, /Final Script/);
});

test("içerik yaması: yalnız sözleşmedeki alanlar + script_source; durum yalnız brief → script_ready", () => {
  const { draft } = parseWritingDraft(EXAMPLE);
  const patch = draftToContentPatch(draft, "brief");
  assert.deepEqual(Object.keys(patch).sort(), ["caption", "hook", "script", "script_source", "status"]);
  assert.equal(patch.script_source, "claude-code");
  assert.equal(patch.status, "script_ready");
  for (const status of ["idea", "script_ready", "editing", "approved", undefined]) {
    assert.equal(draftToContentPatch(draft, status).status, undefined, `durum ${status} değişmemeli`);
  }
  // Taslakta hook/caption yoksa mevcut değeri ezecek alan gönderilmez
  const legacy = parseWritingDraft(LEGACY).draft;
  assert.deepEqual(Object.keys(draftToContentPatch(legacy, "idea")).sort(), ["script", "script_source"]);
});

test("müşteri adı eşleşmesi", () => {
  assert.ok(clientMatches("Dr. Erdem Çalışkan", "Dr. Erdem Çalışkan"));
  assert.ok(clientMatches("Op. Dr. Duygu Cebecik Özmüş", "Duygu Cebecik Özmüş"));
  assert.ok(clientMatches("AYTAŞ HOME", "Aytaş Home"));
  assert.ok(clientMatches("Dr. Erdem Çalışkan", undefined), "müşteri bilinmiyorsa uyarı yok");
  assert.ok(!clientMatches("Dr. Erdem Çalışkan", "Aytaş Home"));
});
