#!/usr/bin/env node
// =====================================================================
// ads-check — Google Ads / Meta Ads bağlantı kontrolü
//
//   npm run ads:check                  (ikisi birden)
//   node scripts/ads-check.mjs --meta
//   node scripts/ads-check.mjs --google
//
// .env.local dosyasını okur (yeni bağımlılık yok; zaten tanımlı ortam
// değişkenleri ezilmez). Yalnızca OKUMA isteği atar: hesap listesi ve token
// bilgisi. Hiçbir sır ekrana yazılmaz.
//
// Çıkış kodu: 0 = kontrol edilen her sağlayıcı çalışıyor, 1 = hata.
// Bayraksız çalıştırmada ayarı hiç yapılmamış sağlayıcı "atlandı" sayılır
// (ikisi de ayarsızsa hata); --meta / --google ile ayar eksikse hata verir.
// =====================================================================

import { pathToFileURL } from "node:url";
import { loadEnvLocal } from "./ads-env.mjs";

const TIMEOUT_MS = 20_000;

// ---------------------------------------------------------------------
// Yardımcılar
// ---------------------------------------------------------------------

export const META_STATUS = {
  1: "ACTIVE",
  2: "DISABLED",
  3: "UNSETTLED",
  7: "PENDING_RISK_REVIEW",
  8: "PENDING_SETTLEMENT",
  9: "IN_GRACE_PERIOD",
  100: "PENDING_CLOSURE",
  101: "CLOSED",
  201: "ANY_ACTIVE",
  202: "ANY_CLOSED",
};

export function metaStatusLabel(code) {
  return META_STATUS[code] ? `${META_STATUS[code]} (${code})` : `bilinmiyor (${code ?? "-"})`;
}

export function formatGoogleId(id) {
  const digits = String(id).replace(/\D/g, "");
  return digits.length === 10 ? `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}` : digits;
}

function table(headers, rows) {
  const widths = headers.map((header, index) => Math.max(header.length, ...rows.map((row) => String(row[index] ?? "").length)));
  const line = (cells) => "  " + cells.map((cell, index) => String(cell ?? "").padEnd(widths[index])).join("  ").trimEnd();
  return [line(headers), line(widths.map((width) => "-".repeat(width))), ...rows.map(line)].join("\n");
}

async function request(url, init = {}) {
  try {
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
    const text = await response.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text.slice(0, 300) }; }
    return { ok: response.ok, status: response.status, body };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { ok: false, status: 0, body: null, networkError: reason };
  }
}

function networkMessage(reason) {
  return `Ağa bağlanılamadı (${reason}). İnternet bağlantınızı / güvenlik duvarını kontrol edin.`;
}

// ---------------------------------------------------------------------
// Meta
// ---------------------------------------------------------------------

/** Meta Graph API hata gövdesini Türkçe, eyleme dönük bir mesaja çevirir. */
export function explainMetaError(status, body) {
  const error = body?.error ?? {};
  const code = Number(error.code);
  const subcode = Number(error.error_subcode);
  const apiMessage = error.message ? ` (Meta: ${String(error.message).slice(0, 200)})` : "";
  if (code === 190) {
    if (subcode === 463 || /expired/i.test(error.message ?? "")) {
      return `Token'ın süresi dolmuş. Business Settings → Users → System users → "Rast OS" → Generate token ile "Never" (süresiz) seçerek yeni token üretin.${apiMessage}`;
    }
    if (/malformed|parse/i.test(error.message ?? "")) {
      return `Token biçimi hatalı. META_ADS_ACCESS_TOKEN değerinde boşluk, satır sonu veya tırnak kalmış olabilir; tokenı yeniden, olduğu gibi yapıştırın.${apiMessage}`;
    }
    return `Token geçersiz (iptal edilmiş, şifre değişmiş ya da yanlış kopyalanmış). Sistem kullanıcısı için yeni token üretin.${apiMessage}`;
  }
  if (code === 200 || code === 10 || (code >= 200 && code < 300)) {
    return `İzin yetersiz. Token'a ads_read / read_insights izinlerini verin ve sistem kullanıcısına reklam hesaplarını "Add assets" ile atayın.${apiMessage}`;
  }
  if ([4, 17, 32, 613, 80000, 80003, 80004].includes(code)) {
    return `Meta istek sınırına takıldı. Birkaç dakika bekleyip yeniden deneyin.${apiMessage}`;
  }
  if (code === 100) {
    return `Geçersiz istek parametresi. META_ADS_API_VERSION desteklenmeyen bir sürüm olabilir (varsayılan v25.0).${apiMessage}`;
  }
  if (code === 1 || code === 2 || status >= 500) {
    return `Meta tarafında geçici bir hata var. Biraz sonra yeniden deneyin.${apiMessage}`;
  }
  return `Meta beklenmeyen bir yanıt verdi (HTTP ${status}).${apiMessage}`;
}

export async function checkMeta(env = process.env, log = console.log) {
  log("\n== Meta Ads ==");
  const token = (env.META_ADS_ACCESS_TOKEN ?? "").trim();
  if (!token) {
    log("  EKSİK: META_ADS_ACCESS_TOKEN tanımlı değil.");
    log("  Çözüm: docs/ads-baglanti.md → \"Meta Ads\" bölümü (sistem kullanıcısı token'ı).");
    return { ok: false, skipped: true };
  }
  const version = (env.META_ADS_API_VERSION || "v25.0").trim();
  const base = `https://graph.facebook.com/${version}`;
  let ok = true;

  const accountsUrl = `${base}/me/adaccounts?fields=id,name,account_status,currency&limit=50`;
  const rows = [];
  let next = accountsUrl;
  for (let page = 0; next && page < 3; page += 1) {
    const result = await request(next, { headers: { Authorization: `Bearer ${token}` } });
    if (result.networkError) { log(`  HATA: ${networkMessage(result.networkError)}`); return { ok: false }; }
    if (!result.ok) { log(`  HATA: ${explainMetaError(result.status, result.body)}`); return { ok: false }; }
    rows.push(...(result.body?.data ?? []));
    next = result.body?.paging?.next;
  }

  if (!rows.length) {
    log("  HATA: Token geçerli ama erişebildiği hiç reklam hesabı yok.");
    log("  Çözüm: Business Settings → Users → System users → \"Rast OS\" → Add assets → Ad accounts → \"View performance\".");
    ok = false;
  } else {
    log(`  Token çalışıyor. ${rows.length} reklam hesabı görünüyor:\n`);
    log(table(["ID", "Ad", "Durum", "Para birimi"], rows.map((row) => [
      row.id, row.name ?? "-", metaStatusLabel(row.account_status), row.currency ?? "-",
    ])));
    const inactive = rows.filter((row) => row.account_status !== 1);
    if (inactive.length === rows.length) {
      log("\n  UYARI: Hiçbir hesap ACTIVE (1) değil. Rast OS yalnızca ACTIVE hesapları listeler; /ads sayfası boş kalır.");
      ok = false;
    }
    for (const row of inactive) {
      const hint = row.account_status === 3
        ? "ödenmemiş bakiye: Ads Manager → Faturalama'dan ödeme yapın"
        : "Ads Manager'da hesap durumunu kontrol edin";
      log(`  UYARI: ${row.id} (${row.name ?? "-"}) ${META_STATUS[row.account_status] ?? row.account_status} — Rast OS bu hesabı göstermez; ${hint}.`);
    }
  }

  // İsteğe bağlı: debug_token
  const appId = (env.META_APP_ID ?? "").trim();
  const appSecret = (env.META_APP_SECRET ?? "").trim();
  if (appId && appSecret) {
    const debugUrl = `${base}/debug_token?input_token=${encodeURIComponent(token)}&access_token=${encodeURIComponent(`${appId}|${appSecret}`)}`;
    const result = await request(debugUrl);
    const data = result.body?.data;
    if (!result.ok || !data) {
      log(`\n  Token ayrıntısı alınamadı: ${result.networkError ? networkMessage(result.networkError) : explainMetaError(result.status, result.body)}`);
    } else {
      log("\n  Token ayrıntısı (debug_token):");
      log(`    geçerli       : ${data.is_valid ? "evet" : "HAYIR"}`);
      log(`    tür           : ${data.type ?? "-"}`);
      log(`    uygulama      : ${data.application ?? "-"} (${data.app_id ?? "-"})`);
      const expires = Number(data.expires_at || 0);
      log(`    son kullanma  : ${expires ? new Date(expires * 1000).toLocaleString("tr-TR") : "süresiz"}`);
      const dataAccess = Number(data.data_access_expires_at || 0);
      if (dataAccess) log(`    veri erişimi  : ${new Date(dataAccess * 1000).toLocaleString("tr-TR")} tarihine kadar`);
      const scopes = data.scopes ?? [];
      log(`    izinler       : ${scopes.length ? scopes.join(", ") : "-"}`);
      if (!data.is_valid) { log("    UYARI: Token geçersiz görünüyor — yeni token üretin."); ok = false; }
      if (scopes.length && !scopes.includes("ads_read")) { log("    UYARI: ads_read izni yok — token'ı bu izinle yeniden üretin."); ok = false; }
      if (scopes.length && !scopes.includes("read_insights")) log("    UYARI: read_insights izni yok — performans metrikleri boş gelebilir.");
      if (expires && expires * 1000 - Date.now() < 7 * 86_400_000) log("    UYARI: Token 7 günden kısa sürede bitecek; \"Never\" (süresiz) seçeneğiyle yenileyin.");
    }
  } else {
    log("\n  (İsteğe bağlı) Token ayrıntısı için .env.local içine META_APP_ID ve META_APP_SECRET ekleyin.");
  }

  log(ok ? "\n  SONUÇ: Meta Ads bağlantısı HAZIR." : "\n  SONUÇ: Meta Ads bağlantısında SORUN var.");
  return { ok };
}

// ---------------------------------------------------------------------
// Google Ads
// ---------------------------------------------------------------------

export const GOOGLE_REQUIRED = [
  "GOOGLE_ADS_DEVELOPER_TOKEN",
  "GOOGLE_ADS_CLIENT_ID",
  "GOOGLE_ADS_CLIENT_SECRET",
  "GOOGLE_ADS_REFRESH_TOKEN",
  "GOOGLE_ADS_LOGIN_CUSTOMER_ID",
];

/** OAuth token uç noktasının hata gövdesini Türkçe mesaja çevirir. */
export function explainGoogleOAuthError(status, body) {
  const code = body?.error;
  const description = body?.error_description ? ` (Google: ${String(body.error_description).slice(0, 160)})` : "";
  if (code === "invalid_grant") {
    return "Refresh token geçersiz, iptal edilmiş veya süresi dolmuş. En sık neden: OAuth onay ekranı \"Testing\" durumunda — bu modda refresh token 7 günde biter. "
      + `Google Cloud → APIs & Services → OAuth consent screen → "Publish app" ile "In production" yapın, sonra "node scripts/google-ads-oauth.mjs" ile yeni refresh token alın.${description}`;
  }
  if (code === "invalid_client") {
    return `OAuth istemci kimliği/sırrı hatalı. GOOGLE_ADS_CLIENT_ID ve GOOGLE_ADS_CLIENT_SECRET değerlerini Google Cloud → Credentials → OAuth client'tan yeniden kopyalayın.${description}`;
  }
  if (code === "unauthorized_client") {
    return `Bu OAuth istemcisi, refresh token'ı üreten istemciyle aynı değil. Refresh token'ı bu CLIENT_ID ile yeniden üretin.${description}`;
  }
  return `Google OAuth beklenmeyen bir yanıt verdi (HTTP ${status}).${description}`;
}

function collectGoogleErrors(body) {
  const error = body?.error ?? {};
  const codes = [];
  const messages = [];
  for (const detail of error.details ?? []) {
    for (const item of detail.errors ?? []) {
      for (const value of Object.values(item.errorCode ?? {})) codes.push(String(value));
      if (item.message) messages.push(String(item.message));
    }
    if (detail.reason) codes.push(String(detail.reason));
  }
  return { codes, messages, status: error.status, message: error.message ?? "" };
}

/** Google Ads API hata gövdesini Türkçe, eyleme dönük bir mesaja çevirir. */
export function explainGoogleAdsError(status, body) {
  const { codes, messages, status: apiStatus, message } = collectGoogleErrors(body);
  const all = `${codes.join(" ")} ${messages.join(" ")} ${message}`;
  const apiMessage = (messages[0] || message) ? ` (Google: ${String(messages[0] || message).slice(0, 200)})` : "";
  if (codes.includes("DEVELOPER_TOKEN_NOT_APPROVED")) {
    return `Geliştirici token'ı henüz onaylanmamış; yalnızca test hesaplarında çalışır. Google Ads (yönetici hesabı) → Araçlar → API Merkezi'nden "Basic Access başvurusu" yapın; onay birkaç gün sürebilir.${apiMessage}`;
  }
  if (/DEVELOPER_TOKEN_PROHIBITED/.test(all)) {
    return `Geliştirici token'ı bu Google Cloud projesinden / alan adından kullanılamıyor. API Merkezi'nde token durumunu kontrol edin.${apiMessage}`;
  }
  if (/DEVELOPER_TOKEN/.test(all)) {
    return `Geliştirici token'ı geçersiz veya eksik. GOOGLE_ADS_DEVELOPER_TOKEN değerini API Merkezi'nden yeniden kopyalayın.${apiMessage}`;
  }
  if (/SERVICE_DISABLED|has not been used in project|is disabled/i.test(all)) {
    return `Google Cloud projesinde "Google Ads API" etkin değil. Google Cloud → APIs & Services → Library → "Google Ads API" → Enable.${apiMessage}`;
  }
  if (/login-customer-id/i.test(all) || codes.includes("USER_PERMISSION_DENIED")) {
    return `Erişim reddedildi: GOOGLE_ADS_LOGIN_CUSTOMER_ID eksik/yanlış olabilir. Hesaplar bir yönetici (MCC) hesabı altındaysa onun 10 haneli numarasını, değilse hesabın kendi numarasını yazın (tire olmadan). OAuth ile giriş yapan Google kullanıcısının bu hesaba erişimi de olmalı.${apiMessage}`;
  }
  if (/OAUTH_TOKEN|AUTHENTICATION_ERROR|UNAUTHENTICATED/.test(all) || status === 401) {
    return `Kimlik doğrulama başarısız. Refresh token geçersiz olabilir (OAuth onay ekranı "Testing" ise 7 günde biter); yeni refresh token alın.${apiMessage}`;
  }
  if (/CUSTOMER_NOT_ENABLED|NOT_ADS_USER|CUSTOMER_NOT_FOUND/.test(all)) {
    return `Bu Google hesabının Google Ads erişimi yok ya da müşteri hesabı etkin değil. Doğru Google hesabıyla yetkilendirdiğinizden emin olun.${apiMessage}`;
  }
  if (status === 404 || apiStatus === "NOT_FOUND") {
    return `Uç nokta bulunamadı: GOOGLE_ADS_API_VERSION desteklenmiyor olabilir (varsayılan v25). Google'ın güncel sürüm listesine bakın.${apiMessage}`;
  }
  if (status === 429) return `Google Ads istek sınırına takıldı. Biraz sonra yeniden deneyin.${apiMessage}`;
  return `Google Ads beklenmeyen bir yanıt verdi (HTTP ${status}${apiStatus ? `, ${apiStatus}` : ""}).${apiMessage}`;
}

export async function checkGoogle(env = process.env, log = console.log) {
  log("\n== Google Ads ==");
  const missing = GOOGLE_REQUIRED.filter((key) => !(env[key] ?? "").trim());
  if (missing.length === GOOGLE_REQUIRED.length) {
    log("  EKSİK: Google Ads değişkenlerinin hiçbiri tanımlı değil.");
    log("  Çözüm: docs/ads-baglanti.md → \"Google Ads\" bölümü.");
    return { ok: false, skipped: true };
  }
  if (missing.length) {
    log(`  EKSİK değişkenler: ${missing.join(", ")}`);
    if (missing.includes("GOOGLE_ADS_LOGIN_CUSTOMER_ID")) {
      log("  GOOGLE_ADS_LOGIN_CUSTOMER_ID: hesaplar yönetici (MCC) hesabı altındaysa MCC numarası, değilse hesabın kendi numarası (10 hane, tiresiz).");
    }
    if (missing.includes("GOOGLE_ADS_REFRESH_TOKEN")) log("  GOOGLE_ADS_REFRESH_TOKEN: \"node scripts/google-ads-oauth.mjs\" ile üretin.");
    if (missing.includes("GOOGLE_ADS_DEVELOPER_TOKEN")) log("  GOOGLE_ADS_DEVELOPER_TOKEN: Google Ads → Araçlar → API Merkezi.");
    return { ok: false };
  }
  const developerToken = env.GOOGLE_ADS_DEVELOPER_TOKEN.trim();
  const loginId = env.GOOGLE_ADS_LOGIN_CUSTOMER_ID.replace(/\D/g, "");
  const version = (env.GOOGLE_ADS_API_VERSION || "v25").trim();
  let ok = true;
  if (loginId.length !== 10) {
    log(`  UYARI: GOOGLE_ADS_LOGIN_CUSTOMER_ID 10 haneli olmalı (şu an ${loginId.length} hane).`);
  }

  // 1) OAuth: refresh token -> access token
  const oauth = await request("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_ADS_CLIENT_ID.trim(),
      client_secret: env.GOOGLE_ADS_CLIENT_SECRET.trim(),
      refresh_token: env.GOOGLE_ADS_REFRESH_TOKEN.trim(),
      grant_type: "refresh_token",
    }),
  });
  if (oauth.networkError) { log(`  HATA: ${networkMessage(oauth.networkError)}`); return { ok: false }; }
  if (!oauth.ok || !oauth.body?.access_token) {
    log(`  HATA (OAuth): ${explainGoogleOAuthError(oauth.status, oauth.body)}`);
    return { ok: false };
  }
  log("  OAuth: refresh token geçerli, erişim anahtarı alındı.");
  const headers = { Authorization: `Bearer ${oauth.body.access_token}`, "developer-token": developerToken };

  // 2) Doğrudan erişilebilir müşteri hesapları
  const listed = await request(`https://googleads.googleapis.com/${version}/customers:listAccessibleCustomers`, { headers });
  if (listed.networkError) { log(`  HATA: ${networkMessage(listed.networkError)}`); return { ok: false }; }
  if (!listed.ok) { log(`  HATA (listAccessibleCustomers): ${explainGoogleAdsError(listed.status, listed.body)}`); return { ok: false }; }
  const accessible = (listed.body?.resourceNames ?? []).map((name) => String(name).replace("customers/", ""));
  if (!accessible.length) {
    log("  HATA: Bu Google kullanıcısının doğrudan erişebildiği Google Ads hesabı yok. Doğru Google hesabıyla yetkilendirdiniz mi?");
    return { ok: false };
  }
  log(`\n  Doğrudan erişilebilir hesaplar (${accessible.length}):`);
  log(table(["Müşteri ID"], accessible.map((id) => [formatGoogleId(id)])));
  if (loginId && !accessible.includes(loginId)) {
    log(`\n  UYARI: GOOGLE_ADS_LOGIN_CUSTOMER_ID (${formatGoogleId(loginId)}) erişilebilir hesaplar arasında değil. Yönetici (MCC) hesap numarasını kontrol edin.`);
  }

  // 3) Login customer id ile Rast OS'un yaptığı sorgu (customer_client)
  const query = "SELECT customer_client.client_customer, customer_client.descriptive_name, customer_client.manager, customer_client.status, customer_client.level FROM customer_client";
  const clients = await request(`https://googleads.googleapis.com/${version}/customers/${loginId}/googleAds:searchStream`, {
    method: "POST",
    headers: { ...headers, "login-customer-id": loginId, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  if (clients.networkError) { log(`  HATA: ${networkMessage(clients.networkError)}`); return { ok: false }; }
  if (!clients.ok) {
    log(`\n  HATA (hesap sorgusu, login-customer-id ${formatGoogleId(loginId)}): ${explainGoogleAdsError(clients.status, clients.body)}`);
    return { ok: false };
  }
  const found = (Array.isArray(clients.body) ? clients.body : []).flatMap((chunk) => chunk.results ?? []).map((row) => row.customerClient).filter(Boolean);
  const usable = found.filter((client) => !client.manager && client.status === "ENABLED");
  log(`\n  ${formatGoogleId(loginId)} altındaki hesaplar:`);
  log(table(["Müşteri ID", "Ad", "Tür", "Durum"], found.map((client) => [
    formatGoogleId(String(client.clientCustomer ?? "").replace("customers/", "")),
    client.descriptiveName ?? "-",
    client.manager ? "Yönetici (MCC)" : "Reklam hesabı",
    client.status ?? "-",
  ])));
  if (!usable.length) {
    log("\n  UYARI: ENABLED durumda, yönetici olmayan reklam hesabı bulunamadı; Rast OS /ads sayfasında hesap göstermez.");
    ok = false;
  }
  log(ok ? "\n  SONUÇ: Google Ads bağlantısı HAZIR." : "\n  SONUÇ: Google Ads bağlantısında SORUN var.");
  return { ok };
}

// ---------------------------------------------------------------------
// Giriş noktası
// ---------------------------------------------------------------------

export async function main(argv = process.argv.slice(2)) {
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log("Kullanım: node scripts/ads-check.mjs [--meta] [--google]\n  Bayraksız: ikisini de kontrol eder.");
    return 0;
  }
  const wantMeta = argv.includes("--meta");
  const wantGoogle = argv.includes("--google");
  const explicit = wantMeta || wantGoogle;
  const env = loadEnvLocal();
  console.log(env.loaded ? "Ayarlar .env.local dosyasından okundu (sırlar yazdırılmaz)." : "UYARI: .env.local bulunamadı; yalnızca ortam değişkenleri kullanılıyor.");

  const results = [];
  if (!explicit || wantMeta) results.push({ name: "Meta", ...(await checkMeta()) });
  if (!explicit || wantGoogle) results.push({ name: "Google", ...(await checkGoogle()) });

  const failed = results.filter((result) => !result.ok && (explicit || !result.skipped));
  const passed = results.filter((result) => result.ok);
  console.log("\n== Özet ==");
  for (const result of results) {
    console.log(`  ${result.name.padEnd(7)}: ${result.ok ? "HAZIR" : result.skipped && !explicit ? "atlandı (ayarlanmamış)" : "SORUN"}`);
  }
  if (failed.length || !passed.length) {
    console.log("\nAyrıntılı kurulum adımları: docs/ads-baglanti.md");
    return 1;
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((code) => { process.exitCode = code; }).catch((error) => {
    console.error("Beklenmeyen hata:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
