// Müşteri portalının (/portal/...) açık temalı kabuğu: Rast markası, gizlilik alt bilgisi, "bulunamadı"
// ekranı ve durum rozetleri. Sunucu bileşeni (hook yok); uygulamanın koyu temasından bağımsızdır.
import { ShieldAlert } from "lucide-react";

export const PORTAL_PRIVACY_NOTE = "Bu sayfa gizli bağlantıyla paylaşılır; bağlantıyı iletmeyin.";

type Tone = "default" | "amber" | "success" | "warning" | "danger" | "muted";

const chipTone: Record<Tone, string> = {
  default: "bg-[#eef1f6] text-[#1B2A49] ring-[#dfe4ee]",
  amber: "bg-[#fff3e8] text-[#a8430a] ring-[#f7d3b8]",
  success: "bg-[#e8f5ee] text-[#1d6b41] ring-[#c4e5d2]",
  warning: "bg-[#fff7e0] text-[#8a5a00] ring-[#f1dfa6]",
  danger: "bg-[#fdecec] text-[#a12828] ring-[#f3c7c7]",
  muted: "bg-[#f3f4f7] text-[#5b6475] ring-[#e3e6ec]",
};

export function Chip({ tone = "default", children }: { tone?: Tone; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${chipTone[tone]}`}>
      {children}
    </span>
  );
}

export function Wordmark() {
  return (
    <span className="text-[15px] font-black tracking-[0.32em] text-[#1B2A49]" aria-label="Rast Creative">
      RAST <span className="text-[#E25303]">CREATIVE</span>
    </span>
  );
}

/** Açık zeminli tam sayfa kabuk (yazdırmada beyaz). */
export function PortalShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#f5f6f9] text-[#1f2533] print:bg-white">
      {children}
    </div>
  );
}

export function PortalFooter({ contactLine }: { contactLine?: string | null }) {
  return (
    <footer className="mt-10 border-t border-[#e3e6ec] pt-5 text-center text-xs leading-5 text-[#5b6475] print:hidden">
      {contactLine && <p className="text-[#1f2533]">{contactLine}</p>}
      <p className="mt-1 font-medium text-[#a8430a]">{PORTAL_PRIVACY_NOTE}</p>
    </footer>
  );
}

export function PortalNotFound({ kind, what = "Portal" }: { kind: "not_found" | "error"; what?: string }) {
  return (
    <PortalShell>
      <main className="mx-auto w-full max-w-lg px-4 pb-16 pt-10">
        <div className="mb-6 text-center"><Wordmark /></div>
        <div className="rounded-2xl border border-[#e3e6ec] bg-white p-6 text-center shadow-sm">
          <ShieldAlert className="mx-auto h-8 w-8 text-[#E25303]" aria-hidden />
          <h1 className="mt-3 text-lg font-bold text-[#1B2A49]">
            {kind === "not_found" ? `${what} bağlantısı bulunamadı` : `${what} şu anda açılamıyor`}
          </h1>
          <p className="mx-auto mt-2 max-w-sm text-sm text-[#5b6475]">
            {kind === "not_found"
              ? "Bağlantı eksik kopyalanmış, iptal edilmiş ya da süresi dolmuş olabilir. Ajanstan yeni bir bağlantı isteyin."
              : "Lütfen birkaç dakika sonra tekrar deneyin. Sorun sürerse ajansa haber verin."}
          </p>
        </div>
        <PortalFooter />
      </main>
    </PortalShell>
  );
}
