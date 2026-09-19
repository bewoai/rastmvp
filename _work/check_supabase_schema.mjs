import fs from "node:fs/promises";

const envText = await fs.readFile("C:/Users/Bewo/Desktop/rastwebapp_operasyon/rast-os/.env.local", "utf8");
const env = Object.fromEntries(envText.split(/\r?\n/).filter((line) => line && !line.startsWith("#") && line.includes("=")).map((line) => {
  const index = line.indexOf("=");
  return [line.slice(0, index), line.slice(index + 1).replace(/^['\"]|['\"]$/g, "")];
}));
const base = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const headers = { apikey: key, Authorization: `Bearer ${key}` };

const currencyResponse = await fetch(`${base}/rest/v1/expenses?select=currency&limit=1`, { headers });
const currencyBody = await currencyResponse.text();
let currencyStatus = currencyResponse.ok ? "available" : `missing/error (${currencyResponse.status})`;
if (!currencyResponse.ok) {
  try { currencyStatus += `: ${JSON.parse(currencyBody).message}`; } catch {}
}

const schemaResponse = await fetch(`${base}/rest/v1/`, { headers: { ...headers, Accept: "application/openapi+json" } });
let plannedStatus = "unknown";
if (schemaResponse.ok) {
  const schema = await schemaResponse.json();
  const equipment = schema.definitions?.equipment?.properties?.status;
  const values = equipment?.enum ?? equipment?.format?.match(/\((.*?)\)/)?.[1]?.split("|") ?? [];
  plannedStatus = values.includes("planned") ? "available" : "missing";
}
console.log(JSON.stringify({ currencyColumn: currencyStatus, plannedEquipmentStatus: plannedStatus }, null, 2));
