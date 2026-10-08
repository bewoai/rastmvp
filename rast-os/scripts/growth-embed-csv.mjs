// scripts/data/hedef-klinikler-2026-10.csv → src/lib/growth/hedef-klinikler.ts (uygulamaya gömülü kopya).
// CSV değişince çalıştır: node scripts/growth-embed-csv.mjs   (testler iki kopyanın eşit olduğunu denetler)
import { readFileSync, writeFileSync } from "node:fs";

const src = new URL("./data/hedef-klinikler-2026-10.csv", import.meta.url);
const out = new URL("../src/lib/growth/hedef-klinikler.ts", import.meta.url);
// BOM ve satır sonu (CRLF/LF, git autocrlf) bağımsız
const csv = readFileSync(src, "utf8").replace(/^﻿/, "").replace(/\r\n/g, "\n");

writeFileSync(
  out,
  `// OTOMATİK ÜRETİLDİ — elle düzenleme. Kaynak: scripts/data/hedef-klinikler-2026-10.csv\n` +
    `// Yeniden üret: node scripts/growth-embed-csv.mjs\n` +
    `// Elle araştırılmış hedef klinik listesi (Google Places verisi DEĞİL) → tüm alanlarıyla saklanabilir.\n` +
    `export const HEDEF_KLINIKLER_CSV: string = ${JSON.stringify(csv)};\n`,
);
console.log("yazıldı:", out.pathname);
