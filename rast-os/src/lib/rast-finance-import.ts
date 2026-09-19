import { norm } from "./import-config";
import type { RastData } from "./types";

export type FinanceCell = string | number | boolean | null | undefined;
export type FinanceRow = FinanceCell[];

export interface FinanceWorkbookRows {
  sheetNames: string[];
  sheets: Record<string, FinanceRow[]>;
}

export interface FinanceImportRecord {
  key: keyof RastData;
  data: Record<string, unknown>;
}

export interface RastFinanceImport {
  records: FinanceImportRecord[];
  usdRate?: number;
  counts: { clients: number; invoices: number; jobs: number; expenses: number; equipment: number; plannedInstallments: number };
  warnings: string[];
}

export function isRastFinanceWorkbook(sheetNames: string[]): boolean {
  const normalized = new Set(sheetNames.map(norm));
  return normalized.has(norm("Servisler & Abonelikler"))
    && normalized.has(norm("Ekipman Listesi"))
    && sheetNames.some((name) => /^20\d{2}-\d{2}\s/.test(name));
}

function numeric(value: FinanceCell): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const raw = String(value ?? "").trim().replace(/[^\d.,-]/g, "");
  if (!raw) return undefined;
  let normalized = raw;
  if (raw.includes(",")) normalized = raw.replace(/\./g, "").replace(",", ".");
  const result = Number(normalized);
  return Number.isFinite(result) ? result : undefined;
}

function excelDate(value: FinanceCell, fallback?: string): string | undefined {
  if (typeof value === "number") {
    return new Date(Math.round((value - 25569) * 86400 * 1000)).toISOString().slice(0, 10);
  }
  const text = String(value ?? "").trim();
  if (!text) return fallback;
  const tr = text.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
  if (tr) {
    const year = tr[3].length === 2 ? `20${tr[3]}` : tr[3];
    return `${year}-${tr[2].padStart(2, "0")}-${tr[1].padStart(2, "0")}`;
  }
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed.toISOString().slice(0, 10);
}

function text(value: FinanceCell): string {
  return String(value ?? "").trim();
}

function joined(parts: Array<string | undefined>): string | undefined {
  const value = parts.filter(Boolean).join(" · ");
  return value || undefined;
}

function isPaidStatus(value: string): boolean {
  const status = norm(value);
  return status.includes("alindi") || status.includes("odendi") || status.includes("tekodeme");
}

function legacyIncomeStatuses(rows: FinanceRow[]) {
  return rows.slice(2).flatMap((row) => {
    const customer = text(row[0]);
    const amount = numeric(row[1]);
    if (!customer || customer.toLocaleUpperCase("tr").startsWith("TOPLAM") || amount === undefined) return [];
    return [{ customer: norm(customer), amount, status: text(row[4]), used: false }];
  });
}

function dateFromTurkishStatus(status: string, year: string): string | undefined {
  const months: Record<string, string> = {
    ocak: "01", subat: "02", mart: "03", nisan: "04", mayis: "05", haziran: "06",
    temmuz: "07", agustos: "08", eylul: "09", ekim: "10", kasim: "11", aralik: "12",
  };
  const match = status.match(/(\d{1,2})\s+([A-Za-zÇĞİÖŞÜçğıiöşü]+)/);
  if (!match) return undefined;
  const month = months[norm(match[2])];
  return month ? `${year}-${month}-${match[1].padStart(2, "0")}` : undefined;
}

function addMonths(date: string, months: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const result = new Date(Date.UTC(year, month - 1 + months, day));
  return result.toISOString().slice(0, 10);
}

export function parseRastFinanceWorkbook(workbook: FinanceWorkbookRows): RastFinanceImport {
  const records: FinanceImportRecord[] = [];
  const warnings: string[] = [];
  const counts = { clients: 0, invoices: 0, jobs: 0, expenses: 0, equipment: 0, plannedInstallments: 0 };
  const recurringCustomers = new Set([norm("Aytaş"), norm("Duygu Hoca"), norm("Newlife")]);
  const createdClients = new Set<string>();

  const subscriptions = workbook.sheets["Servisler & Abonelikler"] ?? [];
  const usdRate = numeric(subscriptions[2]?.[1]);
  const subscriptionHeader = subscriptions.findIndex((row) => norm(text(row[0])) === norm("Hizmet") && norm(text(row[1])).includes("usd"));
  for (let index = subscriptionHeader + 1; subscriptionHeader >= 0 && index < subscriptions.length; index++) {
    const row = subscriptions[index];
    const service = text(row[0]);
    if (!service || norm(service).startsWith("toplam")) break;
    const usd = numeric(row[1]);
    const amountTry = numeric(row[2]);
    const amount = usd ?? amountTry;
    if (amount === undefined) continue;
    records.push({ key: "expenses", data: {
      category: "Yazılım",
      vendor: service,
      amount,
      vat: 0,
      currency: usd !== undefined ? "USD" : "TRY",
      payment_status: "paid",
      is_recurring: true,
      method: "Abonelik",
      description: joined(["Aylık abonelik", text(row[3]) || undefined]),
    } });
    counts.expenses++;
  }

  const renewalHeader = subscriptions.findIndex((row, index) => index > 10 && norm(text(row[0])) === norm("Hizmet"));
  if (renewalHeader >= 0) {
    for (const row of subscriptions.slice(renewalHeader + 1)) {
      const service = text(row[0]);
      const amount = numeric(row[2]);
      if (!service || amount === undefined) continue;
      records.push({ key: "expenses", data: {
        category: "Domain/Hosting", vendor: service, amount, vat: 0, currency: "TRY",
        paid_at: excelDate(row[1]), payment_status: "pending", is_recurring: false,
        description: joined(["Yıllık yenileme", text(row[3]) || undefined]),
      } });
      counts.expenses++;
    }
  }

  const equipmentRows = workbook.sheets["Ekipman Listesi"] ?? [];
  const equipmentHeader = equipmentRows.findIndex((row) => norm(text(row[0])) === norm("Kategori") && norm(text(row[1])).includes("ekipmanadi"));
  for (const row of equipmentRows.slice(equipmentHeader + 1)) {
    const category = text(row[0]);
    const name = text(row[1]);
    if (!name || norm(category).startsWith("geneltoplam")) break;
    const total = numeric(row[4]) ?? numeric(row[2]);
    const sourceStatus = text(row[5]);
    records.push({ key: "equipment", data: {
      name, category, purchase_price: total,
      status: norm(sourceStatus).includes("alinmadi") ? "planned" : "idle",
      notes: joined([sourceStatus || undefined, numeric(row[3]) ? `Adet: ${numeric(row[3])}` : undefined, text(row[6]) || undefined]),
    } });
    counts.equipment++;
  }

  const legacyRows = workbook.sheets["Gelir & Müşteriler"] ?? [];
  const legacyStatuses = legacyIncomeStatuses(legacyRows);
  const installmentPlans = new Map<string, {
    vendor: string; category: string; amount: number; total: number; seen: number; lastDate: string;
  }>();
  for (const sheetName of workbook.sheetNames) {
    const month = sheetName.match(/^(20\d{2})-(\d{2})\s/);
    if (!month) continue;
    const fallbackDate = `${month[1]}-${month[2]}-01`;
    const rows = workbook.sheets[sheetName] ?? [];
    const detailHeader = rows.findIndex((row) => norm(text(row[0])) === norm("Tarih") && norm(text(row[1])).includes("musterikaynak"));
    if (detailHeader < 0) continue;
    for (const row of rows.slice(detailHeader + 1)) {
      const customer = text(row[1]);
      const price = numeric(row[3]);
      if (customer && price !== undefined && price > 0) {
        const legacy = legacyStatuses.find((entry) => !entry.used && entry.customer === norm(customer) && entry.amount === price);
        if (legacy) legacy.used = true;
        const paid = legacy ? isPaidStatus(legacy.status) : false;
        const sourceDate = excelDate(row[0]);
        const legacyDate = legacy ? dateFromTurkishStatus(legacy.status, month[1]) : undefined;
        const transactionDate = legacyDate ?? sourceDate ?? fallbackDate;
        const incomeNotes = joined([
          numeric(row[4]) !== undefined ? `Şirkete verilen: ${numeric(row[4])} TL` : undefined,
          numeric(row[5]) !== undefined ? `Kişi başı: ${numeric(row[5])} TL` : undefined,
          legacy?.status ? `Eski durum: ${legacy.status}` : undefined,
          !legacyDate && !sourceDate ? `Kesin tarih yok; ${sheetName} ayına kaydedildi` : undefined,
        ]);

        if (recurringCustomers.has(norm(customer))) {
          if (!createdClients.has(norm(customer))) {
            records.push({ key: "clients", data: {
              name: customer,
              monthly_fee: price,
              contract_start: transactionDate,
              is_active: true,
              notes: "Excel finans dosyasından sürekli müşteri olarak aktarıldı.",
            } });
            createdClients.add(norm(customer));
            counts.clients++;
          }
          records.push({ key: "invoices", data: {
            client_name: customer,
            invoice_no: `RAST-${transactionDate.slice(0, 7)}-${norm(customer).toUpperCase()}`,
            issue_date: transactionDate,
            due_date: transactionDate,
            amount: price,
            vat: 0,
            paid_amount: paid ? price : 0,
            status: paid ? "paid" : "issued",
            notes: incomeNotes,
          } });
          counts.invoices++;
        } else {
          records.push({ key: "jobs", data: {
            customer_name: customer,
            service: text(row[2]) || "Gelir kaydı",
            job_type: "Gelir",
            date: transactionDate,
            price,
            paid_amount: paid ? price : 0,
            status: paid ? "delivered" : "confirmed",
            payment_status: paid ? "paid" : "unpaid",
            notes: incomeNotes,
          } });
          counts.jobs++;
        }
      }

      const expenseName = text(row[9]);
      const expenseAmount = numeric(row[10]);
      if (expenseName && expenseAmount !== undefined && expenseAmount > 0) {
        const installmentText = `${text(row[11])} ${text(row[12])}`;
        const installmentTotal = Number(installmentText.match(/(\d+)\s*taksit/i)?.[1] ?? 0) || undefined;
        const planKey = norm(expenseName);
        const previousPlan = installmentPlans.get(planKey);
        const installmentNumber = installmentTotal ? (previousPlan?.seen ?? 0) + 1 : undefined;
        const paymentDate = excelDate(row[7], fallbackDate)!;
        records.push({ key: "expenses", data: {
          category: text(row[8]) || "Diğer",
          vendor: expenseName,
          amount: expenseAmount,
          vat: 0,
          currency: "TRY",
          paid_at: paymentDate,
          method: text(row[11]) || undefined,
          payment_status: "paid",
          installment_number: installmentNumber,
          installment_total: installmentTotal,
          is_recurring: false,
          description: joined([expenseName, text(row[12]) || undefined, !row[7] ? `Tarih yok; ${sheetName} ayına kaydedildi` : undefined]),
        } });
        counts.expenses++;
        if (installmentTotal) {
          installmentPlans.set(planKey, {
            vendor: expenseName,
            category: text(row[8]) || "Diğer",
            amount: expenseAmount,
            total: installmentTotal,
            seen: installmentNumber!,
            lastDate: paymentDate,
          });
        }
      }
    }
  }

  for (const plan of installmentPlans.values()) {
    for (let number = plan.seen + 1; number <= plan.total; number++) {
      const paidAt = addMonths(plan.lastDate, number - plan.seen);
      records.push({ key: "expenses", data: {
        category: plan.category,
        vendor: plan.vendor,
        amount: plan.amount,
        vat: 0,
        currency: "TRY",
        paid_at: paidAt,
        method: "Taksit",
        payment_status: "pending",
        installment_number: number,
        installment_total: plan.total,
        is_recurring: false,
        description: `${plan.vendor} · Planlanan ${number}/${plan.total}. taksit`,
      } });
      counts.expenses++;
      counts.plannedInstallments++;
    }
  }

  if (!usdRate) warnings.push("USD kuru bulunamadı; uygulamadaki mevcut kur korundu.");
  return { records, usdRate, counts, warnings };
}
