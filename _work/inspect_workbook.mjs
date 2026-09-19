import fs from "node:fs/promises";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const inputPath = "C:/Users/Bewo/Desktop/rast/RAST_Creative_Gelir_Gider_2026_2027.xlsx";
const outputDir = "C:/Users/Bewo/Desktop/rastwebapp_operasyon/_work/renders";

const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(inputPath));
const overview = await workbook.inspect({
  kind: "workbook,sheet,table,definedName,drawing",
  include: "id,name,range,values,formulas",
  maxChars: 20000,
  tableMaxRows: 12,
  tableMaxCols: 16,
  tableMaxCellChars: 120,
});
console.log("OVERVIEW");
console.log(overview.ndjson);

const sheetInfo = await workbook.inspect({ kind: "sheet", include: "id,name", maxChars: 20000 });
const records = String(sheetInfo.ndjson).split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
const sheets = records.filter((record) => record.name).map((record) => ({ id: record.id, name: record.name, range: record.range }));

await fs.mkdir(outputDir, { recursive: true });
for (let index = 0; index < sheets.length; index++) {
  const sheet = sheets[index];
  const region = await workbook.inspect({
    kind: "region",
    sheetId: sheet.id,
    maxChars: 12000,
    tableMaxRows: 30,
    tableMaxCols: 20,
    tableMaxCellChars: 100,
  });
  console.log(`SHEET ${index + 1}: ${sheet.name}`);
  console.log(region.ndjson);
  const preview = await workbook.render({ sheetIndex: index, range: sheet.range, scale: 1, format: "png" });
  await fs.writeFile(`${outputDir}/${String(index + 1).padStart(2, "0")}.png`, new Uint8Array(await preview.arrayBuffer()));
}
