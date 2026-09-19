import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const workbook = await SpreadsheetFile.importXlsx(
  await FileBlob.load("C:/Users/Bewo/Desktop/rast/RAST_Creative_Gelir_Gider_2026_2027.xlsx"),
);
console.log(workbook.help("workbook.render", { include: "index,examples,notes", maxChars: 4000 }).ndjson);
