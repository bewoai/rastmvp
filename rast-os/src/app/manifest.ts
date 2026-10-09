import type { MetadataRoute } from "next";

// Kurulabilir uygulama (PWA) bildirimi. Renkler globals.css tasarım tokenlarından:
// --background (#141414) hem arka plan hem tema rengi. İkonlar scripts/make-pwa-icons.mjs ile üretilir.
// Service worker YOK: uygulama her zaman canlı veriyle/oturumla çalışır, çevrimdışı önbellek istemiyoruz.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Rast OS",
    short_name: "Rast OS",
    description: "Rast Creative ajans işletim sistemi — CRM, proje, içerik, prodüksiyon ve finans yönetimi.",
    lang: "tr",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#141414",
    theme_color: "#141414",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
