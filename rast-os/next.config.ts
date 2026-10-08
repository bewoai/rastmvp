import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Herkese açık müşteri portalı: bağlantıdaki token başka sitelere Referer ile sızmasın, arama
  // motorları dizinlemesin (sayfa meta etiketlerine ek olarak HTTP başlığı; 0018).
  async headers() {
    return [
      {
        source: "/portal/:path*",
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
        ],
      },
    ];
  },
};

export default nextConfig;
