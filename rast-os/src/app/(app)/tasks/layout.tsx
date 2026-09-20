import type { Metadata } from "next";

export const metadata: Metadata = { title: "Görevler · Rast OS" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
