// Herkese açık müşteri portalının (/portal/[token]) sunucu tarafı veri okuması.
// Supabase varsa: anon anahtarla portal_get / portal_touch / portal_report_get RPC'leri (oturum / çerez
// kullanılmaz; 0018). Supabase yoksa (demo): seed'den, aynı kurallarla (portal-logic.ts).
import { createAnonClient } from "./supabase/anon";
import { isSupabaseConfigured } from "./env";
import { seed } from "./seed";
import { DEMO_AGENCY_NAME } from "./approval-public";
import {
  buildPortalPayload, buildPortalReportData, isValidPortalMonth, isValidPortalToken,
} from "./portal-logic";
import type { PortalPayload, PortalReportData, PortalSource } from "./portal-logic";

export type PortalResult =
  | { kind: "ok"; payload: PortalPayload }
  | { kind: "not_found" }
  | { kind: "error" };

export type PortalReportResult =
  | { kind: "ok"; data: PortalReportData }
  | { kind: "not_found" }
  | { kind: "error" };

const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

function demoSource(token: string, now: Date | number = Date.now()): PortalSource {
  return {
    token,
    tokens: seed.client_portal_tokens,
    clients: seed.clients,
    contents: seed.contents,
    shoots: seed.shoots,
    approvals: seed.content_approvals,
    reports: seed.client_reports,
    agencyName: DEMO_AGENCY_NAME,
    creatorName: "Berat",
    now,
  };
}

/** Demo modu: portal_get ile aynı biçim. */
export const demoPortal = (token: string, now?: Date | number) => buildPortalPayload(demoSource(token, now));

/** Demo modu: portal_report_get ile aynı biçim. */
export const demoPortalReport = (token: string, month: string, now?: Date | number) =>
  buildPortalReportData({ ...demoSource(token, now), brands: seed.brands }, month);

/** RPC yanıtındaki dizileri garanti eder (eksik alan sayfayı çökertmesin). */
function normalizePayload(p: PortalPayload): PortalPayload {
  const contents = arr<PortalPayload["contents"][number]>(p.contents);
  const pending = arr<PortalPayload["pending"][number]>(p.pending);
  return {
    ...p,
    contents,
    pending,
    pending_count: Number(p.pending_count ?? pending.length) || 0,
    shoots: arr(p.shoots),
    latest_report: p.latest_report
      ? { ...p.latest_report, highlights: p.latest_report.highlights ?? {} }
      : null,
  };
}

export async function getPortal(token: string): Promise<PortalResult> {
  if (!isValidPortalToken(token)) return { kind: "not_found" };

  if (!isSupabaseConfigured) {
    const payload = demoPortal(token);
    return payload ? { kind: "ok", payload } : { kind: "not_found" };
  }

  try {
    const { data, error } = await createAnonClient().rpc("portal_get", { p_token: token });
    if (error) {
      console.error("[portal] portal_get hatası:", error.message);
      return { kind: "error" };
    }
    if (!data || typeof data !== "object") return { kind: "not_found" };
    return { kind: "ok", payload: normalizePayload(data as PortalPayload) };
  } catch (e) {
    console.error("[portal] portal_get bağlantı hatası:", e instanceof Error ? e.message : e);
    return { kind: "error" };
  }
}

/** "Son görüntülenme"yi günceller. Hata sayfayı etkilemez; demo modunda no-op. */
export async function touchPortal(token: string): Promise<void> {
  if (!isSupabaseConfigured || !isValidPortalToken(token)) return;
  try {
    const { error } = await createAnonClient().rpc("portal_touch", { p_token: token });
    if (error) console.error("[portal] portal_touch hatası:", error.message);
  } catch (e) {
    console.error("[portal] portal_touch bağlantı hatası:", e instanceof Error ? e.message : e);
  }
}

export async function getPortalReport(token: string, month: string): Promise<PortalReportResult> {
  if (!isValidPortalToken(token) || !isValidPortalMonth(month)) return { kind: "not_found" };

  if (!isSupabaseConfigured) {
    const data = demoPortalReport(token, month);
    return data ? { kind: "ok", data } : { kind: "not_found" };
  }

  try {
    const { data, error } = await createAnonClient().rpc("portal_report_get", { p_token: token, p_period: month });
    if (error) {
      console.error("[portal] portal_report_get hatası:", error.message);
      return { kind: "error" };
    }
    if (!data || typeof data !== "object") return { kind: "not_found" };
    const d = data as PortalReportData;
    return {
      kind: "ok",
      data: {
        ...d,
        brand_names: arr<string>(d.brand_names),
        contents: arr<PortalReportData["contents"][number]>(d.contents).map((c) => ({ ...c, approvals: arr(c.approvals) })),
        shoots: arr(d.shoots),
        report: { ...d.report, highlights: d.report?.highlights ?? {} },
      },
    };
  } catch (e) {
    console.error("[portal] portal_report_get bağlantı hatası:", e instanceof Error ? e.message : e);
    return { kind: "error" };
  }
}
