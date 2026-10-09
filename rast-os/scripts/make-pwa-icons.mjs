// PWA ikonlarını public/brand/rast-white.svg logosundan üretir (tek seferlik; çıktılar repoya girer).
// sharp, Next.js'in isteğe bağlı bağımlılığı olarak node_modules'ta bulunur; package.json'a eklenmedi.
// Kullanım (rast-os klasöründen): node scripts/make-pwa-icons.mjs
import { readFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const BG = "#141414"; // globals.css --background
const svgPath = fileURLToPath(new URL("../public/brand/rast-white.svg", import.meta.url));
const outDir = fileURLToPath(new URL("../public/icons/", import.meta.url));
const svg = await readFile(svgPath);
await mkdir(outDir, { recursive: true });

// Logonun gerçek sınırlarını bul (viewBox 1080x1080 içinde ortalanmamış olabilir).
const raw = await sharp(svg, { density: 72 })
  .resize(1080, 1080)
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });
let minX = 1080, minY = 1080, maxX = 0, maxY = 0;
for (let y = 0; y < 1080; y++) {
  for (let x = 0; x < 1080; x++) {
    if (raw.data[(y * 1080 + x) * 4 + 3] > 16) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }
}
const w = maxX - minX + 1;
const h = maxY - minY + 1;
console.log("logo sınırları", { minX, minY, w, h });
const logo = await sharp(svg, { density: 72 })
  .resize(1080, 1080)
  .extract({ left: minX, top: minY, width: w, height: h })
  .png()
  .toBuffer();

// fraction: logonun ikon genişliğine oranı. "any" ikonlarda geniş; "maskable" için güvenli bölge
// (merkez %80 daire) içinde kalacak kadar küçük.
async function make(size, fraction, out) {
  const target = Math.round(size * fraction);
  const scale = Math.min(target / w, target / h);
  const lw = Math.max(1, Math.round(w * scale));
  const lh = Math.max(1, Math.round(h * scale));
  const resized = await sharp(logo).resize(lw, lh).toBuffer();
  await sharp({ create: { width: size, height: size, channels: 4, background: BG } })
    .composite([{ input: resized, left: Math.round((size - lw) / 2), top: Math.round((size - lh) / 2) }])
    .png()
    .toFile(outDir + out);
  console.log("yazıldı", out);
}

await make(192, 0.62, "icon-192.png");
await make(512, 0.62, "icon-512.png");
await make(192, 0.46, "maskable-192.png");
await make(512, 0.46, "maskable-512.png");
await make(180, 0.62, "apple-touch-icon.png");
