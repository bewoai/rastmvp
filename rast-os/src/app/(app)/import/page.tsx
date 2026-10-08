"use client";

import { useState } from "react";
import { Upload, FileSpreadsheet, CheckCircle2, ArrowRight, Sparkles, AlertTriangle } from "lucide-react";
import { PageHeader, Panel, Badge } from "@/components/ui";
import { Select, Button } from "@/components/form";
import { useStore, useHydrated, uid, nowISO } from "@/lib/store";
import { useFx } from "@/lib/fx";
import { IMPORT_TARGETS, coerce, norm, type ImportTarget } from "@/lib/import-config";
import { isRastFinanceWorkbook, parseRastFinanceWorkbook } from "@/lib/rast-finance-import";
import { createClient } from "@/lib/supabase/client";
import type { RastData } from "@/lib/types";

type Cell = string | number | boolean;
type RawRow = Cell[];
type Row = Record<string, unknown>;

const SUMMARY_RE = /^(toplam|genel toplam|total|özet|ara toplam|net)\b/i;

/**
 * true: "Uygula" tüm silme/güncelleme/eklemeleri tek transaction'da yapan `import_rows` RPC'sini
 * çağırır (migration 0010). RPC henüz veritabanına uygulanmadıysa false yapın: eski yol
 * (satır satır, atomik değil) kullanılır. Demo modunda (Supabase yok) her zaman eski yol çalışır.
 */
const USE_RPC_IMPORT = true;

type Table = keyof RastData;
/** Kuru çalıştırma (dry-run) planındaki tek işlem. `row`: önizleme için kaydın kendisi. */
type PlanOp =
  | { op: "delete"; table: Table; id: string; row: Row }
  | { op: "update"; table: Table; id: string; patch: Row; row: Row }
  | { op: "insert"; table: Table; row: Row };

type ApplyCounts = { inserted: number; updated: number; deleted: number; failed: number };

interface ImportPlan {
  source: "rast" | "smart" | "manual";
  ops: PlanOp[];
  /** Zaten sistemde olduğu için eklenmeyecek kayıtlar. */
  duplicates: number;
  /** Tanınmayan / zorunlu alanı eksik satırlar. */
  skipped: number;
  /** Aynı dosyada iki kez geçen ve tek kayda birleştirilen satırlar (düzeltme sayılır). */
  merged: number;
  describe: (c: ApplyCounts) => string;
  /** Yalnızca başarılı uygulamadan sonra çalışan yan etkiler (kur ayarı, ekran durumu). */
  afterApply?: () => void;
}

const OP_LABEL: Record<PlanOp["op"], { label: string; tone: "success" | "amber" | "danger" }> = {
  insert: { label: "Ekle", tone: "success" },
  update: { label: "Güncelle", tone: "amber" },
  delete: { label: "Sil", tone: "danger" },
};

const tableLabel = (t: Table) => IMPORT_TARGETS.find((x) => x.key === t)?.label ?? t;
const pick = (r: Row, keys: string[]) => {
  for (const k of keys) if (r[k] !== undefined && r[k] !== null && r[k] !== "") return String(r[k]);
  return "—";
};

/** Boş string → null, undefined alanlar atılır (store.add ile aynı kural; Postgres date/numeric/uuid için). */
function cleanRow(r: Row): Row {
  return Object.fromEntries(Object.entries(r).filter(([, v]) => v !== undefined).map(([k, v]) => [k, v === "" ? null : v]));
}

function toPayload(plan: ImportPlan) {
  return {
    deletes: plan.ops.flatMap((o) => (o.op === "delete" ? [{ table: o.table, id: o.id }] : [])),
    updates: plan.ops.flatMap((o) => (o.op === "update" ? [{ table: o.table, id: o.id, patch: cleanRow(o.patch) }] : [])),
    inserts: plan.ops.flatMap((o) => (o.op === "insert" ? [{ table: o.table, row: cleanRow(o.row) }] : [])),
  };
}

/** RPC başarılı olduktan sonra aynı değişiklikleri yerel store'a uygular (yeniden çekmeden). */
function applyLocally(plan: ImportPlan) {
  useStore.setState((s) => {
    const next: Partial<Record<Table, Row[]>> = {};
    const rows = (t: Table) => next[t] ?? (s[t] as unknown as Row[]);
    for (const o of plan.ops) {
      if (o.op === "delete") next[o.table] = rows(o.table).filter((r) => r.id !== o.id);
      else if (o.op === "update") next[o.table] = rows(o.table).map((r) => (r.id === o.id ? { ...r, ...o.patch } : r));
      else next[o.table] = [o.row, ...rows(o.table)];
    }
    return next as unknown as Partial<RastData>;
  });
}

function getAutoMapping(hdrs: string[], target: ImportTarget): Record<string, string> {
  const map: Record<string, string> = {};
  const used = new Set<string>();

  for (const field of target.fields) {
    const exact = new Set([norm(field.name), norm(field.label), ...(field.aliases ?? []).map(norm)]);
    const hit = hdrs.find((header) => !used.has(header) && exact.has(norm(header)));
    if (hit) { map[field.name] = hit; used.add(hit); }
  }

  for (const field of target.fields) {
    if (map[field.name]) continue;
    const names = [norm(field.name), norm(field.label), ...(field.aliases ?? []).map(norm)];
    const hit = hdrs.find((header) => {
      if (used.has(header)) return false;
      const normalized = norm(header);
      return names.some((name) => name.length >= 4 && (normalized.includes(name) || name.includes(normalized)));
    });
    if (hit) { map[field.name] = hit; used.add(hit); }
  }

  return map;
}

function rowsToObjects(rows: RawRow[], headerRow: number): Row[] {
  const headers = rows[headerRow]?.map((cell, index) => String(cell).trim() || `Sütun ${index + 1}`) ?? [];
  return rows
    .slice(headerRow + 1)
    .filter((row) => row.some((cell) => String(cell).trim() !== ""))
    .map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""])));
}

function normalizeCurrency(value: unknown): "TRY" | "USD" | "EUR" | undefined {
  const text = String(value ?? "").trim().toUpperCase();
  if (/USD|DOLAR|\$/.test(text)) return "USD";
  if (/EUR|EURO|€/.test(text)) return "EUR";
  if (/TRY|TL|₺/.test(text)) return "TRY";
  return undefined;
}

export default function ImportPage() {
  // Tekrar/eşleşme kontrolü ve kuru çalıştırma mevcut kayıtlara bakar: hedef koleksiyonlar yüklü olmalı.
  const hydrated = useHydrated(["clients", "leads", "contacts", "brands", "jobs", "equipment", "expenses", "invoices"]);
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const isSupabase = useStore((s) => s.supabase);
  const add = useStore((s) => s.add);
  const update = useStore((s) => s.update);
  const remove = useStore((s) => s.remove);
  const setRate = useFx((s) => s.setRate);

  const [targetKey, setTargetKey] = useState<string>(IMPORT_TARGETS[0].key);
  const [fileName, setFileName] = useState<string>("");
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [sheetIdx, setSheetIdx] = useState(0);
  const [raw, setRaw] = useState<RawRow[]>([]);
  const [headerRow, setHeaderRow] = useState(0);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [result, setResult] = useState<string | null>(null);
  const [resultError, setResultError] = useState(false);
  const [smartComplete, setSmartComplete] = useState(false);
  const [busy, setBusy] = useState(false);

  // Workbook'u sakla (sayfa değişince yeniden okumak için)
  const [wb, setWb] = useState<unknown>(null);

  const target = IMPORT_TARGETS.find((t) => t.key === targetKey) as ImportTarget;

  // Seçili başlık satırına göre başlıklar ve veri satırları
  const headers: string[] =
    raw[headerRow]?.map((h, i) => String(h).trim() || `Sütun ${i + 1}`) ?? [];
  const dataRows: Row[] = raw
    .slice(headerRow + 1)
    .filter((r) => r.some((c) => String(c).trim() !== ""))
    .map((r) => {
      const o: Row = {};
      headers.forEach((h, i) => (o[h] = r[i] ?? ""));
      return o;
    });

  function guessHeaderRow(rows: RawRow[]): number {
    let best = 0, bestScore = -1;
    for (let i = 0; i < Math.min(rows.length, 15); i++) {
      const nonEmpty = rows[i].filter((c) => String(c).trim() !== "").length;
      const textCells = rows[i].filter((c) => typeof c === "string" && c.trim().length > 1).length;
      const score = nonEmpty + textCells;
      if (nonEmpty >= 2 && score > bestScore) { bestScore = score; best = i; }
    }
    return best;
  }

  async function loadSheet(workbook: unknown, idx: number, t: ImportTarget) {
    const XLSX = await import("xlsx");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = workbook as any;
    const ws = w.Sheets[w.SheetNames[idx]];
    const rows = XLSX.utils.sheet_to_json<RawRow>(ws, { header: 1, defval: "", blankrows: false });
    setRaw(rows);
    const hr = guessHeaderRow(rows);
    setHeaderRow(hr);
    autoMap(rows[hr]?.map((h, i) => String(h).trim() || `Sütun ${i + 1}`) ?? [], t);
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setResult(null); setResultError(false); setSmartComplete(false); setPlan(null);
    setFileName(file.name);
    const XLSX = await import("xlsx");
    const buf = await file.arrayBuffer();
    const workbook = XLSX.read(buf, { type: "array" });
    setWb(workbook);
    setSheetNames(workbook.SheetNames);
    setSheetIdx(0);
    await loadSheet(workbook, 0, target);
  }

  function autoMap(hdrs: string[], t: ImportTarget) {
    setMapping(getAutoMapping(hdrs, t));
  }

  function onTargetChange(key: string) {
    setTargetKey(key);
    setResult(null);
    setPlan(null);
    const t = IMPORT_TARGETS.find((x) => x.key === key)!;
    if (headers.length) autoMap(headers, t);
  }

  async function onSheetChange(idx: number) {
    setSheetIdx(idx);
    setResult(null);
    setPlan(null);
    if (wb) await loadSheet(wb, idx, target);
  }

  function onHeaderRowChange(hr: number) {
    setHeaderRow(hr);
    setPlan(null);
    const hdrs = raw[hr]?.map((h, i) => String(h).trim() || `Sütun ${i + 1}`) ?? [];
    autoMap(hdrs, target);
  }

  function buildItem(row: Row, selectedTarget = target, selectedMapping = mapping): Row | null {
    const item: Row = { ...selectedTarget.defaults, id: uid(), created_at: nowISO() };
    for (const f of selectedTarget.fields) {
      const col = selectedMapping[f.name];
      if (!col) continue;
      const val = coerce(row[col], f.type);
      if (val === undefined) continue;
      // Herhangi bir eşlenmiş metin alanı TOPLAM/ÖZET ile başlıyorsa satırı atla
      if (f.type === "text" && SUMMARY_RE.test(String(val))) return null;
      if (f.clientLookup) {
        const c = useStore.getState().clients.find((cl) => norm(cl.name) === norm(String(val)));
        if (c) item.client_id = c.id;
      } else {
        if (selectedTarget.key === "expenses" && f.name === "currency") {
          item.currency = normalizeCurrency(val) ?? "TRY";
        } else {
          item[f.name] = val;
        }
      }
    }
    if (selectedTarget.key === "expenses" && !selectedMapping.currency) {
      const amountColumn = selectedMapping.amount;
      item.currency = normalizeCurrency(amountColumn) ?? normalizeCurrency(row[amountColumn]) ?? "TRY";
    }
    for (const f of selectedTarget.fields) {
      if (f.required && !f.clientLookup) {
        const v = item[f.name];
        if (v === undefined || v === "") return null;
      }
    }
    return item;
  }

  /**
   * Mevcut kayıtlarda (planda silinecekler hariç) ve aynı planda eklenecek kayıtlarda eşini arar.
   * Eski yol kayıtları anında store'a eklediği için aynı dosyadaki tekrarlar da yakalanıyordu;
   * kuru çalıştırmada bunu `pending` ile koruyoruz.
   */
  function findDuplicate(key: ImportTarget["key"], item: Row, pending: PlanOp[] = []): Row | undefined {
    const identity: Partial<Record<ImportTarget["key"], string[]>> = {
      clients: ["name"], leads: ["company_name", "phone", "email"],
      contacts: ["full_name", "client_id", "phone"], brands: ["name", "client_id"],
      jobs: ["customer_name", "service", "date", "price"], equipment: ["name", "brand_model"],
      expenses: ["vendor", "description", "amount", "paid_at", "currency"],
      invoices: ["invoice_no", "client_id", "amount", "issue_date"],
    };
    const fields = identity[key] ?? [];
    if (!fields.some((field) => item[field] !== undefined && item[field] !== "")) return undefined;
    const deleted = new Set(pending.flatMap((o) => (o.op === "delete" && o.table === key ? [o.id] : [])));
    const planned = pending.flatMap((o) => (o.op === "insert" && o.table === key ? [o.row] : []));
    const current = (useStore.getState()[key] as unknown as Row[]).filter((row) => !deleted.has(String(row.id)));
    return [...planned, ...current].find((row) => fields.every((field) => String(row[field] ?? "") === String(item[field] ?? "")));
  }

  function detectPlan(rows: RawRow[], sheetName: string) {
    let best: { target: ImportTarget; headerRow: number; mapping: Record<string, string>; score: number } | null = null;
    for (let hr = 0; hr < Math.min(rows.length, 15); hr++) {
      const hdrs = rows[hr].map((cell, index) => String(cell).trim() || `Sütun ${index + 1}`);
      for (const candidate of IMPORT_TARGETS) {
        const candidateMapping = getAutoMapping(hdrs, candidate);
        const requiredOk = candidate.fields
          .filter((field) => field.required)
          .every((field) => candidateMapping[field.name]);
        const matched = Object.keys(candidateMapping).length;
        if (!requiredOk || matched < 2) continue;
        const sheetHint = norm(sheetName).includes(norm(candidate.label)) || norm(sheetName).includes(norm(candidate.key));
        const score = matched * 10 + (matched / candidate.fields.length) * 5 + (sheetHint ? 8 : 0);
        if (!best || score > best.score) best = { target: candidate, headerRow: hr, mapping: candidateMapping, score };
      }
    }
    return best;
  }

  // ---------------------------------------------------------------------------
  // 1) Kuru çalıştırma: dosyadan plan üret (veritabanına/store'a hiçbir şey yazmaz)
  // 2) Önizleme: ekle/güncelle/sil sayıları + ilk 10 işlem
  // 3) "Uygula": USE_RPC_IMPORT ise tek transaction'lık import_rows RPC'si, değilse eski yol
  // ---------------------------------------------------------------------------

  async function planRastFinance(
    XLSX: typeof import("xlsx"),
    workbook: { SheetNames: string[]; Sheets: Record<string, unknown> },
  ): Promise<ImportPlan | string> {
    if (useStore.getState().supabase) {
      const sb = createClient();
      const currencyCheck = await sb.from("expenses").select("currency").limit(1);
      if (currencyCheck.error) return "Veritabanı güncel değil: önce Supabase SQL Editor'de 0003_expense_currency.sql migration'ını çalıştır.";
      const plannedCheck = await sb.from("equipment").select("id").eq("status", "planned").limit(1);
      if (plannedCheck.error) return "Veritabanı güncel değil: önce Supabase SQL Editor'de 0004_equipment_planned.sql migration'ını çalıştır.";
      const installmentCheck = await sb.from("expenses").select("installment_number,installment_total,payment_status").limit(1);
      if (installmentCheck.error) return "Veritabanı güncel değil: önce Supabase SQL Editor'de 0005_expense_installments.sql migration'ını çalıştır.";
    }
    const sheets = Object.fromEntries(workbook.SheetNames.map((sheetName) => [
      sheetName,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      XLSX.utils.sheet_to_json<RawRow>(workbook.Sheets[sheetName] as any, { header: 1, defval: "", blankrows: false }),
    ]));
    const parsed = parseRastFinanceWorkbook({ sheetNames: workbook.SheetNames, sheets });
    const ops: PlanOp[] = [];
    let duplicates = 0, skipped = 0, merged = 0;

    // Eski sınıflandırma: sürekli müşterilerin "tekil iş" olarak aktarılmış eski kayıtları silinir
    const recurringNames = new Set([norm("Aytaş"), norm("Duygu Hoca"), norm("Newlife")]);
    for (const job of useStore.getState().jobs) {
      if (recurringNames.has(norm(job.customer_name)) && norm(job.service ?? "").startsWith(norm("Eski gelir kaydından aktarıldı"))) {
        ops.push({ op: "delete", table: "jobs", id: job.id, row: job as unknown as Row });
      }
    }

    const clientIds = new Map<string, string>();
    for (const record of parsed.records.filter((entry) => entry.key === "clients")) {
      const name = String(record.data.name ?? "");
      const normalizedName = norm(name);
      const existing = useStore.getState().clients.find((client) => {
        const current = norm(client.name);
        return current === normalizedName || (normalizedName === norm("Aytaş") && current.startsWith(norm("Aytaş")));
      });
      if (existing) {
        const contractStart = String(record.data.contract_start ?? "");
        const patch = {
          monthly_fee: Number(record.data.monthly_fee ?? existing.monthly_fee ?? 0),
          is_active: true,
          contract_start: existing.contract_start && existing.contract_start < contractStart
            ? existing.contract_start : contractStart,
        };
        const changed = existing.monthly_fee !== patch.monthly_fee
          || !existing.is_active || existing.contract_start !== patch.contract_start;
        if (changed) ops.push({ op: "update", table: "clients", id: existing.id, patch, row: { ...existing, ...patch } });
        else duplicates++;
        clientIds.set(normalizedName, existing.id);
      } else {
        const item = { ...record.data, id: uid(), created_at: nowISO() };
        ops.push({ op: "insert", table: "clients", row: item });
        clientIds.set(normalizedName, item.id);
      }
    }

    for (const record of parsed.records.filter((entry) => entry.key !== "clients")) {
      const data = { ...record.data };
      if (record.key === "invoices") {
        const clientName = norm(String(data.client_name ?? ""));
        delete data.client_name;
        const clientId = clientIds.get(clientName);
        if (!clientId) { skipped++; continue; }
        data.client_id = clientId;
      }
      const item = { ...data, id: uid(), created_at: nowISO() };
      const existingRecord = findDuplicate(record.key, item, ops);
      if (existingRecord) {
        if (record.key === "expenses") {
          const installmentPatch = Object.fromEntries(
            ["payment_status", "installment_number", "installment_total"]
              .filter((field) => data[field] !== undefined && String(existingRecord[field] ?? "") !== String(data[field]))
              .map((field) => [field, data[field]]),
          );
          if (Object.keys(installmentPatch).length) {
            const pendingInsert = ops.find((o) => o.op === "insert" && o.row === existingRecord);
            if (pendingInsert) { Object.assign(existingRecord, installmentPatch); merged++; }
            else ops.push({ op: "update", table: "expenses", id: String(existingRecord.id), patch: installmentPatch, row: { ...existingRecord, ...installmentPatch } });
          } else duplicates++;
        } else duplicates++;
        continue;
      }
      ops.push({ op: "insert", table: record.key, row: item });
    }

    const financialRecords = parsed.counts.invoices + parsed.counts.jobs + parsed.counts.expenses + parsed.counts.equipment - parsed.counts.plannedInstallments;
    const breakdown = `${parsed.counts.clients} sürekli müşteri, ${parsed.counts.invoices} aylık gelir/fatura, ${parsed.counts.jobs} tekil iş, ${parsed.counts.expenses} gider/abonelik, ${parsed.counts.equipment} ekipman`;
    return {
      source: "rast", ops, duplicates, skipped, merged,
      describe: (c) => {
        const corrected = c.updated + c.deleted + merged;
        return `RAST finans dosyasındaki ${financialRecords} finans kaydı işlendi: ${c.inserted} yeni kayıt eklendi`
          + (duplicates ? `, ${duplicates} tanesi zaten sistemdeydi` : "")
          + (corrected ? `, ${corrected} eski sınıflandırma düzeltildi` : "")
          + (parsed.counts.plannedInstallments ? `, ${parsed.counts.plannedInstallments} bekleyen taksit planlandı` : "")
          + (skipped + c.failed ? `, ${skipped + c.failed} kayıt atlandı` : "")
          + ` (${breakdown})`
          + (parsed.usdRate ? `. USD kuru ${parsed.usdRate} olarak ayarlandı.` : ".")
          + (parsed.warnings.length ? ` ${parsed.warnings.join(" ")}` : "");
      },
      afterApply: () => {
        if (parsed.usdRate) setRate("usd", parsed.usdRate);
        setSheetIdx(0);
        setRaw(sheets[workbook.SheetNames[0]] ?? []);
        setHeaderRow(5);
        setTargetKey("expenses");
        setMapping({ vendor: "Hizmet", amount: "Tutar (USD)", currency: "Tutar (USD)", description: "Not" });
        setSmartComplete(true);
      },
    };
  }

  async function smartImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true); setResult(null); setResultError(false); setSmartComplete(false); setFileName(file.name); setPlan(null);
    try {
      const XLSX = await import("xlsx");
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
      setWb(workbook); setSheetNames(workbook.SheetNames);

      if (isRastFinanceWorkbook(workbook.SheetNames)) {
        const planned = await planRastFinance(XLSX, workbook);
        if (typeof planned === "string") { setResultError(true); setResult(planned); return; }
        setPlan(planned);
        return;
      }

      const ops: PlanOp[] = [];
      let skipped = 0, duplicates = 0, recognized = 0;
      let firstPlan: ReturnType<typeof detectPlan> = null;
      for (let index = 0; index < workbook.SheetNames.length; index++) {
        const sheetName = workbook.SheetNames[index];
        const rows = XLSX.utils.sheet_to_json<RawRow>(workbook.Sheets[sheetName], { header: 1, defval: "", blankrows: false });
        const detected = detectPlan(rows, sheetName);
        if (!detected) { skipped += Math.max(0, rows.length - 1); continue; }
        recognized++;
        if (!firstPlan) {
          firstPlan = detected; setSheetIdx(index); setRaw(rows); setHeaderRow(detected.headerRow);
          setTargetKey(detected.target.key); setMapping(detected.mapping);
        }
        for (const row of rowsToObjects(rows, detected.headerRow)) {
          const item = buildItem(row, detected.target, detected.mapping);
          if (!item) { skipped++; continue; }
          if (findDuplicate(detected.target.key, item, ops)) { duplicates++; continue; }
          ops.push({ op: "insert", table: detected.target.key, row: item });
        }
      }
      if (!recognized) {
        setResult("Dosyada güvenle tanıyabildiğim bir tablo bulamadım. Aşağıdaki ayrıntılı aktarımı kullanabilirsin.");
        return;
      }
      setPlan({
        source: "smart", ops, duplicates, skipped, merged: 0,
        describe: (c) => `${c.inserted} kayıt akıllı aktarıldı${duplicates ? `, ${duplicates} tekrar eklenmedi` : ""}${skipped + c.failed ? `, ${skipped + c.failed} satır tanınmadı/atlandı` : ""}.`,
      });
    } catch {
      setResultError(true);
      setResult("Dosya okunamadı. Excel veya CSV dosyasını kontrol edip yeniden dene.");
    } finally {
      setBusy(false);
      e.target.value = "";
    }
  }

  function planManualImport() {
    setResult(null); setResultError(false);
    const ops: PlanOp[] = [];
    let skipped = 0;
    for (const row of dataRows) {
      const item = buildItem(row);
      if (!item) { skipped++; continue; }
      ops.push({ op: "insert", table: target.key, row: item });
    }
    setPlan({
      source: "manual", ops, duplicates: 0, skipped, merged: 0,
      describe: (c) => `${c.inserted} kayıt aktarıldı${skipped + c.failed ? `, ${skipped + c.failed} satır atlandı` : ""}.`,
    });
  }

  /** Eski yol: işlemleri tek tek store üzerinden yazar (atomik değil). Demo modu ve USE_RPC_IMPORT=false. */
  async function applySequential(p: ImportPlan): Promise<ApplyCounts> {
    const c: ApplyCounts = { inserted: 0, updated: 0, deleted: 0, failed: 0 };
    for (const o of p.ops) {
      if (o.op === "delete") {
        if ((await remove(o.table, o.id)).ok) c.deleted++; else c.failed++;
      } else if (o.op === "update") {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if ((await update(o.table, o.id, o.patch as any)).ok) c.updated++; else c.failed++;
      } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if ((await add(o.table, o.row as any)).ok) c.inserted++; else c.failed++;
      }
    }
    return c;
  }

  async function applyPlan() {
    if (!plan || busy) return;
    const p = plan;
    setBusy(true); setResult(null); setResultError(false);
    try {
      let counts: ApplyCounts;
      if (USE_RPC_IMPORT && useStore.getState().supabase) {
        const { data, error, status } = await createClient().rpc("import_rows", { p_payload: toPayload(p) });
        if (error) {
          setResultError(true);
          const missing = error.code === "PGRST202" || status === 404;
          setResult(
            missing
              ? "Toplu içe aktarma fonksiyonu (import_rows) veritabanında bulunamadı. Supabase SQL Editor'de 0010_import_rpc.sql migration'ını çalıştırın (ya da geçici olarak import sayfasında USE_RPC_IMPORT = false yapın). Hiçbir değişiklik yapılmadı."
              : `İçe aktarma uygulanamadı; tek transaction olduğu için hiçbir değişiklik yapılmadı. Hata: ${error.message}`,
          );
          return;
        }
        applyLocally(p);
        const d = (data ?? {}) as Partial<ApplyCounts>;
        counts = { inserted: Number(d.inserted) || 0, updated: Number(d.updated) || 0, deleted: Number(d.deleted) || 0, failed: 0 };
      } else {
        counts = await applySequential(p);
      }
      p.afterApply?.();
      setPlan(null);
      setResult(p.describe(counts));
    } catch (err) {
      setResultError(true);
      setResult(`İçe aktarma uygulanamadı: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  const planCounts = plan
    ? plan.ops.reduce((acc, o) => ({ ...acc, [o.op]: acc[o.op] + 1 }), { insert: 0, update: 0, delete: 0 } as Record<PlanOp["op"], number>)
    : null;

  const planPanel = plan && planCounts && (
    <Panel title="Önizleme (kuru çalıştırma) — henüz hiçbir şey yazılmadı">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge tone="success">{planCounts.insert} eklenecek</Badge>
        <Badge tone="amber">{planCounts.update + plan.merged} güncellenecek</Badge>
        <Badge tone="danger">{planCounts.delete} silinecek</Badge>
        {plan.duplicates > 0 && <Badge tone="muted">{plan.duplicates} zaten var (atlanacak)</Badge>}
        {plan.skipped > 0 && <Badge tone="muted">{plan.skipped} satır tanınmadı</Badge>}
      </div>
      {plan.ops.length > 0 ? (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border text-left text-muted">
                <th className="px-2 py-2 font-medium">İşlem</th>
                <th className="px-2 py-2 font-medium">Modül</th>
                <th className="px-2 py-2 font-medium">Kayıt</th>
                <th className="px-2 py-2 font-medium">Tarih</th>
                <th className="px-2 py-2 font-medium">Tutar</th>
              </tr>
            </thead>
            <tbody>
              {plan.ops.slice(0, 10).map((o, i) => (
                <tr key={i} className="border-b border-border/60">
                  <td className="px-2 py-2"><Badge tone={OP_LABEL[o.op].tone}>{OP_LABEL[o.op].label}</Badge></td>
                  <td className="px-2 py-2 text-muted">{tableLabel(o.table)}</td>
                  <td className="max-w-[16rem] truncate px-2 py-2 text-foreground">
                    {pick(o.row, ["name", "company_name", "customer_name", "vendor", "invoice_no", "full_name", "title", "description"])}
                  </td>
                  <td className="px-2 py-2 text-muted">{pick(o.row, ["paid_at", "issue_date", "date", "contract_start", "purchase_date"])}</td>
                  <td className="px-2 py-2 text-foreground">
                    {pick(o.row, ["amount", "price", "monthly_fee", "purchase_price"])}{o.row.currency && o.row.currency !== "TRY" ? ` ${String(o.row.currency)}` : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {plan.ops.length > 10 && <p className="mt-2 text-xs text-muted">… ve {plan.ops.length - 10} işlem daha.</p>}
        </div>
      ) : (
        <p className="mt-3 text-sm text-muted">Uygulanacak değişiklik yok.</p>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button onClick={applyPlan} loading={busy} disabled={busy || plan.ops.length === 0}>
          {busy ? "Uygulanıyor…" : "Uygula"}
        </Button>
        <Button variant="ghost" onClick={() => setPlan(null)} disabled={busy}>Vazgeç</Button>
        <span className="text-xs text-muted">
          {USE_RPC_IMPORT && isSupabase
            ? "Tüm değişiklikler tek seferde (tek transaction) uygulanır; hata olursa hiçbiri yazılmaz."
            : "Değişiklikler sırayla tek tek yazılır."}
        </span>
      </div>
    </Panel>
  );

  const preview = dataRows.slice(0, 5);
  const mappedFields = target.fields.filter((f) => mapping[f.name]);

  return (
    <>
      <PageHeader
        title="İçe Aktar"
        subtitle="Excel (.xlsx) veya CSV'den toplu veri aktar. Çok sayfalı / başlığı üstte olmayan dosyalar desteklenir."
      />

      <div className="mb-4">
        <Panel title="Tek tuşla akıllı aktar">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm text-foreground">Modülü, sayfayı, başlıkları ve para birimini otomatik tanır.</p>
              <p className="mt-1 text-xs text-muted">Çok sayfalı dosyalarda tanınan tüm tabloları aktarır; aynı kaydı yeniden eklemez. Önce önizleme gösterilir, “Uygula” demeden hiçbir şey yazılmaz.</p>
            </div>
            <label className="btn-amber inline-flex cursor-pointer items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium">
              <Sparkles className="h-4 w-4" /> {busy ? "İşleniyor…" : "Dosyayı seç ve önizle"}
              <input type="file" accept=".xlsx,.xls,.csv" onChange={smartImport} disabled={busy || !hydrated} className="hidden" />
            </label>
          </div>
          {result && (
            <p className={`mt-3 flex items-center gap-1.5 text-sm ${resultError ? "text-danger" : "text-success"}`}>
              {resultError ? <AlertTriangle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />} {result}
            </p>
          )}
        </Panel>
      </div>

      {plan && plan.source !== "manual" && <div className="mb-4">{planPanel}</div>}

      {!smartComplete && <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4">
          <Panel title="1. Nereye aktarılacak?">
            <Select value={targetKey} onChange={(e) => onTargetChange(e.target.value)}>
              {IMPORT_TARGETS.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
            </Select>
          </Panel>

          <Panel title="2. Dosya seç">
            <label className="flex cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-border py-8 text-center hover:border-amber/60">
              <Upload className="mb-2 h-6 w-6 text-muted" />
              <span className="text-sm text-foreground">Dosya seç (.xlsx / .csv)</span>
              <span className="mt-1 text-xs text-muted">tıkla veya sürükle</span>
              <input type="file" accept=".xlsx,.xls,.csv" onChange={onFile} className="hidden" />
            </label>
            {fileName && (
              <p className="mt-3 flex flex-wrap items-center gap-2 text-sm text-muted">
                <FileSpreadsheet className="h-4 w-4 text-amber" /> {fileName}
                <Badge tone="muted">{sheetNames.length} sayfa</Badge>
                <Badge tone="muted">{dataRows.length} veri satırı</Badge>
              </p>
            )}
          </Panel>

          {sheetNames.length > 0 && (
            <Panel title="3. Sayfa & başlık satırı">
              <label className="mb-1 block text-xs font-medium text-muted">Sayfa</label>
              <Select value={sheetIdx} onChange={(e) => onSheetChange(Number(e.target.value))}>
                {sheetNames.map((n, i) => <option key={n} value={i}>{n}</option>)}
              </Select>
              <label className="mb-1 mt-3 block text-xs font-medium text-muted">
                Başlık satırı (sütun adlarının olduğu satır)
              </label>
              <Select value={headerRow} onChange={(e) => onHeaderRowChange(Number(e.target.value))}>
                {raw.slice(0, 15).map((_, i) => <option key={i} value={i}>Satır {i}</option>)}
              </Select>
            </Panel>
          )}
        </div>

        <div className="space-y-4 lg:col-span-2">
          {/* Ham önizleme — başlık satırını seçmeye yardımcı */}
          {raw.length > 0 && (
            <Panel title="Dosya önizleme (başlık satırını seçmene yardımcı)">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <tbody>
                    {raw.slice(0, 12).map((r, i) => (
                      <tr
                        key={i}
                        onClick={() => onHeaderRowChange(i)}
                        className={`cursor-pointer border-b border-border/60 ${
                          i === headerRow ? "bg-amber/15" : "hover:bg-surface-2/50"
                        }`}
                      >
                        <td className="px-2 py-1.5 text-muted">{i}{i === headerRow ? " ⭑" : ""}</td>
                        {r.slice(0, 8).map((c, j) => (
                          <td key={j} className="max-w-[120px] truncate px-2 py-1.5 text-foreground">
                            {String(c)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-xs text-muted">
                Başlıkların olduğu satıra tıkla (sarı = seçili). Şu an: <strong className="text-foreground">Satır {headerRow}</strong>
              </p>
            </Panel>
          )}

          {headers.length > 0 && (
            <Panel
              title="4. Sütun eşleştirme"
              action={<span className="text-xs text-muted">{mappedFields.length}/{target.fields.length} eşleşti</span>}
            >
              <div className="grid gap-2 sm:grid-cols-2">
                {target.fields.map((f) => (
                  <div key={f.name} className="flex items-center gap-2">
                    <span className="w-32 shrink-0 text-xs text-muted">
                      {f.label}{f.required && <span className="text-danger"> *</span>}
                    </span>
                    <ArrowRight className="h-3 w-3 shrink-0 text-muted" />
                    <Select value={mapping[f.name] ?? ""} onChange={(e) => { setPlan(null); setMapping({ ...mapping, [f.name]: e.target.value }); }}>
                      <option value="">— (boş)</option>
                      {headers.map((h) => <option key={h} value={h}>{h}</option>)}
                    </Select>
                  </div>
                ))}
              </div>
            </Panel>
          )}

          {preview.length > 0 && mappedFields.length > 0 && (
            <Panel title="5. Önizleme (ilk 5) & aktar">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border text-left text-muted">
                      {mappedFields.map((f) => <th key={f.name} className="px-2 py-2 font-medium">{f.label}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.map((row, i) => (
                      <tr key={i} className="border-b border-border/60">
                        {mappedFields.map((f) => (
                          <td key={f.name} className="px-2 py-2 text-foreground">
                            {String(coerce(row[mapping[f.name]], f.type) ?? "—")}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-4 flex items-center gap-3">
                <Button onClick={planManualImport} disabled={busy || !hydrated}>
                  {`${dataRows.length} satırı önizle`}
                </Button>
                {result && (
                  <span className={`flex items-center gap-1.5 text-sm ${resultError ? "text-danger" : "text-success"}`}>
                    {resultError ? <AlertTriangle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />} {result}
                  </span>
                )}
              </div>
            </Panel>
          )}

          {plan?.source === "manual" && planPanel}
        </div>
      </div>}
    </>
  );
}
