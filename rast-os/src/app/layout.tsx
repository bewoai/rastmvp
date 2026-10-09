import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  // Sayfa başlıkları rota düzeninde (layout.tsx → metadata) tam metin olarak tanımlanır ("Görevler · Rast OS")
  title: "Rast OS — Ajans Operasyon Sistemi",
  description:
    "Rast Creative ajans işletim sistemi — CRM, proje, içerik, prodüksiyon ve finans yönetimi.",
  icons: {
    icon: "/brand/rast-white.svg",
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  // iOS "Ana Ekrana Ekle": tam ekran açılır, kısa ad ikonun altında görünür.
  appleWebApp: { capable: true, title: "Rast OS", statusBarStyle: "black" },
};

export const viewport: Viewport = {
  themeColor: "#141414", // globals.css --background (manifest.ts ile aynı)
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="tr"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full">{children}</body>
    </html>
  );
}
