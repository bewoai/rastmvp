#!/usr/bin/env node
// =====================================================================
// google-ads-oauth — Google Ads için TEK SEFERLİK refresh token üretici
//
//   node scripts/google-ads-oauth.mjs
//
// GOOGLE_ADS_CLIENT_ID / GOOGLE_ADS_CLIENT_SECRET değerlerini .env.local'dan
// (ya da ortam değişkenlerinden) okur. Yerel bir döngü (loopback) sunucusu
// açar: http://127.0.0.1:53682 — yalnızca bu makineden erişilebilir.
// Tarayıcıda Google ile giriş yapıp izin verirsiniz; refresh token ekrana
// BİR KEZ yazılır. Hiçbir yere kaydedilmez, dosyaya yazılmaz.
//
// Ön koşul: Google Cloud → Credentials → "OAuth client ID" → Uygulama türü
// "Desktop app". (Desktop istemcilerde 127.0.0.1 yönlendirmesi için ayrıca
// redirect URI eklemek gerekmez.)
// =====================================================================

import { createServer } from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { loadEnvLocal } from "./ads-env.mjs";

const PORT = 53682;
const HOST = "127.0.0.1";
const REDIRECT_URI = `http://${HOST}:${PORT}`;
const SCOPE = "https://www.googleapis.com/auth/adwords";
const TIMEOUT_MS = 5 * 60_000;

const base64url = (buffer) => buffer.toString("base64url");
const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);

function page(title, message) {
  return `<!doctype html><meta charset="utf-8"><title>${escapeHtml(title)}</title>`
    + `<body style="font:16px system-ui;max-width:520px;margin:15vh auto;padding:0 16px"><h2>${escapeHtml(title)}</h2><p>${escapeHtml(message)}</p></body>`;
}

async function main() {
  loadEnvLocal();
  const clientId = (process.env.GOOGLE_ADS_CLIENT_ID ?? "").trim();
  const clientSecret = (process.env.GOOGLE_ADS_CLIENT_SECRET ?? "").trim();
  if (!clientId || !clientSecret) {
    console.error("HATA: GOOGLE_ADS_CLIENT_ID ve GOOGLE_ADS_CLIENT_SECRET gerekli (.env.local içine yazın).");
    console.error("Kurulum: docs/ads-baglanti.md → Google Ads → OAuth istemcisi (Desktop app).");
    return 1;
  }

  const state = base64url(randomBytes(16));
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    scope: SCOPE,
    access_type: "offline",
    prompt: "consent", // refresh token'ın her seferinde dönmesi için
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  }).toString();

  const code = await new Promise((resolve, reject) => {
    const server = createServer((request, response) => {
      const url = new URL(request.url ?? "/", REDIRECT_URI);
      if (url.pathname !== "/") { response.writeHead(404).end(); return; }
      const error = url.searchParams.get("error");
      const received = url.searchParams.get("code");
      const html = (status, title, message) => {
        response.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
        response.end(page(title, message));
      };
      if (url.searchParams.get("state") !== state) {
        html(400, "Geçersiz istek", "State uyuşmadı; bu pencereyi kapatıp komutu yeniden çalıştırın.");
        return; // başka bir istek gelirse beklemeye devam et
      }
      if (error) {
        html(400, "İzin verilmedi", `Google şu hatayı döndürdü: ${error}`);
        clearTimeout(timer); server.close(); reject(new Error(`Google yetkilendirmeyi reddetti: ${error}`));
        return;
      }
      if (!received) { html(400, "Kod yok", "Yetkilendirme kodu gelmedi."); return; }
      html(200, "Tamamlandı", "Bu pencereyi kapatıp terminale dönebilirsiniz.");
      clearTimeout(timer); server.close(); resolve(received);
    });
    const timer = setTimeout(() => { server.close(); reject(new Error("Zaman aşımı (5 dk). Komutu yeniden çalıştırın.")); }, TIMEOUT_MS);
    server.on("error", (err) => {
      clearTimeout(timer);
      reject(new Error(err.code === "EADDRINUSE" ? `${PORT} portu kullanımda. Önceki çalıştırmayı kapatın.` : err.message));
    });
    server.listen(PORT, HOST, () => {
      console.log("1) Aşağıdaki adresi tarayıcıda açın (Google Ads hesaplarına erişimi olan Google hesabıyla giriş yapın):\n");
      console.log(authUrl.toString());
      console.log(`\n2) İzin verin. Bu pencere ${REDIRECT_URI} üzerinde bekliyor (5 dk)...`);
    });
  }).catch((error) => { console.error(`\nHATA: ${error.message}`); return null; });
  if (!code) return 1;

  let response;
  try {
    response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: REDIRECT_URI,
        grant_type: "authorization_code",
        code_verifier: verifier,
      }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (error) {
    console.error(`\nHATA: Google'a ulaşılamadı (${error instanceof Error ? error.message : error}).`);
    return 1;
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.refresh_token) {
    const reason = body.error ? `${body.error}${body.error_description ? ` — ${body.error_description}` : ""}` : `HTTP ${response.status}`;
    console.error(`\nHATA: Refresh token alınamadı (${reason}).`);
    if (response.ok) console.error("Google refresh token döndürmedi: https://myaccount.google.com/permissions adresinden uygulamanın erişimini kaldırıp yeniden deneyin.");
    if (body.error === "invalid_client") console.error("CLIENT_ID/SECRET hatalı ya da OAuth istemcisi 'Desktop app' türünde değil.");
    return 1;
  }

  console.log("\nBAŞARILI. Aşağıdaki değeri .env.local içine (ve Vercel'e) yazın; bir daha gösterilmeyecek, hiçbir yere kaydedilmedi:\n");
  console.log(`GOOGLE_ADS_REFRESH_TOKEN=${body.refresh_token}`);
  console.log("\nNOT: OAuth onay ekranı \"Testing\" durumundaysa bu token 7 günde geçersiz olur.");
  console.log("Google Cloud → OAuth consent screen → \"Publish app\" (In production) yapın; sonra \"npm run ads:check -- --google\".");
  return 0;
}

main().then((code) => { process.exitCode = code; }).catch((error) => {
  console.error("Beklenmeyen hata:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
