// ads-check birim testleri — ağ YOK: fetch sahte (mock) ile değiştirilir.
import test from "node:test";
import assert from "node:assert/strict";
import { parseEnv } from "./ads-env.mjs";
import {
  checkGoogle, checkMeta, explainGoogleAdsError, explainGoogleOAuthError, explainMetaError, formatGoogleId, metaStatusLabel,
} from "./ads-check.mjs";

function mockFetch(handler) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const { status = 200, body = {} } = await handler(String(url), init);
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
}

function collector() {
  const lines = [];
  return { lines, log: (line = "") => lines.push(String(line)), text: () => lines.join("\n") };
}

test("parseEnv: yorum, tırnak, export ve boş değerler", () => {
  const parsed = parseEnv('# yorum\nA=1\nexport B="iki # değil yorum"\nC=\'üç\'\nD=dört # satır sonu yorumu\nE=\n\nBOZUK SATIR');
  assert.deepEqual(parsed, { A: "1", B: "iki # değil yorum", C: "üç", D: "dört", E: "" });
});

test("parseEnv: CRLF ve BOM", () => {
  assert.deepEqual(parseEnv("﻿X=1\r\nY=2\r\n"), { X: "1", Y: "2" });
});

test("yardımcılar", () => {
  assert.equal(formatGoogleId("1234567890"), "123-456-7890");
  assert.equal(metaStatusLabel(3), "UNSETTLED (3)");
});

test("explainMetaError: süresi dolmuş / izin / limit", () => {
  assert.match(explainMetaError(400, { error: { code: 190, error_subcode: 463, message: "Error validating access token: Session has expired" } }), /süresi dolmuş/);
  assert.match(explainMetaError(400, { error: { code: 190, message: "Invalid OAuth access token" } }), /geçersiz/);
  assert.match(explainMetaError(403, { error: { code: 200, message: "Requires ads_read" } }), /ads_read/);
  assert.match(explainMetaError(400, { error: { code: 17 } }), /istek sınırı/);
});

test("explainGoogleAdsError: developer token onaysız -> Basic Access başvurusu", () => {
  const body = { error: { status: "PERMISSION_DENIED", message: "x", details: [{ errors: [{ errorCode: { authorizationError: "DEVELOPER_TOKEN_NOT_APPROVED" }, message: "not approved" }] }] } };
  assert.match(explainGoogleAdsError(403, body), /Basic Access başvurusu/);
});

test("explainGoogleAdsError: login-customer-id eksik", () => {
  const body = { error: { status: "PERMISSION_DENIED", details: [{ errors: [{ errorCode: { authorizationError: "USER_PERMISSION_DENIED" }, message: "manager's customer id must be set in the 'login-customer-id' header" }] }] } };
  assert.match(explainGoogleAdsError(403, body), /LOGIN_CUSTOMER_ID/);
});

test("explainGoogleOAuthError: invalid_grant -> 7 gün / Testing", () => {
  const message = explainGoogleOAuthError(400, { error: "invalid_grant", error_description: "Token has been expired or revoked." });
  assert.match(message, /Testing/);
  assert.match(message, /7 gün/);
});

test("checkMeta: token yok -> atlandı, ağ isteği atılmaz", async () => {
  const mock = mockFetch(() => { throw new Error("ağ çağrılmamalı"); });
  try {
    const out = collector();
    const result = await checkMeta({}, out.log);
    assert.equal(result.ok, false);
    assert.equal(result.skipped, true);
    assert.equal(mock.calls.length, 0);
  } finally { mock.restore(); }
});

test("checkMeta: UNSETTLED hesap uyarısı, ACTIVE hesapla ok; token URL'de değil başlıkta", async () => {
  const mock = mockFetch((url) => {
    assert.ok(url.includes("/v25.0/me/adaccounts"));
    return { body: { data: [
      { id: "act_1", name: "Rast", account_status: 3, currency: "TRY" },
      { id: "act_2", name: "Aytaş", account_status: 1, currency: "TRY" },
    ] } };
  });
  try {
    const out = collector();
    const result = await checkMeta({ META_ADS_ACCESS_TOKEN: "FAKE_TOKEN" }, out.log);
    assert.equal(result.ok, true);
    assert.match(out.text(), /UNSETTLED \(3\)/);
    assert.match(out.text(), /Faturalama/);
    assert.ok(!mock.calls[0].url.includes("FAKE_TOKEN"));
    assert.equal(mock.calls[0].init.headers.Authorization, "Bearer FAKE_TOKEN");
    assert.ok(!out.text().includes("FAKE_TOKEN"));
  } finally { mock.restore(); }
});

test("checkMeta: geçersiz token -> ok=false, Türkçe mesaj", async () => {
  const mock = mockFetch(() => ({ status: 400, body: { error: { code: 190, message: "Invalid OAuth access token." } } }));
  try {
    const out = collector();
    const result = await checkMeta({ META_ADS_ACCESS_TOKEN: "FAKE_TOKEN" }, out.log);
    assert.equal(result.ok, false);
    assert.match(out.text(), /Token geçersiz/);
  } finally { mock.restore(); }
});

test("checkMeta: debug_token izin kontrolü", async () => {
  const mock = mockFetch((url) => url.includes("/debug_token")
    ? { body: { data: { is_valid: true, type: "SYSTEM_USER", expires_at: 0, scopes: ["ads_read"], app_id: "1" } } }
    : { body: { data: [{ id: "act_2", name: "Aytaş", account_status: 1, currency: "TRY" }] } });
  try {
    const out = collector();
    const result = await checkMeta({ META_ADS_ACCESS_TOKEN: "T", META_APP_ID: "1", META_APP_SECRET: "S" }, out.log);
    assert.equal(result.ok, true);
    assert.match(out.text(), /süresiz/);
    assert.match(out.text(), /read_insights izni yok/);
    assert.ok(!out.text().includes("1|S"));
  } finally { mock.restore(); }
});

const GOOGLE_ENV = {
  GOOGLE_ADS_DEVELOPER_TOKEN: "dev", GOOGLE_ADS_CLIENT_ID: "id", GOOGLE_ADS_CLIENT_SECRET: "secret",
  GOOGLE_ADS_REFRESH_TOKEN: "refresh", GOOGLE_ADS_LOGIN_CUSTOMER_ID: "123-456-7890",
};

test("checkGoogle: eksik login customer id adıyla bildirilir", async () => {
  const mock = mockFetch(() => { throw new Error("ağ çağrılmamalı"); });
  try {
    const out = collector();
    const result = await checkGoogle({ ...GOOGLE_ENV, GOOGLE_ADS_LOGIN_CUSTOMER_ID: "" }, out.log);
    assert.equal(result.ok, false);
    assert.match(out.text(), /GOOGLE_ADS_LOGIN_CUSTOMER_ID/);
    assert.equal(mock.calls.length, 0);
  } finally { mock.restore(); }
});

test("checkGoogle: başarılı akış (OAuth + listAccessibleCustomers + customer_client)", async () => {
  const mock = mockFetch((url, init) => {
    if (url.includes("oauth2.googleapis.com")) return { body: { access_token: "ACCESS" } };
    if (url.includes("listAccessibleCustomers")) return { body: { resourceNames: ["customers/1234567890"] } };
    assert.equal(init.headers["login-customer-id"], "1234567890");
    return { body: [{ results: [
      { customerClient: { clientCustomer: "customers/1234567890", descriptiveName: "MCC", manager: true, status: "ENABLED" } },
      { customerClient: { clientCustomer: "customers/1112223334", descriptiveName: "Rast", status: "ENABLED" } },
    ] }] };
  });
  try {
    const out = collector();
    const result = await checkGoogle(GOOGLE_ENV, out.log);
    assert.equal(result.ok, true);
    assert.match(out.text(), /111-222-3334/);
    assert.ok(!out.text().includes("ACCESS"));
  } finally { mock.restore(); }
});

test("checkGoogle: invalid_grant -> ok=false, 7 gün uyarısı", async () => {
  const mock = mockFetch(() => ({ status: 400, body: { error: "invalid_grant" } }));
  try {
    const out = collector();
    const result = await checkGoogle(GOOGLE_ENV, out.log);
    assert.equal(result.ok, false);
    assert.match(out.text(), /7 gün/);
  } finally { mock.restore(); }
});

test("checkGoogle: developer token onaysız -> Basic Access", async () => {
  const mock = mockFetch((url) => url.includes("oauth2.googleapis.com")
    ? { body: { access_token: "A" } }
    : { status: 403, body: { error: { status: "PERMISSION_DENIED", details: [{ errors: [{ errorCode: { authorizationError: "DEVELOPER_TOKEN_NOT_APPROVED" } }] }] } } });
  try {
    const out = collector();
    const result = await checkGoogle(GOOGLE_ENV, out.log);
    assert.equal(result.ok, false);
    assert.match(out.text(), /Basic Access başvurusu/);
  } finally { mock.restore(); }
});
