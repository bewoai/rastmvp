import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

// Next.js 16: "proxy" konvansiyonu (eski "middleware" yerine)
export default async function proxy(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    // manifest.webmanifest: oturumsuz (giriş sayfası dahil) isteklerde /login'e yönlendirilmesin, yoksa kurulum bozulur.
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|brand|icons|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
