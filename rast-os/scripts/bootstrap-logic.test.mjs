// Çalıştırma: npm test  (Node'un yerleşik test runner'ı + type stripping)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CORE_COLLECTIONS, DASHBOARD_COLLECTIONS, FOCUS_REFRESH_AFTER_MS, SNAPSHOT_MAX_AGE_MS, SNAPSHOT_MAX_BYTES, SNAPSHOT_VERSION, bootCollections,
  NOTIFICATION_COLLECTIONS, isProfilesRejected, isRpcMissing, mergeRows, parseBootstrap, parseSnapshot, routeCollections, serializeSnapshot, shouldRefreshOnFocus, unionCollections,
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

const allowedIn = (file) => {
  const arr = read(file).match(/v_allowed constant text\[\] := array\[([\s\S]*?)\];/);
  assert.ok(arr, `${file}: v_allowed bulunamadı`);
  return [...arr[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
};
const BOOTSTRAP_SQL = ["supabase/migrations/0020_bootstrap_rpc.sql", "supabase/migrations/0021_bootstrap_profiles.sql"];

test("0021 (geçerli) app_bootstrap izin listesi store.ts COLLECTIONS ile birebir aynı", () => {
  assert.deepEqual([...allowedIn(BOOTSTRAP_SQL[1])].sort(), [...storeCollections()].sort());
});

test("0020 izin listesi = COLLECTIONS − profiles (0020 dosyası değişmedi; profiles yalnız 0021'de)", () => {
  assert.deepEqual([...allowedIn(BOOTSTRAP_SQL[0])].sort(), storeCollections().filter((c) => c !== "profiles").sort());
});

test("0020/0021: activity_logs sınırı istemcideki ACTIVITY_LOG_LIMIT ile aynı", () => {
  const limit = read("src/lib/store.ts").match(/const ACTIVITY_LOG_LIMIT = (\d+);/)?.[1];
  assert.equal(limit, "500");
  for (const f of BOOTSTRAP_SQL) assert.match(read(f), /v_limit := ' limit 500';/);
});

test("0020/0021: yalnız authenticated çalıştırır; SECURITY INVOKER", () => {
  for (const f of BOOTSTRAP_SQL) {
    const sql = read(f);
    assert.match(sql, /security invoker/);
    assert.doesNotMatch(sql, /security definer/);
    assert.match(sql, /revoke all on function public\.app_bootstrap\(text\[\], date\) from anon;/);
    assert.match(sql, /grant execute on function public\.app_bootstrap\(text\[\], date\) to authenticated;/);
  }
});

test("0021: profiles yalnız id, full_name, role, is_active ve yalnız çağıranın org'u (to_jsonb yok)", () => {
  const sql = read(BOOTSTRAP_SQL[1]);
  const branch = (sql.match(/if v_col = 'profiles' then([\s\S]*?)end if;/)?.[1] ?? "").replace(/--.*$/gm, "");
  assert.match(branch, /jsonb_build_object\(\s*'id', p\.id, 'full_name', p\.full_name, 'role', p\.role, 'is_active', p\.is_active\s*\)/);
  assert.match(branch, /where p\.organization_id = v_org/);
  assert.doesNotMatch(branch, /to_jsonb|phone|avatar/);
  // İstemcinin eski yolları da aynı kolonları ister
  assert.match(read("src/lib/store.ts"), /const PROFILE_COLUMNS = "id, full_name, role, is_active";/);
});

test("isProfilesRejected: yalnız 0020'nin profiles reddi (22023 + 'profiles')", () => {
  assert.equal(isProfilesRejected({ code: "22023", message: "app_bootstrap: bilinmeyen koleksiyon 'profiles'" }), true);
  assert.equal(isProfilesRejected({ code: "22023", message: "app_bootstrap: bilinmeyen koleksiyon 'x'" }), false);
  assert.equal(isProfilesRejected({ code: "42501", message: "profiles" }), false);
  assert.equal(isProfilesRejected(null), false);
});

test("zil ve atama koleksiyonları çekirdekte (açılış isteğine yeni tur eklenmez)", () => {
  for (const c of [...NOTIFICATION_COLLECTIONS, "profiles"]) assert.ok(CORE_COLLECTIONS.includes(c), c);
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

// ---------------------------------------------------------------------------
// sessionStorage anlık görüntüsü (stale-while-revalidate)
// ---------------------------------------------------------------------------

const snap = (over = {}) => ({
  v: SNAPSHOT_VERSION,
  userId: "u1",
  orgId: "org-1",
  savedAt: 1_000_000,
  profile: { organization_id: "org-1", role: "admin", full_name: "Bora" },
  organization: { mrr_target: 90000, mrr_target_label: "Eşik" },
  collections: { clients: [{ id: "c1", name: "Klinik" }], tasks: [] },
  ...over,
});
const ALL = ["clients", "tasks", "invoices"];

test("serializeSnapshot: sınırın altı yazılır, üstü atlanır (2 MB varsayılan)", () => {
  const small = snap();
  const json = serializeSnapshot(small);
  assert.equal(typeof json, "string");
  assert.deepEqual(JSON.parse(json), small);
  assert.equal(SNAPSHOT_MAX_BYTES, 2 * 1024 * 1024);
  const big = snap({ collections: { clients: [{ id: "c1", notes: "x".repeat(SNAPSHOT_MAX_BYTES) }] } });
  assert.equal(serializeSnapshot(big), null);
});

test("serializeSnapshot: UTF-8 bayt sayısına göre (Türkçe karakter 2 bayt)", () => {
  const s = snap({ collections: { clients: [{ id: "c1", notes: "ş".repeat(600) }] } });
  const json = serializeSnapshot(s, 10_000);
  assert.ok(json && json.length < 1000, "karakter sayısı sınırın altında");
  const bytes = new TextEncoder().encode(json).length;
  assert.equal(serializeSnapshot(s, bytes), json, "tam sınırda yazılır");
  assert.equal(serializeSnapshot(s, bytes - 1), null, "bir bayt eksik → atlanır");
});

test("serializeSnapshot: döngüsel / serileştirilemeyen → null", () => {
  const cyc = snap();
  cyc.collections.clients[0].self = cyc;
  assert.equal(serializeSnapshot(cyc), null);
});

test("parseSnapshot: geçerli kayıt geri okunur; bilinmeyen koleksiyon anahtarı atlanır", () => {
  const raw = JSON.stringify(snap({ collections: { clients: [{ id: "c1" }], hacked: [{ id: "x" }] } }));
  const r = parseSnapshot(raw, "u1", 1_000_500, ALL);
  assert.deepEqual(r.collections, { clients: [{ id: "c1" }] });
  assert.equal(r.orgId, "org-1");
  assert.deepEqual(r.organization, { mrr_target: 90000, mrr_target_label: "Eşik" });
});

test("parseSnapshot: başka kullanıcı / eski sürüm / bozuk / org'suz / süresi geçmiş → null", () => {
  const raw = JSON.stringify(snap());
  assert.equal(parseSnapshot(raw, "u2", 1_000_500, ALL), null, "başka kullanıcı");
  assert.equal(parseSnapshot(JSON.stringify(snap({ v: 0 })), "u1", 1_000_500, ALL), null, "sürüm");
  assert.equal(parseSnapshot("{bozuk", "u1", 1_000_500, ALL), null, "JSON");
  assert.equal(parseSnapshot(null, "u1", 1_000_500, ALL), null, "yok");
  assert.equal(parseSnapshot(JSON.stringify(snap({ orgId: "" })), "u1", 1_000_500, ALL), null, "org yok");
  assert.equal(parseSnapshot(JSON.stringify(snap({ collections: { clients: {} } })), "u1", 1_000_500, ALL), null, "dizi değil");
  assert.equal(parseSnapshot(raw, "u1", 1_000_000 + SNAPSHOT_MAX_AGE_MS + 1, ALL), null, "süresi geçmiş");
  assert.equal(parseSnapshot(raw, "u1", 1_000_000 - 120_000, ALL), null, "gelecekten (saat kayması)");
});

// ---------------------------------------------------------------------------
// Pencereye dönüş yenilemesi
// ---------------------------------------------------------------------------

test("shouldRefreshOnFocus: 60 sn eşiği, uçuştayken ve hiç çekim yokken hayır", () => {
  assert.equal(FOCUS_REFRESH_AFTER_MS, 60_000);
  assert.equal(shouldRefreshOnFocus(1_000, 1_000 + 60_000, false), false, "tam 60 sn: henüz değil");
  assert.equal(shouldRefreshOnFocus(1_000, 1_000 + 60_001, false), true);
  assert.equal(shouldRefreshOnFocus(1_000, 1_000 + 600_000, true), false, "çekim sürüyor");
  assert.equal(shouldRefreshOnFocus(0, 600_000, false), false, "henüz çekim yok (açılış/anlık görüntü)");
});
