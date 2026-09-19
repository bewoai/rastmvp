import fs from "node:fs/promises";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const workbook = await SpreadsheetFile.importXlsx(
  await FileBlob.load("C:/Users/Bewo/Desktop/rast/RAST_Creative_Gelir_Gider_2026_2027.xlsx"),
);
const outputDir = "C:/Users/Bewo/Desktop/rastwebapp_operasyon/_work/renders";
const result = await workbook.inspect({ kind: "sheet", include: "id,name,range", maxChars: 20000 });
const sheets = String(result.ndjson).split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line)).filter((row) => row.name);
await fs.mkdir(outputDir, { recursive: true });
for (let index = 0; index < sheets.length; index++) {
  const preview = await workbook.render({ sheetIndex: index, range: sheets[index].range, scale: 1, format: "png" });
  await fs.writeFile(`${outputDir}/${String(index + 1).padStart(2, "0")}.png`, new Uint8Array(await preview.arrayBuffer()));
}
console.log(`Rendered ${sheets.length} sheets.`);
