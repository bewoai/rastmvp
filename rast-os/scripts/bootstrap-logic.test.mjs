// Çalıştırma: npm test  (Node'un yerleşik test runner'ı + type stripping)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CORE_COLLECTIONS, DASHBOARD_COLLECTIONS, bootCollections, isRpcMissing, mergeRows, parseBootstrap,
  routeCollections, unionCollections,
} from "../src/lib/bootstrap-logic.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(root, p), "utf8");

/** store.ts → COLLECTIONS (yorumlar atılarak). */
function storeCollections() {
  const block = read("src/lib/store.ts").match(/export const COLLECTIONS[^=]*=\s*\[([\s\S]*?)\];/);
  assert.ok(block, "COLLECTIONS bulunamadı");
  return [...block[1].replace(/\/\/.*$/gm, "").matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
}

// ---------------------------------------------------------------------------
// 0020 izin listesi ↔ store
// ---------------------------------------------------------------------------

test("0020 app_bootstrap izin listesi store.ts COLLECTIONS ile birebir aynı", () => {
  const sql = read("supabase/migrations/0020_bootstrap_rpc.sql");
  const arr = sql.match(/v_allowed constant text\[\] := array\[([\s\S]*?)\];/);
  assert.ok(arr, "v_allowed bulunamadı");
  const allowed = [...arr[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  assert.deepEqual([...allowed].sort(), [...storeCollections()].sort());
});

test("0020: activity_logs sınırı istemcideki ACTIVITY_LOG_LIMIT ile aynı", () => {
  const limit = read("src/lib/store.ts").match(/const ACTIVITY_LOG_LIMIT = (\d+);/)?.[1];
  assert.equal(limit, "500");
  assert.match(read("supabase/migrations/0020_bootstrap_rpc.sql"), /v_limit := ' limit 500';/);
});

test("0020: yalnız authenticated çalıştırır; SECURITY INVOKER", () => {
  const sql = read("supabase/migrations/0020_bootstrap_rpc.sql");
  assert.match(sql, /security invoker/);
  assert.doesNotMatch(sql, /security definer/);
  assert.match(sql, /revoke all on function public\.app_bootstrap\(text\[\], date\) from anon;/);
  assert.match(sql, /grant execute on function public\.app_bootstrap\(text\[\], date\) to authenticated;/);
});

// ---------------------------------------------------------------------------
// Rota → koleksiyon
// ---------------------------------------------------------------------------

function pageFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...pageFiles(p));
    else if (name === "page.tsx") out.push(p);
  }
  return out;
}

test("her (app) sayfasının useHydrated listesi routeCollections(yol) içinde (açılış isteği sayfayı kapsar)", () => {
  const appDir = join(root, "src", "app", "(app)");
  let checked = 0;
  for (const file of pageFiles(appDir)) {
    const m = readFileSync(file, "utf8").match(/useHydrated\(\[([^\]]*)\]\)/);
    if (!m) continue;
    const wanted = [...m[1].matchAll(/"([a-z_]+)"/g)].map((x) => x[1]);
    const segs = relative(appDir, file).split(sep).slice(0, -1).map((s) => (s.startsWith("[") ? "x" : s));
    const path = "/" + segs.join("/");
    const got = routeCollections(path === "/" ? "/" : path);
    for (const c of wanted) assert.ok(got.includes(c), `${path}: ${c} routeCollections'ta yok`);
    checked++;
  }
  assert.ok(checked >= 20, `beklenenden az sayfa: ${checked}`);
});

test("dashboard listesi src/app/(app)/page.tsx ile aynı; çekirdek dashboard'u kapsar", () => {
  const m = read("src/app/(app)/page.tsx").match(/useHydrated\(\[([^\]]*)\]\)/);
  const list = [...m[1].matchAll(/"([a-z_]+)"/g)].map((x) => x[1]);
  assert.deepEqual([...DASHBOARD_COLLECTIONS].sort(), [...list].sort());
  for (const c of DASHBOARD_COLLECTIONS) assert.ok(CORE_COLLECTIONS.includes(c));
});

test("routeCollections: en uzun önek, sorgu dizesi, sondaki eğik çizgi, bilinmeyen yol", () => {
  assert.deepEqual(routeCollections("/settings/islem-gecmisi"), ["activity_logs"]);
  assert.deepEqual(routeCollections("/settings"), []);
  assert.deepEqual(routeCollections("/finance/invoices/?ay=2026-10"), ["invoices", "payments", "clients", "jobs"]);
  assert.deepEqual(routeCollections("/teklifler/abc/yazdir"), ["proposals", "proposal_items", "clients", "projects"]);
  assert.deepEqual(routeCollections("/bilinmeyen"), []);
  // "/" yalnız tam eşleşir; "/tasksx" "/tasks" sayılmaz
  assert.deepEqual(routeCollections("/tasksx"), []);
});

test("bootCollections: çekirdek + sayfa, tekrarsız", () => {
  const b = bootCollections("/musteri-bulma");
  assert.equal(new Set(b).size, b.length);
  for (const c of [...CORE_COLLECTIONS, "prospects", "outreach_messages", "suppression_list"]) assert.ok(b.includes(c), c);
  assert.deepEqual(unionCollections(["a", "b"], undefined, ["b", "c"]), ["a", "b", "c"]);
});

// ---------------------------------------------------------------------------
// RPC yanıtı → store
// ---------------------------------------------------------------------------

test("parseBootstrap: profil, org hedefleri ve istenen koleksiyonlar", () => {
  const r = parseBootstrap(
    {
      profile: { organization_id: "org-1", role: "admin", full_name: "Bora" },
      organization: { mrr_target: "150000.00", mrr_target_label: "Eşik" },
      since: "2025-04-09",
      clients: [{ id: "c1", name: "A" }, { id: "c2", name: "B" }],
      tasks: [],
      extra: [{ id: "x" }],
    },
    ["clients", "tasks"],
  );
  assert.deepEqual(r, {
    profile: { organization_id: "org-1", role: "admin", full_name: "Bora" },
    organization: { mrr_target: 150000, mrr_target_label: "Eşik" },
    rows: { clients: [{ id: "c1", name: "A" }, { id: "c2", name: "B" }], tasks: [] },
  });
});

test("parseBootstrap: org'suz profil, hedef yok, boş istek", () => {
  assert.deepEqual(
    parseBootstrap({ profile: { organization_id: null, role: "editor", full_name: null }, organization: null }, []),
    { profile: { organization_id: null, role: "editor", full_name: null }, organization: null, rows: {} },
  );
  assert.deepEqual(parseBootstrap({ profile: null, organization: { mrr_target: null } }, []).organization, {
    mrr_target: null,
    mrr_target_label: null,
  });
});

test("parseBootstrap: bozuk yanıt → null (eski yola düşülür); id'siz satırlar atılır", () => {
  assert.equal(parseBootstrap(null, ["clients"]), null);
  assert.equal(parseBootstrap([], ["clients"]), null);
  assert.equal(parseBootstrap({ profile: null }, ["clients"]), null, "istenen koleksiyon yok");
  assert.equal(parseBootstrap({ clients: {} }, ["clients"]), null, "dizi değil");
  assert.deepEqual(parseBootstrap({ clients: [{ id: "c1" }, { name: "id yok" }, null] }, ["clients"]).rows.clients, [{ id: "c1" }]);
});

test("isRpcMissing: yalnız 'fonksiyon yok' hataları", () => {
  assert.equal(isRpcMissing({ code: "PGRST202", message: "Could not find the function public.app_bootstrap" }), true);
  assert.equal(isRpcMissing({ code: "42883", message: "function app_bootstrap(text[]) does not exist" }), true);
  assert.equal(isRpcMissing({ code: "22023", message: "app_bootstrap: bilinmeyen koleksiyon" }), false);
  assert.equal(isRpcMissing({ code: "42501", message: "permission denied" }), false);
  assert.equal(isRpcMissing(null), false);
});

test("mergeRows: ilk yükleme — sunucu sırası, yükleme sırasında eklenen iyimser kayıt korunur", () => {
  const fetched = [{ id: "a", v: 1 }, { id: "b", v: 1 }];
  const local = [{ id: "new", v: 9 }];
  const changed = new Set(["new"]);
  assert.deepEqual(mergeRows(local, fetched, (id) => changed.has(id)), [{ id: "new", v: 9 }, ...fetched]);
});

test("mergeRows: yenileme — başka yerde silinen/bayat kayıt düşer, sunucu güncellemesi gelir", () => {
  const local = [{ id: "a", v: 1 }, { id: "gone", v: 1 }, { id: "b", v: 1 }];
  const fetched = [{ id: "a", v: 2 }, { id: "b", v: 1 }, { id: "c", v: 1 }];
  assert.deepEqual(mergeRows(local, fetched, () => false), fetched);
});

test("mergeRows: çekimden sonra yerelde güncellenen / silinen kayıt ezilmez", () => {
  const local = [{ id: "a", v: "yerel" }, { id: "b", v: 1 }];
  const fetched = [{ id: "a", v: "sunucu-eski" }, { id: "b", v: 1 }, { id: "deleted", v: 1 }];
  const changed = new Set(["a", "deleted"]);
  assert.deepEqual(mergeRows(local, fetched, (id) => changed.has(id)), [{ id: "a", v: "yerel" }, { id: "b", v: 1 }]);
});
