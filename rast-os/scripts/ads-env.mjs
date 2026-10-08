// Ads scriptleri için ortak yardımcılar: .env.local okuyucu (yeni bağımlılık yok).
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** dotenv benzeri ayrıştırma: KEY=VALUE, # yorum, tırnaklı değerler, "export " öneki. */
export function parseEnv(text) {
  const out = {};
  for (const rawLine of String(text).replace(/^﻿/, "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    const quote = value[0];
    if ((quote === '"' || quote === "'") && value.lastIndexOf(quote) > 0) {
      value = value.slice(1, value.lastIndexOf(quote));
      if (quote === '"') value = value.replace(/\n/g, "\n");
    } else {
      value = value.replace(/\s+#.*$/, "");
    }
    out[match[1]] = value;
  }
  return out;
}

/** rast-os/.env.local dosyasını okur; process.env'de zaten tanımlı değerleri EZMEZ. */
export function loadEnvLocal(file) {
  const path = file ?? join(dirname(fileURLToPath(import.meta.url)), "..", ".env.local");
  if (!existsSync(path)) return { path, loaded: false };
  const parsed = parseEnv(readFileSync(path, "utf8"));
  for (const [key, value] of Object.entries(parsed)) {
    if (process.env[key] === undefined || process.env[key] === "") process.env[key] = value;
  }
  return { path, loaded: true };
}
