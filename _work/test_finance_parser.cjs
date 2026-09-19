const XLSX = require("../rast-os/node_modules/xlsx");
const { parseRastFinanceWorkbook } = require("./compiled/rast-finance-import.js");

const workbook = XLSX.readFile("C:/Users/Bewo/Desktop/rast/RAST_Creative_Gelir_Gider_2026_2027.xlsx");
const sheets = Object.fromEntries(workbook.SheetNames.map((name) => [
  name,
  XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, defval: "", blankrows: false }),
]));
const result = parseRastFinanceWorkbook({ sheetNames: workbook.SheetNames, sheets });
if (result.usdRate !== 46.26) throw new Error(`Unexpected USD rate: ${result.usdRate}`);
if (result.records.length !== 45) throw new Error(`Unexpected record total: ${result.records.length}`);
if (result.counts.clients !== 3 || result.counts.invoices !== 4 || result.counts.jobs !== 2 || result.counts.expenses !== 15 || result.counts.equipment !== 21 || result.counts.plannedInstallments !== 1) {
  throw new Error(`Unexpected breakdown: ${JSON.stringify(result.counts)}`);
}
if (result.records.some((record) => /toplam|finans özeti/i.test(String(record.data.vendor || record.data.customer_name || record.data.name || "")))) {
  throw new Error("A summary row was incorrectly imported.");
}
console.log(JSON.stringify({
  rate: result.usdRate,
  counts: result.counts,
  total: result.records.length,
  jobs: result.records.filter((record) => record.key === "jobs").map((record) => record.data),
  clients: result.records.filter((record) => record.key === "clients").map((record) => record.data),
  invoices: result.records.filter((record) => record.key === "invoices").map((record) => record.data),
  recurring: result.records.filter((record) => record.key === "expenses" && record.data.is_recurring).map((record) => record.data),
  monthlyExpenses: result.records.filter((record) => record.key === "expenses" && !record.data.is_recurring && String(record.data.paid_at || "").startsWith("2026-0")).map((record) => record.data),
  plannedEquipment: result.records.filter((record) => record.key === "equipment" && record.data.status === "planned").length,
}, null, 2));
