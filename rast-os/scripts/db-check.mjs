#!/usr/bin/env node
// =====================================================================
// db-check — migration zincirinin ÇEVRİMDIŞI staging kontrolü (PGlite)
//
//   npm run db:check
//
// Hiçbir uzak veritabanına bağlanmaz: bellekte gerçek bir Postgres (PGlite,
// WASM) açar, Supabase'in sağladığı parçaları taklit eden saplamaları kurar
// (auth şeması + auth.uid()/jwt()/role(), auth.users, storage şeması,
// anon/authenticated/service_role rolleri, "extensions" şemasında pgcrypto,
// Supabase'in public şeması varsayılan yetkileri) ve sonra:
//
//   1) supabase/migrations/0001…0018'i numara sırasıyla, her dosyayı kendi
//      transaction'ında uygular; ilk hatada durur ve hatalı ifadeyi yazar.
//   2) Idempotency: 0008…0018'i İKİNCİ kez uygular.
//   3) Yapısal kontroller (tablo / kolon / fonksiyon / trigger / yetki).
//   4) Davranış kontrolleri: SET ROLE anon|authenticated + request.jwt.claims
//      ile (PostgREST'in yaptığı gibi) RLS, guard trigger'lar ve RPC'ler.
//   5) Türkçe özet tablo; herhangi bir hata varsa çıkış kodu 1.
//
// Sınırlar: JWT imzası / GoTrue / PostgREST yok (claim'ler elle set edilir);
// Supabase'e özgü uzantılar ve şemalar (storage API, realtime, vault, pg_net…)
// yalnızca saplama düzeyinde. PGlite sürümü Supabase'inkinden farklı olabilir.
// =====================================================================

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const started = Date.now();
const MIGRATIONS_DIR =
  process.env.DB_CHECK_MIGRATIONS_DIR ?? join(dirname(fileURLToPath(import.meta.url)), "..", "supabase", "migrations");
const IDEMPOTENT_FROM = 8;
const VERBOSE = process.argv.includes("--verbose");

// ---------------------------------------------------------------------
// Supabase saplamaları (yalnızca bu yerel PGlite örneği için)
// ---------------------------------------------------------------------
const SUPABASE_STUBS = String.raw`
create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;

-- Supabase: pgcrypto "extensions" şemasında; search_path public, extensions.
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
grant usage on schema extensions to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;

-- Supabase: public şemasında postgres'in oluşturduğu her nesne bu rollere açılır.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

-- auth şeması (GoTrue'nun tablosu + Supabase'in yardımcı fonksiyonları ile aynı tanım)
create schema auth;
grant usage on schema auth to anon, authenticated, service_role;
create table auth.users (
  id                 uuid primary key default gen_random_uuid(),
  email              text,
  raw_user_meta_data jsonb default '{}'::jsonb,
  email_confirmed_at timestamptz,
  created_at         timestamptz default now()
);
create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  ), '')::uuid
$$;
create function auth.role() returns text language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )
$$;

-- storage şeması (0006 bucket + politikaları için)
create schema storage;
grant usage on schema storage to anon, authenticated, service_role;
create table storage.buckets (
  id text primary key, name text not null, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[], created_at timestamptz default now()
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id), name text, owner uuid,
  created_at timestamptz default now()
);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language plpgsql as $$
declare _parts text[];
begin
  select string_to_array(name, '/') into _parts;
  return _parts[1:array_length(_parts, 1) - 1];
end $$;
`;

// ---------------------------------------------------------------------
// SQL ifade ayırıcı (tırnak, $tag$, yorum farkında) — hatalı ifadeyi
// satır numarasıyla gösterebilmek için dosyalar ifade ifade çalıştırılır.
// ---------------------------------------------------------------------
function splitSql(sql) {
  const out = [];
  let i = 0, start = 0, line = 1, startLine = 1, meaningful = false;
  const n = sql.length;
  const push = (end) => {
    const text = sql.slice(start, end).trim();
    if (meaningful && text) out.push({ text, line: startLine });
    meaningful = false;
  };
  while (i < n) {
    const c = sql[i], d = sql[i + 1];
    if (c === "\n") { line++; i++; continue; }
    if (c === "-" && d === "-") { while (i < n && sql[i] !== "\n") i++; continue; }
    if (c === "/" && d === "*") {
      let depth = 1; i += 2;
      while (i < n && depth) {
        if (sql[i] === "\n") line++;
        if (sql[i] === "/" && sql[i + 1] === "*") { depth++; i += 2; continue; }
        if (sql[i] === "*" && sql[i + 1] === "/") { depth--; i += 2; continue; }
        i++;
      }
      continue;
    }
    if (!meaningful && !/\s/.test(c) && c !== ";") { meaningful = true; startLine = line; }
    if (c === "'" || c === '"') {
      const q = c; i++;
      while (i < n) {
        if (sql[i] === "\n") line++;
        if (sql[i] === q) { if (sql[i + 1] === q) { i += 2; continue; } i++; break; }
        i++;
      }
      continue;
    }
    if (c === "$") {
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i, i + 64));
      if (m) {
        const tag = m[0];
        const endIdx = sql.indexOf(tag, i + tag.length);
        const stop = endIdx === -1 ? n : endIdx + tag.length;
        for (let k = i; k < stop; k++) if (sql[k] === "\n") line++;
        i = stop;
        continue;
      }
    }
    if (c === ";") { push(i + 1); i++; start = i; continue; }
    i++;
  }
  push(n);
  return out;
}

// ---------------------------------------------------------------------
// Sonuç kaydı
// ---------------------------------------------------------------------
const results = [];
const record = (group, name, ok, detail = "") => {
  results.push({ group, name, ok, detail });
  if (VERBOSE || !ok) console.log(`  ${ok ? "OK  " : "FAIL"} [${group}] ${name}${detail ? " — " + detail : ""}`);
};
const errText = (e) => `${e?.code ?? "?"} ${String(e?.message ?? e).split("\n")[0]}`;

/** fn true döndürürse geçer; string döndürürse o metinle kalır; hata fırlatırsa kalır. */
async function check(group, name, fn) {
  try {
    const r = await fn();
    if (r === true || r === undefined) record(group, name, true);
    else record(group, name, false, typeof r === "string" ? r : JSON.stringify(r));
  } catch (e) {
    record(group, name, false, errText(e));
  }
}

/** İşlemin verilen SQLSTATE ile reddedilmesini bekler. */
async function expectError(fn, codes) {
  const want = [].concat(codes);
  try {
    const r = await fn();
    return `hata bekleniyordu (${want.join("/")}), başarılı oldu: ${JSON.stringify(r?.rows ?? r)?.slice(0, 160)}`;
  } catch (e) {
    return want.includes(e?.code) ? true : `beklenen ${want.join("/")}, gelen ${errText(e)}`;
  }
}

const eq = (got, want, what = "değer") =>
  JSON.stringify(got) === JSON.stringify(want) ? true : `${what}: beklenen ${JSON.stringify(want)}, gelen ${JSON.stringify(got)}`;

// ---------------------------------------------------------------------
// Veritabanı
// ---------------------------------------------------------------------
const db = new PGlite({ extensions: { pgcrypto } });
await db.exec(`set search_path to "$user", public, extensions;`);
await db.exec(SUPABASE_STUBS);

const one = async (sql, params) => (await db.query(sql, params)).rows[0];
const val = async (sql, params) => {
  const r = await one(sql, params);
  return r ? Object.values(r)[0] : undefined;
};

/** PostgREST benzeri: rol + JWT claim'leri ile çalıştır, sonra süper kullanıcıya dön. */
async function as(role, sub, fn) {
  await db.exec("reset role");
  const claims = sub ? { sub, role } : { role };
  await db.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify(claims)]);
  await db.exec(`set role ${role}`);
  try {
    return await fn();
  } finally {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claims', '', false)");
  }
}

const migrationFiles = readdirSync(MIGRATIONS_DIR)
  .filter((f) => /^\d{4}_.+\.sql$/.test(f))
  .sort((a, b) => Number(a.slice(0, 4)) - Number(b.slice(0, 4)));

async function applyMigration(file, pass) {
  const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
  const stmts = splitSql(sql);
  const t0 = Date.now();
  await db.exec("begin");
  for (const s of stmts) {
    try {
      await db.exec(s.text);
    } catch (e) {
      await db.exec("rollback");
      const snippet = s.text.length > 600 ? s.text.slice(0, 600) + " …" : s.text;
      console.log(`FAIL  ${file} (${pass}) — satır ${s.line}: ${errText(e)}`);
      if (e?.detail) console.log(`      detay: ${e.detail}`);
      if (e?.where) console.log(`      yer: ${e.where}`);
      console.log(`      ifade:\n${snippet.replace(/^/gm, "        ")}`);
      return { ok: false, detail: `satır ${s.line}: ${errText(e)}` };
    }
  }
  await db.exec("commit");
  console.log(`OK    ${file} (${pass}, ${stmts.length} ifade, ${Date.now() - t0} ms)`);
  return { ok: true };
}

// ---------------------------------------------------------------------
// 1) + 2) Migration zinciri ve idempotency
// ---------------------------------------------------------------------
console.log(`db-check: ${migrationFiles.length} migration, PGlite ${await val("select version()")}`.slice(0, 120));
let chainOk = true;
for (const f of migrationFiles) {
  const r = await applyMigration(f, "1. geçiş");
  record("zincir", f, r.ok, r.detail);
  if (!r.ok) { chainOk = false; break; }
}
if (chainOk) {
  for (const f of migrationFiles.filter((x) => Number(x.slice(0, 4)) >= IDEMPOTENT_FROM)) {
    const r = await applyMigration(f, "2. geçiş");
    record("idempotency", f, r.ok, r.detail);
    if (!r.ok) { chainOk = false; break; }
  }
}

if (chainOk) {
  await structuralChecks();
  await behaviouralChecks();
}

// ---------------------------------------------------------------------
// 3) Yapısal kontroller (süper kullanıcı olarak katalog sorguları)
// ---------------------------------------------------------------------
async function structuralChecks() {
  const G = "yapı";
  for (const t of [
    "proposals", "proposal_items", "activity_logs", "content_approvals", "organization_invites",
    "lead_intake_settings", "client_reports", "client_portal_tokens",
  ]) {
    await check(G, `tablo public.${t}`, async () => (await val("select to_regclass($1) is not null", [`public.${t}`])) || "yok");
  }

  for (const [t, c] of [
    ["expenses", "fx_rate"], ["expenses", "amount_try"], ["contents", "script_source"],
    ["projects", "proposal_id"], ["organizations", "mrr_target"], ["organizations", "mrr_target_label"],
    ["activity_logs", "actor_name"], ["activity_logs", "record_label"], ["leads", "source_package"],
    ["leads", "source_utm"], ["tasks", "lead_id"],
  ]) {
    await check(G, `kolon ${t}.${c}`, async () =>
      (await val(
        "select exists(select 1 from information_schema.columns where table_schema='public' and table_name=$1 and column_name=$2)",
        [t, c],
      )) || "yok");
  }

  const fns = [
    "import_rows(jsonb)", "approval_get(text)", "approval_decide(text,text,text,text,text[])", "approval_new_token()",
    "approval_default_checklist()", "lead_intake(uuid,jsonb,text)", "lead_phone_key(text)", "portal_get(text)",
    "portal_touch(text)", "portal_report_get(text,text)", "portal_active_token(text)", "log_activity()",
    "handle_new_user()", "apply_invite_to_existing_user()", "current_org_id()", "current_role_name()",
    "set_updated_at()", "content_approvals_guard()", "client_portal_tokens_guard()",
  ];
  for (const f of fns) {
    await check(G, `fonksiyon ${f}`, async () => (await val("select to_regprocedure($1) is not null", [`public.${f}`])) || "yok");
  }

  // activity_logs trigger'ları
  const logged = [
    "clients", "projects", "jobs", "tasks", "invoices", "payments", "expenses", "proposals", "proposal_items",
    "content_approvals", "client_reports", "client_portal_tokens",
  ];
  const trig = (await db.query(
    `select c.relname from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_proc p on p.oid = t.tgfoid
      where not t.tgisinternal and p.proname = 'log_activity'`,
  )).rows.map((r) => r.relname).sort();
  await check(G, "log_activity trigger'ları (12 tablo)", () => eq(trig, [...logged].sort(), "trigger bağlı tablolar"));

  await check(G, "auth.users trigger'ları (oluşturma + e-posta onayı)", async () => {
    const r = (await db.query(
      `select t.tgname from pg_trigger t where t.tgrelid = 'auth.users'::regclass and not t.tgisinternal order by 1`,
    )).rows.map((x) => x.tgname);
    return eq(r, ["on_auth_user_created", "on_auth_user_email_confirmed"], "trigger'lar");
  });

  await check(G, "public'te RLS kapalı tablo yok", async () => {
    const r = (await db.query(
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity order by 1`,
    )).rows.map((x) => x.relname);
    return r.length === 0 ? true : `RLS kapalı: ${r.join(", ")}`;
  });

  // --- Tablo / kolon yetkileri (Supabase varsayılan yetkileri taklit edildi) ---
  const tablePriv = async (role, table, priv) => val("select has_table_privilege($1, $2, $3)", [role, `public.${table}`, priv]);
  for (const [role, table, priv] of [
    ["anon", "client_portal_tokens", "select"], ["anon", "content_approvals", "select"],
    ["anon", "client_reports", "select"], ["anon", "organization_invites", "select"],
    ["anon", "lead_intake_settings", "select"], ["authenticated", "lead_intake_settings", "select"],
    ["authenticated", "activity_logs", "insert"], ["authenticated", "activity_logs", "update"],
    ["authenticated", "activity_logs", "delete"], ["authenticated", "organization_invites", "update"],
  ]) {
    await check(G, `${role} ${priv} ${table} = false`, async () => eq(await tablePriv(role, table, priv), false));
  }
  const colPriv = async (role, table, col, priv) =>
    val("select has_column_privilege($1, $2, $3, $4)", [role, `public.${table}`, col, priv]);
  for (const [table, col, want] of [
    ["profiles", "role", false], ["profiles", "organization_id", false], ["profiles", "id", false],
    ["profiles", "full_name", true], ["organizations", "name", false], ["organizations", "mrr_target", true],
  ]) {
    await check(G, `authenticated update ${table}.${col} = ${want}`, async () =>
      eq(await colPriv("authenticated", table, col, "update"), want));
  }

  // --- Fonksiyon yetkileri ---
  const fnPriv = async (role, f) => val("select has_function_privilege($1, $2, 'execute')", [role, `public.${f}`]);
  const ANON_RPC = [
    "approval_get(text)", "approval_decide(text,text,text,text,text[])", "lead_intake(uuid,jsonb,text)",
    "portal_get(text)", "portal_touch(text)", "portal_report_get(text,text)",
  ];
  for (const f of ANON_RPC) await check(G, `anon execute ${f} = true`, async () => eq(await fnPriv("anon", f), true));
  for (const f of [
    "import_rows(jsonb)", "approval_new_token()", "approval_default_checklist()", "portal_active_token(text)",
    "log_activity()", "handle_new_user()", "apply_invite_to_existing_user()", "set_updated_at()",
    "content_approvals_guard()", "client_portal_tokens_guard()", "current_org_id()", "current_role_name()",
  ]) {
    await check(G, `anon execute ${f} = false`, async () => eq(await fnPriv("anon", f), false));
  }
  for (const [f, want] of [
    ["current_org_id()", true], ["current_role_name()", true], ["import_rows(jsonb)", true],
    ["approval_new_token()", true], ["handle_new_user()", false], ["log_activity()", false],
    ["portal_active_token(text)", false], ["apply_invite_to_existing_user()", false],
  ]) {
    await check(G, `authenticated execute ${f} = ${want}`, async () => eq(await fnPriv("authenticated", f), want));
  }
  for (const f of ["current_org_id()", "current_role_name()"]) {
    await check(G, `service_role execute ${f} = true`, async () => eq(await fnPriv("service_role", f), true));
  }

  // anon'un çalıştırabildiği SECURITY DEFINER fonksiyonlar tam olarak public RPC listesi olmalı.
  await check(G, "anon'a açık SECURITY DEFINER fonksiyonlar = public RPC listesi", async () => {
    const r = (await db.query(
      `select replace(p.oid::regprocedure::text, ' ', '') as f from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'execute') order by 1`,
    )).rows.map((x) => x.f.replace(/^public\./, ""));
    return eq(r.sort(), [...ANON_RPC].sort(), "anon definer listesi");
  });
  // authenticated: portal_* yalnız anon'a açık; RLS yardımcıları açık kalmalı.
  await check(G, "authenticated'a açık SECURITY DEFINER fonksiyonlar beklenen listede", async () => {
    const r = (await db.query(
      `select replace(p.oid::regprocedure::text, ' ', '') as f from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.prosecdef and has_function_privilege('authenticated', p.oid, 'execute') order by 1`,
    )).rows.map((x) => x.f.replace(/^public\./, ""));
    const want = [
      "approval_decide(text,text,text,text,text[])", "approval_get(text)", "current_org_id()",
      "current_role_name()", "lead_intake(uuid,jsonb,text)",
    ];
    return eq(r.sort(), want.sort(), "authenticated definer listesi");
  });
}

// ---------------------------------------------------------------------
// 4) Davranış kontrolleri
// ---------------------------------------------------------------------
async function behaviouralChecks() {
  const U = {
    A: "00000000-0000-4000-8000-00000000000a", // davetsiz
    B: "00000000-0000-4000-8000-00000000000b", // davetli admin
    C: "00000000-0000-4000-8000-00000000000c", // davetli editor, e-postayı sonra onaylar
    D: "00000000-0000-4000-8000-00000000000d", // önce kayıt, sonra davet
  };
  const ORG1 = await val("select id from organizations where name = 'Rast Creative' order by created_at limit 1");
  const ORG2 = await val("insert into organizations (name) values ('Başka Ajans') returning id");
  const ME = "kayıt/davet";

  // --- 0008: davet akışı ---
  await db.query(
    "insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values ($1, 'a@ornek.com', now(), '{\"full_name\":\"Ayşe Davetsiz\"}')",
    [U.A],
  );
  await check(ME, "davetsiz kayıt → organization_id NULL, rol editor", async () =>
    eq(await one("select organization_id, role from profiles where id = $1", [U.A]), { organization_id: null, role: "editor" }));

  await db.query("insert into organization_invites (organization_id, email, role) values ($1, 'b@ornek.com', 'admin')", [ORG1]);
  await db.query(
    "insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values ($1, ' B@Ornek.com', now(), '{\"full_name\":\"Bora Admin\"}')",
    [U.B],
  );
  await check(ME, "davetli + onaylı e-posta → org ve davet rolü atanır", async () =>
    eq(await one("select organization_id, role from profiles where id = $1", [U.B]), { organization_id: ORG1, role: "admin" }));
  await check(ME, "davet accepted_at doldu", async () =>
    (await val("select accepted_at is not null from organization_invites where email = 'b@ornek.com'")) || "accepted_at boş");

  await db.query("insert into organization_invites (organization_id, email, role) values ($1, 'c@ornek.com', 'editor')", [ORG1]);
  await db.query(
    "insert into auth.users (id, email, raw_user_meta_data) values ($1, 'c@ornek.com', '{\"full_name\":\"Cem Editör\"}')",
    [U.C],
  );
  await check(ME, "davetli ama e-posta onaysız → organization_id NULL", async () =>
    eq(await val("select organization_id from profiles where id = $1", [U.C]), null));
  await db.query("update auth.users set email_confirmed_at = now() where id = $1", [U.C]);
  await check(ME, "e-posta onaylanınca davet uygulanır", async () =>
    eq(await one("select organization_id, role from profiles where id = $1", [U.C]), { organization_id: ORG1, role: "editor" }));

  await db.query("insert into auth.users (id, email, email_confirmed_at) values ($1, 'd@ornek.com', now())", [U.D]);
  await db.query("insert into organization_invites (organization_id, email, role) values ($1, 'd@ornek.com', 'accountant')", [ORG1]);
  await check(ME, "önce kayıt sonra davet → mevcut kullanıcı bağlanır", async () =>
    eq(await one("select organization_id, role from profiles where id = $1", [U.D]), { organization_id: ORG1, role: "accountant" }));
  await check(ME, "davet e-postası küçük harf kısıtı", () =>
    expectError(() => db.query("insert into organization_invites (organization_id, email) values ($1, 'X@Y.com')", [ORG1]), "23514"));

  // --- 0008: profiles yetki yükseltme ---
  const PR = "profiles";
  await check(PR, "authenticated kendi role'ünü admin yapamaz (42501)", () =>
    as("authenticated", U.A, () => expectError(() => db.query("update profiles set role = 'admin' where id = $1", [U.A]), "42501")));
  await check(PR, "authenticated kendi organization_id'sini değiştiremez (42501)", () =>
    as("authenticated", U.A, () =>
      expectError(() => db.query("update profiles set organization_id = $2 where id = $1", [U.A, ORG1]), "42501")));
  await check(PR, "authenticated kendi full_name'ini güncelleyebilir", () =>
    as("authenticated", U.A, async () =>
      eq((await db.query("update profiles set full_name = 'Ayşe Y.' where id = $1", [U.A])).affectedRows, 1, "etkilenen satır")));
  await check(PR, "başkasının profili güncellenemez (0 satır)", () =>
    as("authenticated", U.B, async () =>
      eq((await db.query("update profiles set full_name = 'X' where id = $1", [U.C])).affectedRows, 0, "etkilenen satır")));

  // --- RLS yardımcıları ve org izolasyonu ---
  const RL = "RLS";
  await check(RL, "current_org_id()/current_role_name() authenticated için çalışır", () =>
    as("authenticated", U.B, async () =>
      eq(await one("select current_org_id() as org, current_role_name() as role"), { org: ORG1, role: "admin" })));
  await check(RL, "anon current_org_id() çağıramaz (42501)", () =>
    as("anon", null, () => expectError(() => db.query("select current_org_id()"), "42501")));
  await check(RL, "anon org tablosunu (leads) okuyamaz", () =>
    as("anon", null, () => expectError(() => db.query("select count(*) from leads"), "42501")));

  await db.query("insert into clients (organization_id, name) values ($1, 'Başka Org Müşterisi')", [ORG2]);
  const CLIENT = await as("authenticated", U.B, () =>
    val("insert into clients (organization_id, name, monthly_fee) values ($1, 'Dr. Test Kliniği', 30000) returning id", [ORG1]));
  await check(RL, "authenticated (org1) yalnız kendi org müşterilerini görür", () =>
    as("authenticated", U.B, async () => eq(await val("select array_agg(name order by name) from clients"), ["Dr. Test Kliniği"])));
  await check(RL, "org'suz kullanıcı hiçbir müşteri görmez", () =>
    as("authenticated", U.A, async () => eq(Number(await val("select count(*) from clients")), 0)));
  await check(RL, "org'suz kullanıcı org1'e müşteri ekleyemez (RLS 42501)", () =>
    as("authenticated", U.A, () =>
      expectError(() => db.query("insert into clients (organization_id, name) values ($1, 'Sızma')", [ORG1]), "42501")));
  await check(RL, "org1 kullanıcısı org2'ye yazamaz (RLS 42501)", () =>
    as("authenticated", U.B, () =>
      expectError(() => db.query("insert into clients (organization_id, name) values ($1, 'Sızma')", [ORG2]), "42501")));

  // --- 0011 + 0012: teklifler ve işlem geçmişi ---
  const P = "teklif/log";
  let PROPOSAL;
  await check(P, "teklif + 2 kalem oluşturulur (authenticated)", () =>
    as("authenticated", U.B, async () => {
      PROPOSAL = await val(
        "insert into proposals (organization_id, client_id, title, proposal_no) values ($1, $2, 'Hekim İçerik Sistemi', 'RC-2026-001') returning id",
        [ORG1, CLIENT],
      );
      await db.query(
        `insert into proposal_items (organization_id, proposal_id, position, name, qty, unit_price, is_recurring)
         values ($1, $2, 0, 'Aylık içerik', 1, 30000, true), ($1, $2, 1, 'Kurulum', 1, 15000, false)`,
        [ORG1, PROPOSAL],
      );
      return eq(Number(await val("select count(*) from proposal_items where proposal_id = $1", [PROPOSAL])), 2, "kalem sayısı");
    }));
  await check(P, "aynı org'da teklif no tekil (23505)", () =>
    as("authenticated", U.B, () =>
      expectError(() => db.query("insert into proposals (organization_id, title, proposal_no) values ($1, 'X', 'RC-2026-001')", [ORG1]), "23505")));
  await check(P, "başka org'a kalem eklenemez", () =>
    as("authenticated", U.B, () =>
      expectError(() => db.query("insert into proposal_items (organization_id, proposal_id, name) values ($1, $2, 'X')", [ORG2, PROPOSAL]), ["42501", "23503"])));
  await check(P, "update → updated_at trigger + log diff", () =>
    as("authenticated", U.B, async () => {
      const before = await val("select updated_at from proposals where id = $1", [PROPOSAL]);
      await new Promise((r) => setTimeout(r, 5));
      await db.query("update proposals set title = 'Hekim İçerik Sistemi v2', status = 'sent' where id = $1", [PROPOSAL]);
      const row = await one("select updated_at from proposals where id = $1", [PROPOSAL]);
      if (!(row.updated_at > before)) return "updated_at değişmedi";
      const log = await one(
        "select actor_id, actor_name, record_label, diff from activity_logs where entity = 'proposals' and action = 'update' order by created_at desc limit 1",
      );
      if (!log) return "update logu yok";
      if (log.actor_id !== U.B || log.actor_name !== "Bora Admin") return `aktör yanlış: ${JSON.stringify(log)}`;
      return eq(Object.keys(log.diff).sort(), ["status", "title"], "diff anahtarları");
    }));
  await check(P, "insert logları (proposals + proposal_items) yazıldı", async () =>
    eq((await db.query("select entity, count(*)::int n from activity_logs where action = 'insert' and entity like 'proposal%' group by 1 order by 1")).rows,
      [{ entity: "proposal_items", n: 2 }, { entity: "proposals", n: 1 }]));
  await check(P, "authenticated activity_logs'a yazamaz (42501)", () =>
    as("authenticated", U.B, () =>
      expectError(() => db.query("insert into activity_logs (organization_id, entity, action) values ($1, 'x', 'insert')", [ORG1]), "42501")));
  await check(P, "org'suz kullanıcı logları göremez", () =>
    as("authenticated", U.A, async () => eq(Number(await val("select count(*) from activity_logs")), 0)));

  // --- 0015: teklif → proje bağı ---
  await check("0015", "teklif başına tek proje (23505)", () =>
    as("authenticated", U.B, async () => {
      await db.query("insert into projects (organization_id, client_id, name, proposal_id) values ($1, $2, 'Proje 1', $3)", [ORG1, CLIENT, PROPOSAL]);
      return expectError(
        () => db.query("insert into projects (organization_id, client_id, name, proposal_id) values ($1, $2, 'Proje 2', $3)", [ORG1, CLIENT, PROPOSAL]),
        "23505",
      );
    }));

  // --- 0009 / 0014 / 0016 kısıtları ---
  const K = "kısıtlar";
  await check(K, "expenses.fx_rate > 0 kısıtı", () =>
    expectError(() => db.query("insert into expenses (organization_id, amount, currency, fx_rate) values ($1, 10, 'USD', 0)", [ORG1]), "23514"));
  await check(K, "contents.script_source değer kısıtı", () =>
    expectError(() => db.query("insert into contents (organization_id, title, script_source) values ($1, 'X', 'chatgpt')", [ORG1]), "23514"));
  await check(K, "admin mrr_target güncelleyebilir", () =>
    as("authenticated", U.B, async () =>
      eq((await db.query("update organizations set mrr_target = 150000 where id = $1", [ORG1])).affectedRows, 1, "etkilenen satır")));
  await check(K, "admin organizations.name güncelleyemez (42501)", () =>
    as("authenticated", U.B, () => expectError(() => db.query("update organizations set name = 'X' where id = $1", [ORG1]), "42501")));
  await check(K, "editor mrr_target güncelleyemez (0 satır)", () =>
    as("authenticated", U.C, async () =>
      eq((await db.query("update organizations set mrr_target = 1 where id = $1", [ORG1])).affectedRows, 0, "etkilenen satır")));

  // --- 0013: içerik onayı ---
  const AP = "onay";
  const today = await val("select (now() at time zone 'Europe/Istanbul')::date::text");
  const CONTENT = await as("authenticated", U.B, () =>
    val(
      "insert into contents (organization_id, client_id, title, status, planned_date) values ($1, $2, 'Diş beyazlatma nedir?', 'internal_review', $3) returning id",
      [ORG1, CLIENT, today],
    ));
  await check(AP, "approval_new_token() authenticated → 64 hex", () =>
    as("authenticated", U.B, async () => (/^[0-9a-f]{64}$/.test(await val("select approval_new_token()")) ? true : "format yanlış")));
  await check(AP, "approval_new_token() anon çağıramaz (42501)", () =>
    as("anon", null, () => expectError(() => db.query("select approval_new_token()"), "42501")));
  let TOKEN;
  await check(AP, "onay talebi: istemci token'ı yok sayılır, sunucu üretir", () =>
    as("authenticated", U.B, async () => {
      TOKEN = await val(
        "insert into content_approvals (organization_id, content_id, title, script_snapshot, token) values ($1, $2, 'Diş beyazlatma nedir?', 'Senaryo', $3) returning token",
        [ORG1, CONTENT, "f".repeat(64)],
      );
      return TOKEN !== "f".repeat(64) && /^[0-9a-f]{64}$/.test(TOKEN) ? true : `token: ${TOKEN}`;
    }));
  await check(AP, "istemci 'approved' kayıt oluşturamaz (42501)", () =>
    as("authenticated", U.B, () =>
      expectError(() => db.query("insert into content_approvals (organization_id, title, status) values ($1, 'X', 'approved')", [ORG1]), "42501")));
  await check(AP, "anon content_approvals tablosunu okuyamaz (42501)", () =>
    as("anon", null, () => expectError(() => db.query("select * from content_approvals"), "42501")));
  await check(AP, "approval_get (anon) → pending, 8 madde", () =>
    as("anon", null, async () => {
      const r = await val("select approval_get($1)", [TOKEN]);
      if (!r) return "null döndü";
      return eq([r.status, r.checklist.length, r.agency_name, r.client_name], ["pending", 8, "Rast Creative", "Dr. Test Kliniği"]);
    }));
  await check(AP, "approval_get geçersiz token → null", () =>
    as("anon", null, async () => eq(await val("select approval_get('nope')"), null)));
  const keys = (await val("select approval_default_checklist()")).map((x) => x.key);
  const decide = (checked) =>
    as("anon", null, () =>
      val("select approval_decide($1, 'approved', 'Dr. Kemal Test', null, $2::text[])", [TOKEN, checked]));
  await check(AP, "approval_decide 7/8 madde → checklist_incomplete", async () =>
    eq(await decide(keys.slice(0, 7)), { ok: false, error: "checklist_incomplete" }));
  await check(AP, "approval_decide 8/8 madde → approved", async () => {
    const r = await decide(keys);
    return r?.ok === true && r.status === "approved" ? true : JSON.stringify(r);
  });
  await check(AP, "karar kaydı: 8 madde işaretli, karar veren adı yazıldı", async () => {
    const r = await one(
      "select status, decided_by_name, (select count(*)::int from jsonb_array_elements(checklist) e where (e->>'checked')::boolean) as checked from content_approvals where token = $1",
      [TOKEN],
    );
    return eq(r, { status: "approved", decided_by_name: "Dr. Kemal Test", checked: 8 });
  });
  await check(AP, "ikinci karar → already_decided", async () => eq(await decide(keys), { ok: false, error: "already_decided" }));
  await check(AP, "karar verilmiş kayıt istemciden değiştirilemez (42501)", () =>
    as("authenticated", U.B, () =>
      expectError(() => db.query("update content_approvals set status = 'pending' where token = $1", [TOKEN]), "42501")));
  await check(AP, "karar verilmiş kayıt silinemez (0 satır)", () =>
    as("authenticated", U.B, async () =>
      eq((await db.query("delete from content_approvals where token = $1", [TOKEN])).affectedRows, 0, "silinen satır")));

  // Portal için: ikinci içerik + bekleyen onay
  await as("authenticated", U.B, async () => {
    const c2 = await val(
      "insert into contents (organization_id, client_id, title, status, planned_date) values ($1, $2, 'İmplant sonrası bakım', 'sent_to_client', $3) returning id",
      [ORG1, CLIENT, today],
    );
    await db.query("insert into content_approvals (organization_id, content_id, title) values ($1, $2, 'İmplant sonrası bakım')", [ORG1, c2]);
  });

  // --- 0018: müşteri portalı ---
  const PO = "portal";
  const period = today.slice(0, 7);
  await as("authenticated", U.B, () =>
    db.query("insert into client_reports (organization_id, client_id, period, notes) values ($1, $2, $3::date, 'Bu ay 2 içerik')", [
      ORG1, CLIENT, `${period}-01`,
    ]));
  let PTOKEN;
  await check(PO, "portal bağlantısı: token sunucuda üretilir", () =>
    as("authenticated", U.B, async () => {
      PTOKEN = await val(
        "insert into client_portal_tokens (organization_id, client_id, label, token) values ($1, $2, 'Dr. Test — WhatsApp', $3) returning token",
        [ORG1, CLIENT, "a".repeat(64)],
      );
      return PTOKEN !== "a".repeat(64) && /^[0-9a-f]{64}$/.test(PTOKEN) ? true : `token: ${PTOKEN}`;
    }));
  await check(PO, "anon client_portal_tokens tablosunu okuyamaz (42501)", () =>
    as("anon", null, () => expectError(() => db.query("select * from client_portal_tokens"), "42501")));
  await check(PO, "portal_get (anon) → müşteri, içerikler, 1 bekleyen onay, son rapor", () =>
    as("anon", null, async () => {
      const r = await val("select portal_get($1)", [PTOKEN]);
      if (!r) return "null döndü";
      return eq(
        [r.client_name, r.contents.length, r.pending_count, r.pending[0]?.token?.length, r.latest_report?.notes, "label" in r],
        ["Dr. Test Kliniği", 2, 1, 64, "Bu ay 2 içerik", false],
      );
    }));
  await check(PO, "portal_get yanlış token → null", () =>
    as("anon", null, async () => eq(await val("select portal_get($1)", ["b".repeat(64)]), null)));
  await check(PO, "portal_report_get (anon) kayıtlı ay → veri; kayıtsız ay → null", () =>
    as("anon", null, async () => {
      const a = await val("select portal_report_get($1, $2)", [PTOKEN, period]);
      const b = await val("select portal_report_get($1, '2020-01')", [PTOKEN]);
      const c = await val("select portal_report_get($1, '2020-13')", [PTOKEN]);
      return eq([a?.report?.notes, a?.contents?.length, b, c], ["Bu ay 2 içerik", 2, null, null]);
    }));
  await check(PO, "portal_touch (anon) last_seen_at yazar, log üretmez", async () => {
    const before = Number(await val("select count(*) from activity_logs where entity = 'client_portal_tokens'"));
    await as("anon", null, () => db.query("select portal_touch($1)", [PTOKEN]));
    const seen = await val("select last_seen_at is not null from client_portal_tokens where token = $1", [PTOKEN]);
    const after = Number(await val("select count(*) from activity_logs where entity = 'client_portal_tokens'"));
    return eq([seen, after - before], [true, 0]);
  });
  await check(PO, "authenticated portal_get çağıramaz (yalnız anon RPC)", () =>
    as("authenticated", U.B, () => expectError(() => db.query("select portal_get($1)", [PTOKEN]), "42501")));
  await check(PO, "token istemciden değiştirilemez (42501)", () =>
    as("authenticated", U.B, () =>
      expectError(() => db.query("update client_portal_tokens set token = $2 where token = $1", [PTOKEN, "c".repeat(64)]), "42501")));
  await check(PO, "iptal → portal_get null; iptal geri alınamaz (42501)", async () => {
    await as("authenticated", U.B, () => db.query("update client_portal_tokens set revoked_at = now() where token = $1", [PTOKEN]));
    const r = await as("anon", null, () => val("select portal_get($1)", [PTOKEN]));
    if (r !== null) return "iptal sonrası veri döndü";
    return as("authenticated", U.B, () =>
      expectError(() => db.query("update client_portal_tokens set revoked_at = null where token = $1", [PTOKEN]), "42501"));
  });

  // --- 0017: lead girişi ---
  const L = "lead";
  const secret = "s3cr3t-".repeat(6);
  await db.query("insert into lead_intake_settings (organization_id, token_hash) values ($1, $2)", [
    ORG1, createHash("sha256").update(secret).digest("hex"),
  ]);
  const intake = (payload, tok = secret, org = ORG1) =>
    as("anon", null, () => val("select lead_intake($1, $2::jsonb, $3)", [org, JSON.stringify(payload), tok]));
  const lead = { name: "Ayşe Kaya", company: "Kaya Klinik", phone: "0532 111 22 33", email: "Ayse@Kaya.com", kaynak: "hekim" };
  await check(L, "doğru sır → lead + arama görevi", async () => {
    const r = await intake(lead);
    if (!r?.ok || r.duplicate !== false) return JSON.stringify(r);
    const t = await one("select assignee_id, priority, lead_id from tasks where id = $1", [r.task_id]);
    return eq([t.assignee_id, t.priority, t.lead_id], [U.B, "high", r.lead_id]);
  });
  await check(L, "aynı kişi (telefon varyantı) → duplicate, yeni görev yok", async () => {
    const r = await intake({ name: "Ayşe K", phone: "+90 (532) 111 22 33" });
    const n = await one("select (select count(*)::int from leads) leads, (select count(*)::int from tasks where lead_id is not null) tasks");
    return eq([r?.duplicate, n], [true, { leads: 1, tasks: 1 }]);
  });
  await check(L, "yanlış sır → 42501", () => expectError(() => intake(lead, "x".repeat(42)), "42501"));
  await check(L, "ayarı olmayan org → 42501", () => expectError(() => intake(lead, secret, ORG2), "42501"));
  await check(L, "anon/authenticated lead_intake_settings okuyamaz", async () => {
    const a = await as("anon", null, () => expectError(() => db.query("select * from lead_intake_settings"), "42501"));
    const b = await as("authenticated", U.B, () => expectError(() => db.query("select * from lead_intake_settings"), "42501"));
    return a === true && b === true ? true : `${a} / ${b}`;
  });

  // --- 0010: import_rows ---
  const IM = "import_rows";
  const NEWC = "11111111-1111-4111-8111-111111111111";
  const NEWE = "22222222-2222-4222-8222-222222222222";
  await check(IM, "boş (dry) payload → 0/0/0", () =>
    as("authenticated", U.B, async () => eq(await val("select import_rows('{}'::jsonb)"), { deleted: 0, updated: 0, inserted: 0 })));
  await check(IM, "insert → update → delete; organization_id istemciden alınmaz", () =>
    as("authenticated", U.B, async () => {
      const r1 = await val("select import_rows($1::jsonb)", [JSON.stringify({
        inserts: [
          { table: "clients", row: { id: NEWC, name: "İçe Aktarılan Klinik", organization_id: ORG2 } },
          { table: "expenses", row: { id: NEWE, amount: 100, currency: "USD", fx_rate: 32.5, amount_try: 3250, client_id: NEWC } },
        ],
      })]);
      const r2 = await val("select import_rows($1::jsonb)", [JSON.stringify({
        updates: [{ table: "clients", id: NEWC, patch: { name: "Yeni Ad", organization_id: ORG2 } }],
        deletes: [{ table: "expenses", id: NEWE }],
      })]);
      const c = await one("select name, organization_id from clients where id = $1", [NEWC]);
      return eq([r1, r2, c], [
        { deleted: 0, updated: 0, inserted: 2 },
        { deleted: 1, updated: 1, inserted: 0 },
        { name: "Yeni Ad", organization_id: ORG1 },
      ]);
    }));
  await check(IM, "izin verilmeyen tablo → 22023 ve hiçbir satır kalmaz", () =>
    as("authenticated", U.B, async () => {
      const id = "33333333-3333-4333-8333-333333333333";
      const e = await expectError(() => db.query("select import_rows($1::jsonb)", [JSON.stringify({
        inserts: [{ table: "clients", row: { id, name: "Yarım" } }, { table: "profiles", row: { id, full_name: "x" } }],
      })]), "22023");
      if (e !== true) return e;
      return eq(Number(await val("select count(*) from clients where id = $1", [id])), 0, "yarım kalan satır");
    }));
  await check(IM, "org'suz kullanıcı → 42501", () =>
    as("authenticated", U.A, () => expectError(() => db.query("select import_rows('{}'::jsonb)"), "42501")));
  await check(IM, "anon çağıramaz → 42501", () =>
    as("anon", null, () => expectError(() => db.query("select import_rows('{}'::jsonb)"), "42501")));

  // --- 0006: storage politikası (current_org_id authenticated'da çalışıyor mu) ---
  await check("storage", "content-files: kendi org klasörüne yazılır, başka org klasörüne yazılamaz", async () => {
    await db.query("grant select, insert on storage.objects to authenticated");
    return as("authenticated", U.B, async () => {
      await db.query("insert into storage.objects (bucket_id, name) values ('content-files', $1)", [`${ORG1}/brief.pdf`]);
      return expectError(
        () => db.query("insert into storage.objects (bucket_id, name) values ('content-files', $1)", [`${ORG2}/x.pdf`]),
        "42501",
      );
    });
  });
}

// ---------------------------------------------------------------------
// 5) Özet
// ---------------------------------------------------------------------
await db.close();
const groups = [...new Set(results.map((r) => r.group))];
const pad = (s, n) => String(s).padEnd(n);
console.log("\n=== db-check özeti (PGlite, çevrimdışı) ===");
console.log(`${pad("Grup", 14)}${pad("Geçti", 7)}${pad("Kaldı", 7)}`);
for (const g of groups) {
  const rs = results.filter((r) => r.group === g);
  const fail = rs.filter((r) => !r.ok).length;
  console.log(`${pad(g, 14)}${pad(rs.length - fail, 7)}${pad(fail, 7)}`);
}
const failed = results.filter((r) => !r.ok);
console.log(`${pad("TOPLAM", 14)}${pad(results.length - failed.length, 7)}${pad(failed.length, 7)}`);
if (failed.length) {
  console.log("\nKalan kontroller:");
  for (const r of failed) console.log(`  - [${r.group}] ${r.name}: ${r.detail}`);
}
if (!chainOk) console.log("\nMigration zinciri durdu; yapısal ve davranış kontrolleri çalıştırılmadı.");
console.log(
  "\nNot: RLS, SET ROLE + request.jwt.claims ile gerçek Postgres'te sınandı; JWT imzası, GoTrue, PostgREST,\n" +
    "storage API ve Supabase'e özgü uzantılar sınanmadı (saplama). Süre: " + ((Date.now() - started) / 1000).toFixed(1) + " sn",
);
process.exit(failed.length || !chainOk ? 1 : 0);
