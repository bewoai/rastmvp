import * as XLSX from "xlsx";

export const runtime = "nodejs";

const MAX_FILE_SIZE = 20 * 1024 * 1024;
const MAX_TEXT_LENGTH = 40_000;
const spreadsheetExtensions = new Set(["xlsx", "xls", "csv", "tsv"]);

function extensionOf(name: string) {
  return name.split(".").pop()?.toLocaleLowerCase("tr-TR") ?? "";
}

function capText(text: string) {
  const normalized = text.replace(/\u0000/g, "").replace(/\r\n/g, "\n").trim();
  return {
    text: normalized.slice(0, MAX_TEXT_LENGTH),
    truncated: normalized.length > MAX_TEXT_LENGTH,
  };
}

async function extractPdf(data: Uint8Array) {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = getDocument({ data, useSystemFonts: true });
  const document = await task.promise;
  const pageCount = document.numPages;
  const pageLimit = Math.min(pageCount, 40);
  const pages: string[] = [];

  for (let pageNumber = 1; pageNumber <= pageLimit; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    const lines: string[] = [];
    let current = "";
    for (const item of content.items) {
      if (!("str" in item)) continue;
      current += `${item.str} `;
      if (item.hasEOL) {
        lines.push(current.trim());
        current = "";
      }
    }
    if (current.trim()) lines.push(current.trim());
    pages.push(`--- Sayfa ${pageNumber} ---\n${lines.filter(Boolean).join("\n")}`);
  }

  await task.destroy();
  const capped = capText(pages.join("\n\n"));
  return { ...capped, page_count: pageCount };
}

function extractSpreadsheet(data: Uint8Array) {
  const workbook = XLSX.read(data, { type: "array", cellDates: true });
  const sections = workbook.SheetNames.slice(0, 20).map((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "", blankrows: false });
    const rendered = rows.slice(0, 250).map((row) => row.slice(0, 60).map((cell) => String(cell ?? "").trim()).join(" | "));
    return `--- Sayfa: ${sheetName} ---\n${rendered.join("\n")}`;
  });
  const capped = capText(sections.join("\n\n"));
  return { ...capped, sheet_names: workbook.SheetNames };
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) return Response.json({ error: "Dosya bulunamadı." }, { status: 400 });
    if (file.size > MAX_FILE_SIZE) return Response.json({ error: "Dosya en fazla 20 MB olabilir." }, { status: 413 });

    const extension = extensionOf(file.name);
    const data = new Uint8Array(await file.arrayBuffer());

    if (file.type === "application/pdf" || extension === "pdf") {
      return Response.json(await extractPdf(data));
    }
    if (spreadsheetExtensions.has(extension)) {
      return Response.json(extractSpreadsheet(data));
    }
    if (file.type.startsWith("text/") || extension === "txt") {
      return Response.json(capText(new TextDecoder("utf-8").decode(data)));
    }

    return Response.json({ error: "Bu dosya türü desteklenmiyor. PDF, Excel, CSV veya TXT yükleyin." }, { status: 415 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Dosya okunamadı.";
    console.error("İçerik dosyası okuma hatası:", error);
    return Response.json({ error: `Dosya okunamadı: ${message}` }, { status: 500 });
  }
}
