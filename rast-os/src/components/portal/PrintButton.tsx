"use client";

import { Printer } from "lucide-react";

/** Portal rapor görünümündeki "Yazdır / PDF kaydet" düğmesi (yazdırma otomatik başlamaz). */
export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-[#1B2A49] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#24375f]"
    >
      <Printer className="h-4 w-4" aria-hidden /> Yazdır / PDF kaydet
    </button>
  );
}
