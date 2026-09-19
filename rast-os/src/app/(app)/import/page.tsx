"use client";

import { useState } from "react";
import { Upload, FileSpreadsheet, CheckCircle2, ArrowRight, Sparkles, AlertTriangle } from "lucide-react";
import { PageHeader, Panel, Badge } from "@/components/ui";
import { Select, Button } from "@/components/form";
import { useStore, uid, nowISO } from "@/lib/store";
import { useFx } from "@/lib/fx";
import { IMPORT_TARGETS, coerce, norm, type ImportTarget } from "@/lib/import-config";
import { isRastFinanceWorkbook, parseRastFinanceWorkbook } from "@/lib/rast-finance-import";
import { createClient } from "@/lib/supabase/client";

type Cell = string | number | boolean;
type RawRow = Cell[];
type Row = Record<string, unknown>;

const SUMMARY_RE = /^(toplam|genel toplam|total|özet|ara toplam|net)\b/i;

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
    setResult(null); setResultError(false); setSmartComplete(false);
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
    const t = IMPORT_TARGETS.find((x) => x.key === key)!;
    if (headers.length) autoMap(headers, t);
  }

  async function onSheetChange(idx: number) {
    setSheetIdx(idx);
    setResult(null);
    if (wb) await loadSheet(wb, idx, target);
  }

  function onHeaderRowChange(hr: number) {
    setHeaderRow(hr);
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

  function findDuplicate(key: ImportTarget["key"], item: Row): Row | undefined {
    const identity: Partial<Record<ImportTarget["key"], string[]>> = {
      clients: ["name"], leads: ["company_name", "phone", "email"],
      contacts: ["full_name", "client_id", "phone"], brands: ["name", "client_id"],
      jobs: ["customer_name", "service", "date", "price"], equipment: ["name", "brand_model"],
      expenses: ["vendor", "description", "amount", "paid_at", "currency"],
      invoices: ["invoice_no", "client_id", "amount", "issue_date"],
    };
    const fields = identity[key] ?? [];
    if (!fields.some((field) => item[field] !== undefined && item[field] !== "")) return undefined;
    const current = useStore.getState()[key] as unknown as Row[];
    return current.find((row) => fields.every((field) => String(row[field] ?? "") === String(item[field] ?? "")));
  }

  function isDuplicate(key: ImportTarget["key"], item: Row): boolean {
    return Boolean(findDuplicate(key, item));
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

  async function smartImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true); setResult(null); setResultError(false); setSmartComplete(false); setFileName(file.name);
    try {
      const XLSX = await import("xlsx");
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
      setWb(workbook); setSheetNames(workbook.SheetNames);
      let imported = 0, skipped = 0, duplicates = 0, recognized = 0;
      let firstPlan: ReturnType<typeof detectPlan> = null;

      if (isRastFinanceWorkbook(workbook.SheetNames)) {
        if (useStore.getState().supabase) {
          const sb = createClient();
          const currencyCheck = await sb.from("expenses").select("currency").limit(1);
          if (currencyCheck.error) {
            setResultError(true);
            setResult("Veritabanı güncel değil: önce Supabase SQL Editor'de 0003_expense_currency.sql migration'ını çalıştır.");
            return;
          }
          const plannedCheck = await sb.from("equipment").select("id").eq("status", "planned").limit(1);
          if (plannedCheck.error) {
            setResultError(true);
            setResult("Veritabanı güncel değil: önce Supabase SQL Editor'de 0004_equipment_planned.sql migration'ını çalıştır.");
            return;
          }
          const installmentCheck = await sb.from("expenses").select("installment_number,installment_total,payment_status").limit(1);
          if (installmentCheck.error) {
            setResultError(true);
            setResult("Veritabanı güncel değil: önce Supabase SQL Editor'de 0005_expense_installments.sql migration'ını çalıştır.");
            return;
          }
        }
        const sheets = Object.fromEntries(workbook.SheetNames.map((sheetName) => [
          sheetName,
          XLSX.utils.sheet_to_json<RawRow>(workbook.Sheets[sheetName], { header: 1, defval: "", blankrows: false }),
        ]));
        const parsed = parseRastFinanceWorkbook({ sheetNames: workbook.SheetNames, sheets });
        if (parsed.usdRate) setRate("usd", parsed.usdRate);
        let corrected = 0;
        const recurringNames = new Set([norm("Aytaş"), norm("Duygu Hoca"), norm("Newlife")]);
        const oldRecurringJobs = useStore.getState().jobs.filter((job) =>
          recurringNames.has(norm(job.customer_name))
          && norm(job.service ?? "").startsWith(norm("Eski gelir kaydından aktarıldı")),
        );
        for (const job of oldRecurringJobs) {
          await remove("jobs", job.id);
          corrected++;
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
            if (changed) { await update("clients", existing.id, patch); corrected++; }
            else duplicates++;
            clientIds.set(normalizedName, existing.id);
          } else {
            const item = { ...record.data, id: uid(), created_at: nowISO() };
            const saved = await add("clients", item as any); // eslint-disable-line @typescript-eslint/no-explicit-any
            if (saved.ok) { imported++; clientIds.set(normalizedName, item.id); }
            else skipped++;
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
          const existingRecord = findDuplicate(record.key, item);
          if (existingRecord) {
            if (record.key === "expenses") {
              const installmentPatch = Object.fromEntries(
                ["payment_status", "installment_number", "installment_total"]
                  .filter((field) => data[field] !== undefined && String(existingRecord[field] ?? "") !== String(data[field]))
                  .map((field) => [field, data[field]]),
              );
              if (Object.keys(installmentPatch).length) {
                await update("expenses", String(existingRecord.id), installmentPatch);
                corrected++;
              } else duplicates++;
            } else duplicates++;
            continue;
          }
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const saved = await add(record.key as any, item as any);
          if (saved.ok) imported++;
          else skipped++;
        }
        setSheetIdx(0);
        setRaw(sheets[workbook.SheetNames[0]] ?? []);
        setHeaderRow(5);
        setTargetKey("expenses");
        setMapping({ vendor: "Hizmet", amount: "Tutar (USD)", currency: "Tutar (USD)", description: "Not" });
        const financialRecords = parsed.counts.invoices + parsed.counts.jobs + parsed.counts.expenses + parsed.counts.equipment - parsed.counts.plannedInstallments;
        const breakdown = `${parsed.counts.clients} sürekli müşteri, ${parsed.counts.invoices} aylık gelir/fatura, ${parsed.counts.jobs} tekil iş, ${parsed.counts.expenses} gider/abonelik, ${parsed.counts.equipment} ekipman`;
        setSmartComplete(true);
        setResult(
          `RAST finans dosyasındaki ${financialRecords} finans kaydı işlendi: ${imported} yeni kayıt eklendi`
          + (duplicates ? `, ${duplicates} tanesi zaten sistemdeydi` : "")
          + (corrected ? `, ${corrected} eski sınıflandırma düzeltildi` : "")
          + (parsed.counts.plannedInstallments ? `, ${parsed.counts.plannedInstallments} bekleyen taksit planlandı` : "")
          + ` (${breakdown})`
          + (parsed.usdRate ? `. USD kuru ${parsed.usdRate} olarak ayarlandı.` : ".")
          + (parsed.warnings.length ? ` ${parsed.warnings.join(" ")}` : ""),
        );
        return;
      }

      for (let index = 0; index < workbook.SheetNames.length; index++) {
        const sheetName = workbook.SheetNames[index];
        const rows = XLSX.utils.sheet_to_json<RawRow>(workbook.Sheets[sheetName], { header: 1, defval: "", blankrows: false });
        const plan = detectPlan(rows, sheetName);
        if (!plan) { skipped += Math.max(0, rows.length - 1); continue; }
        recognized++;
        if (!firstPlan) {
          firstPlan = plan; setSheetIdx(index); setRaw(rows); setHeaderRow(plan.headerRow);
          setTargetKey(plan.target.key); setMapping(plan.mapping);
        }
        for (const row of rowsToObjects(rows, plan.headerRow)) {
          const item = buildItem(row, plan.target, plan.mapping);
          if (!item) { skipped++; continue; }
          if (isDuplicate(plan.target.key, item)) { duplicates++; continue; }
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const saved = await add(plan.target.key as any, item as any);
          if (saved.ok) imported++;
          else skipped++;
        }
      }
      setResult(
        recognized
          ? `${imported} kayıt akıllı aktarıldı${duplicates ? `, ${duplicates} tekrar eklenmedi` : ""}${skipped ? `, ${skipped} satır tanınmadı/atlandı` : ""}.`
          : "Dosyada güvenle tanıyabildiğim bir tablo bulamadım. Aşağıdaki ayrıntılı aktarımı kullanabilirsin.",
      );
    } catch {
      setResultError(true);
      setResult("Dosya okunamadı. Excel veya CSV dosyasını kontrol edip yeniden dene.");
    } finally {
      setBusy(false);
      e.target.value = "";
    }
  }

  async function runImport() {
    setBusy(true);
    setResult(null);
    let ok = 0, skipped = 0;
    for (const row of dataRows) {
      const item = buildItem(row);
      if (!item) { skipped++; continue; }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const saved = await add(target.key as any, item as any);
      if (saved.ok) ok++;
      else skipped++;
    }
    setBusy(false);
    setResult(`${ok} kayıt aktarıldı${skipped ? `, ${skipped} satır atlandı` : ""}.`);
  }

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
              <p className="mt-1 text-xs text-muted">Çok sayfalı dosyalarda tanınan tüm tabloları aktarır; aynı kaydı yeniden eklemez.</p>
            </div>
            <label className="btn-amber inline-flex cursor-pointer items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium">
              <Sparkles className="h-4 w-4" /> {busy ? "Akıllı aktarılıyor…" : "Dosyayı seç ve aktar"}
              <input type="file" accept=".xlsx,.xls,.csv" onChange={smartImport} disabled={busy} className="hidden" />
            </label>
          </div>
          {result && (
            <p className={`mt-3 flex items-center gap-1.5 text-sm ${resultError ? "text-danger" : "text-success"}`}>
              {resultError ? <AlertTriangle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />} {result}
            </p>
          )}
        </Panel>
      </div>

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
                    <Select value={mapping[f.name] ?? ""} onChange={(e) => setMapping({ ...mapping, [f.name]: e.target.value })}>
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
                <Button onClick={runImport} disabled={busy}>
                  {busy ? "Aktarılıyor…" : `${dataRows.length} satırı aktar`}
                </Button>
                {result && (
                  <span className={`flex items-center gap-1.5 text-sm ${resultError ? "text-danger" : "text-success"}`}>
                    {resultError ? <AlertTriangle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />} {result}
                  </span>
                )}
              </div>
            </Panel>
          )}
        </div>
      </div>}
    </>
  );
}
