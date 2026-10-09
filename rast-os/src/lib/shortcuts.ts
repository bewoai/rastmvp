// Klavye kısayolları — saf mantık: "g" + harf ile gezinme tablosu, yardım listesi ve "yazı yazılıyor mu"
// denetimi. Dinleyici: src/components/KeyboardShortcuts.tsx. Testler: scripts/shortcuts-logic.test.mjs

/** "g" sonra bu harf → sayfa. */
export const GOTO_SHORTCUTS: { key: string; href: string; label: string }[] = [
  { key: "b", href: "/", label: "Bugün" },
  { key: "g", href: "/tasks", label: "Görevler" },
  { key: "p", href: "/projects", label: "Projeler" },
  { key: "m", href: "/crm/clients", label: "Müşteriler" },
  { key: "f", href: "/finance/invoices", label: "Faturalar" },
  { key: "t", href: "/teklifler", label: "Teklifler" },
  { key: "l", href: "/crm/leads", label: "Potansiyel müşteriler" },
];

/** "g"den sonra ikinci tuşun beklendiği süre. */
export const GOTO_TIMEOUT_MS = 1500;

/** İkinci tuşun hedefi (büyük/küçük harf ve Türkçe klavye "ğ"/"ı" gibi farklar gözetilmez; yalnız tablo). */
export function gotoHref(key: string): string | undefined {
  const k = key.toLocaleLowerCase("tr-TR");
  return GOTO_SHORTCUTS.find((s) => s.key === k)?.href;
}

/** Yardım penceresindeki genel kısayollar. */
export const GENERAL_SHORTCUTS: { keys: string[]; label: string }[] = [
  { keys: ["Ctrl", "K"], label: "Ara: kayıtlar ve ekranlar (Mac: ⌘ K)" },
  { keys: ["Q"], label: "Hızlı görev ekle" },
  { keys: ["?"], label: "Bu yardım penceresi" },
  { keys: ["Esc"], label: "Pencereyi / menüyü kapat" },
];

type MaybeEditable = {
  tagName?: string;
  isContentEditable?: boolean;
  type?: string;
  closest?: (sel: string) => unknown;
} | null | undefined;

const TEXTLESS_INPUTS = new Set(["checkbox", "radio", "button", "submit", "reset", "range", "color", "file", "image"]);

/**
 * Yazı alanı odakta mı? input (metin türleri) / textarea / select / contenteditable → kısayollar çalışmaz.
 * Onay kutusu, düğme gibi metin almayan input'larda kısayollar çalışır.
 */
export function isTypingTarget(target: unknown): boolean {
  const el = target as MaybeEditable;
  if (!el || typeof el !== "object") return false;
  if (el.isContentEditable) return true;
  const tag = (el.tagName ?? "").toUpperCase();
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag === "INPUT") return !TEXTLESS_INPUTS.has((el.type ?? "text").toLowerCase());
  // contenteditable bir kabın içindeki düğüm (ör. zengin metin)
  return Boolean(el.closest?.("[contenteditable=''],[contenteditable='true']"));
}
