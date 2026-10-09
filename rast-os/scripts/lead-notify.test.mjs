// Lead bildirimi testleri — çalıştırma: npm test  (Node test runner + type stripping). Ağ erişimi YOK: gönderici hep sahte.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_LEADS_URL, LEAD_NOTIFY_TIMEOUT_MS, MAX_RECIPIENTS, NOTIFY_MESSAGE_MAX, buildLeadNotification, cleanHeader, escapeHtml,
  leadNotifyConfig, leadsUrlFromEnv, parseRecipients, sendLeadNotification, truncate,
} from "../src/lib/lead-notify.ts";
import { normalizeLeadPayload } from "../src/lib/lead-logic.ts";
import { smtpConfigFromEnv } from "../src/lib/growth/mailer.ts";
import { smtpConfigFromEnv as sharedSmtpConfigFromEnv } from "../src/lib/mailer.ts";

const lead = {
  name: "Ayşe Kaya", company: "Kaya Klinik", phone: "0532 111 22 33", email: "ayse@kaya.com", project_type: "Hekim İçerik Sistemi",
  message: "Merhaba, fiyat almak istiyorum.", kaynak: "hekim", paket: "standart", utm: { utm_source: "ig", utm_campaign: "bahar" },
};
const SMTP = { SMTP_HOST: "smtp.zoho.eu", SMTP_PORT: "465", SMTP_USER: "bildirim@rastcreative.com", SMTP_PASS: "x-test-pass", SMTP_FROM: "Rast OS <bildirim@rastcreative.com>" };
const ENV = { ...SMTP, LEAD_NOTIFY_TO: "a@rastcreative.com, b@rastcreative.com" };

/** console.error'u yakalar (test sonunda geri koyar). */
async function captureErrors(fn) {
  const orig = console.error;
  const lines = [];
  console.error = (...args) => lines.push(args.map(String).join(" "));
  try {
    return { result: await fn(), lines };
  } finally {
    console.error = orig;
  }
}

/* ---------------- Alıcı listesi ---------------- */

test("parseRecipients: virgül/noktalı virgül/boşluk, tekrar ve geçersizleri ayıklar", () => {
  const r = parseRecipients(" a@x.com ,b@y.org;a@X.com\n c@z.net , yok , @x.com, d@e ");
  assert.deepEqual(r.to, ["a@x.com", "b@y.org", "c@z.net"]);
  assert.equal(r.invalid, 3); // "yok", "@x.com", "d@e"
  assert.deepEqual(parseRecipients("").to, []);
  assert.deepEqual(parseRecipients(undefined).to, []);
  assert.deepEqual(parseRecipients(null).to, []);
});

test("parseRecipients: başlık/adres enjeksiyonu denemeleri alıcı olmaz; üst sınır uygulanır", () => {
  for (const bad of ["a@x.com\r\nBcc:evil@x.com", "\"a b\"@x.com", "Ad <a@x.com>", "a@x.com>,b", "a@x.com;"]) {
    const { to } = parseRecipients(bad);
    for (const addr of to) assert.match(addr, /^[^\s<>",;]+@[^\s<>",;]+$/);
  }
  assert.deepEqual(parseRecipients("Ad <a@x.com>").to, []); // "Ad", "<a@x.com>" → ikisi de geçersiz
  assert.equal(parseRecipients("a@x.com\r\nBcc:evil@x.com").to.length, 1); // CRLF ayraçtır; "Bcc:evil@x.com" ':' yüzünden geçersiz
  assert.deepEqual(parseRecipients("a@x.com\r\nBcc:evil@x.com").to, ["a@x.com"]);
  const many = Array.from({ length: 25 }, (_, i) => `u${i}@x.com`).join(",");
  assert.equal(parseRecipients(many).to.length, MAX_RECIPIENTS);
});

/* ---------------- Yapılandırma / no-op ---------------- */

test("leadNotifyConfig: LEAD_NOTIFY_TO ve SMTP_* ikisi de gerekli; OUTREACH_EMAIL_ENABLED ile ilgisi yok", () => {
  assert.equal(leadNotifyConfig({}), null);
  assert.equal(leadNotifyConfig({ LEAD_NOTIFY_TO: "a@x.com" }), null); // SMTP yok
  assert.equal(leadNotifyConfig(SMTP), null); // alıcı yok
  assert.equal(leadNotifyConfig({ ...SMTP, LEAD_NOTIFY_TO: "yok" }), null); // geçerli alıcı yok
  assert.equal(leadNotifyConfig({ ...SMTP, SMTP_PASS: "", LEAD_NOTIFY_TO: "a@x.com" }), null); // eksik SMTP
  const cfg = leadNotifyConfig(ENV); // OUTREACH_EMAIL_ENABLED tanımsız
  assert.deepEqual(cfg?.to, ["a@rastcreative.com", "b@rastcreative.com"]);
  assert.equal(cfg?.smtp.host, "smtp.zoho.eu");
  assert.equal(leadNotifyConfig({ ...ENV, OUTREACH_EMAIL_ENABLED: "false" })?.to.length, 2); // bayrak kapalı olsa da çalışır
});

test("sendLeadNotification: env yokken sessiz no-op (gönderici çağrılmaz, log yazılmaz)", async () => {
  let called = 0;
  const send = async () => { called++; };
  const { result, lines } = await captureErrors(() => sendLeadNotification(lead, { env: {}, send }));
  assert.equal(result, "skipped");
  assert.equal(called, 0);
  assert.deepEqual(lines, []);
  assert.equal(await sendLeadNotification(lead, { env: { LEAD_NOTIFY_TO: "a@x.com" }, send }), "skipped");
  assert.equal(await sendLeadNotification(lead, { env: SMTP, send }), "skipped");
  assert.equal(called, 0);
});

test("sendLeadNotification: yapılandırılmışken göndericiyi doğru e-postayla çağırır", async () => {
  const sent = [];
  const send = async (mail, smtp, signal) => { sent.push({ mail, smtp, aborted: signal.aborted }); };
  const r = await sendLeadNotification(lead, { env: { ...ENV, APP_BASE_URL: "https://app.example.com/" }, send, duplicate: false });
  assert.equal(r, "sent");
  assert.equal(sent.length, 1);
  const { mail, smtp, aborted } = sent[0];
  assert.deepEqual(mail.to, ["a@rastcreative.com", "b@rastcreative.com"]);
  assert.equal(mail.from, "Rast OS <bildirim@rastcreative.com>");
  assert.equal(mail.subject, "Yeni lead: Ayşe Kaya (Hekim sistemi (web sitesi))");
  assert.ok(mail.text.includes("https://app.example.com/crm/leads"));
  assert.equal(smtp.port, 465);
  assert.equal(aborted, false);
});

test("sendLeadNotification: geçersiz alıcı sayısı loglanır ama adres loglanmaz", async () => {
  const { result, lines } = await captureErrors(() =>
    sendLeadNotification(lead, { env: { ...SMTP, LEAD_NOTIFY_TO: "a@x.com, bozuk-adres" }, send: async () => {} }),
  );
  assert.equal(result, "sent");
  assert.equal(lines.length, 1);
  assert.ok(lines[0].includes("1 geçersiz"));
  assert.ok(!lines[0].includes("bozuk-adres"));
});

/* ---------------- Hata / zaman aşımı ---------------- */

test("sendLeadNotification: gönderici hata verirse fırlatmaz; log kişisel veri içermez", async () => {
  const send = async () => {
    const e = new Error(`550 mailbox ${lead.email} ${lead.phone} ${lead.name} unavailable`);
    e.code = "EAUTH";
    throw e;
  };
  const { result, lines } = await captureErrors(() => sendLeadNotification(lead, { env: ENV, send }));
  assert.equal(result, "failed");
  assert.equal(lines.length, 1);
  const out = lines.join("\n");
  assert.ok(out.includes("EAUTH"));
  for (const pii of [lead.email, lead.phone, lead.name, "Kaya", "fiyat", "a@rastcreative.com", SMTP.SMTP_PASS]) assert.ok(!out.includes(pii), `log '${pii}' içermemeli`);
});

test("sendLeadNotification: senkron fırlatan gönderici de yakalanır", async () => {
  const { result, lines } = await captureErrors(() => sendLeadNotification(lead, { env: ENV, send: () => { throw new TypeError("kaynak: ayse@kaya.com"); } }));
  assert.equal(result, "failed");
  assert.deepEqual(lines, ["[leads] bildirim gönderilemedi: TypeError"]);
});

test("sendLeadNotification: asılı kalan gönderici zaman aşımına uğrar, sinyal iptal edilir", async () => {
  let signal;
  const send = (_mail, _smtp, s) => { signal = s; return new Promise(() => {}); }; // hiç bitmez
  const t0 = Date.now();
  const { result, lines } = await captureErrors(() => sendLeadNotification(lead, { env: ENV, send, timeoutMs: 50 }));
  assert.equal(result, "failed");
  assert.ok(Date.now() - t0 < 1000);
  assert.equal(signal.aborted, true);
  assert.deepEqual(lines, ["[leads] bildirim gönderilemedi: TIMEOUT"]);
});

test("sendLeadNotification: zaman aşımı üst sınırı 5 sn'dir (daha uzun istek kırpılır)", async () => {
  assert.equal(LEAD_NOTIFY_TIMEOUT_MS, 5000);
  let timeoutArg;
  const realSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (fn, ms, ...rest) => { timeoutArg = ms; return realSetTimeout(fn, ms, ...rest); };
  try {
    await sendLeadNotification(lead, { env: ENV, send: async () => {}, timeoutMs: 60_000 });
  } finally {
    globalThis.setTimeout = realSetTimeout;
  }
  assert.equal(timeoutArg, 5000);
});

/* ---------------- İçerik ---------------- */

test("buildLeadNotification: konu, alanlar, bağlantı ve UTM", () => {
  const m = buildLeadNotification(lead);
  assert.equal(m.subject, "Yeni lead: Ayşe Kaya (Hekim sistemi (web sitesi))");
  for (const s of ["Ad: Ayşe Kaya", "Telefon: 0532 111 22 33", "E-posta: ayse@kaya.com", "Şirket/Kurum: Kaya Klinik", "İlgi alanı: Hekim İçerik Sistemi",
    "Paket: standart", "Kaynak: Hekim sistemi (web sitesi)", "UTM: utm_source=ig, utm_campaign=bahar", "Mesaj:", "Merhaba, fiyat almak istiyorum.", `Rast OS: ${DEFAULT_LEADS_URL}`]) {
    assert.ok(m.text.includes(s), `metin '${s}' içermeli`);
  }
  assert.ok(m.html.includes(`href="${DEFAULT_LEADS_URL}"`));
  assert.ok(m.html.includes("Ayşe Kaya"));
  assert.equal(DEFAULT_LEADS_URL, "https://mvp.rastcreative.com/crm/leads");
});

test("buildLeadNotification: kaynak 'site' ve boş alanlar", () => {
  const m = buildLeadNotification({ name: "Veli", company: null, phone: null, email: "v@x.com", project_type: null, message: null, kaynak: null, paket: null, utm: {} });
  assert.equal(m.subject, "Yeni lead: Veli (Web sitesi)");
  assert.ok(m.text.includes("Telefon: —"));
  assert.ok(!m.text.includes("Şirket/Kurum") && !m.text.includes("Mesaj:") && !m.text.includes("UTM"));
  assert.ok(!m.html.includes("Mesaj"));
});

test("buildLeadNotification: tekrar başvuru ayrı belirtilir", () => {
  const m = buildLeadNotification(lead, { duplicate: true });
  assert.ok(m.subject.startsWith("Yeni lead (tekrar başvuru): Ayşe Kaya"));
  assert.ok(m.text.includes("tekrar başvuru"));
  assert.ok(!buildLeadNotification(lead, { duplicate: false }).text.includes("tekrar başvuru"));
});

test("buildLeadNotification: HTML'de tüm kullanıcı girdisi escape edilir", () => {
  const evil = {
    name: `<img src=x onerror=alert(1)>`, company: `"><script>alert('c')</script>`, phone: `<b>1</b> 532 111 22 33`, email: `a&b@x.com`,
    project_type: `<svg/onload=1>`, message: `</p><script>alert(1)</script>\n<a href="javascript:x">tıkla</a>`, kaynak: "hekim", paket: `<i>p</i>`,
    utm: { utm_source: `<u>`, "<k>": "v" },
  };
  const { html, text } = buildLeadNotification(evil);
  assert.ok(!/<script/i.test(html) && !/<img/i.test(html) && !/<svg/i.test(html) && !/<b>|<i>|<u>|<k>/.test(html), "ham etiket kalmamalı");
  assert.ok(!html.includes(`href="javascript:`));
  assert.ok(html.includes("&lt;img src=x onerror=alert(1)&gt;"));
  assert.ok(html.includes("&quot;&gt;&lt;script&gt;alert(&#39;c&#39;)&lt;/script&gt;"));
  assert.ok(html.includes("a&amp;b@x.com"));
  // Tek izin verilen bağlantı: Rast OS
  assert.deepEqual([...html.matchAll(/<a href="([^"]*)"/g)].map((x) => x[1]), [DEFAULT_LEADS_URL]);
  // Düz metin escape edilmez (HTML değil) ama içerik korunur
  assert.ok(text.includes(evil.name));
});

test("buildLeadNotification: konu satırında CR/LF ve satır ayırıcılar temizlenir (başlık enjeksiyonu)", () => {
  const attacks = [
    "Ali\r\nBcc: evil@x.com", "Ali\nSubject: hacked", "Ali\rX-Evil: 1", "Ali\u2028Bcc: evil@x.com", "Ali\u2029Bcc: e@x.com", "Ali\u0085Bcc: e@x.com", "Ali\u0000\u0007Bcc: e@x.com",
  ];
  for (const name of attacks) {
    const { subject } = buildLeadNotification({ ...lead, name });
    assert.ok(!/[\r\n\u0000-\u001F\u007F\u0085\u2028\u2029]/.test(subject), `konu kontrol karakteri içermemeli: ${JSON.stringify(subject)}`);
    assert.ok(subject.startsWith("Yeni lead: Ali "));
  }
  assert.equal(cleanHeader("a\r\n\r\nb"), "a b");
  assert.equal(cleanHeader(null), "");
  // Gönderen adresi de aynı temizlikten geçer
  let from;
  return sendLeadNotification(lead, { env: { ...ENV, SMTP_FROM: "Rast <b@x.com>\r\nBcc: e@x.com" }, send: async (mail) => { from = mail.from; } }).then(() => {
    assert.ok(!/[\r\n]/.test(from));
  });
});

test("buildLeadNotification: normalize edilmiş payload ile uçtan uca (CR/LF'li ad konuya sızmaz)", () => {
  const r = normalizeLeadPayload({ name: "Ece\r\nBcc: x@y.com", email: "e@x.com", message: "a\r\n\r\n\r\n\r\nb" });
  assert.equal(r.ok, true);
  const m = buildLeadNotification(r.value);
  assert.ok(!/[\r\n]/.test(m.subject));
  assert.ok(!/\r/.test(m.text));
});

test("mesaj ≤1000 karaktere kırpılır (…), kısa mesaj aynen kalır; konu ≤200", () => {
  const long = "ğ".repeat(5000);
  const m = buildLeadNotification({ ...lead, message: long });
  const msgLine = m.text.split("\nMesaj:\n")[1].split("\n")[0];
  assert.equal(Array.from(msgLine).length, NOTIFY_MESSAGE_MAX);
  assert.ok(msgLine.endsWith("…"));
  assert.ok(Array.from(m.html.match(/white-space:pre-wrap">([^<]*)</)[1]).length <= NOTIFY_MESSAGE_MAX + 5);
  const exact = "x".repeat(NOTIFY_MESSAGE_MAX);
  assert.ok(buildLeadNotification({ ...lead, message: exact }).text.includes(`\n${exact}\n`)); // sınırda kırpma yok
  assert.ok(buildLeadNotification({ ...lead, message: exact + "y" }).text.includes("…"));
  assert.ok(buildLeadNotification({ ...lead, name: "N".repeat(500) }).subject.length <= 200);
  // Vekil çiftleri (emoji) ortadan bölünmez
  const emoji = truncate("😀".repeat(10), 5);
  assert.equal(Array.from(emoji).length, 5);
  assert.ok(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(emoji));
  assert.equal(truncate("kısa", 10), "kısa");
});

test("mesajdaki satır sonları korunur ama CR ve kontrol karakterleri atılır", () => {
  const m = buildLeadNotification({ ...lead, message: "bir\r\niki\u0000\u0007\n\n\n\n\nüç" });
  assert.ok(m.text.includes("bir\niki\n\nüç"));
  assert.ok(!m.text.includes("\r") && !m.text.includes("\u0000"));
  assert.ok(m.html.includes("bir\niki\n\nüç")); // pre-wrap
});

test("escapeHtml", () => {
  assert.equal(escapeHtml(`<a href="x">&'</a>`), "&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;");
  assert.equal(escapeHtml(undefined), "");
});

test("leadsUrlFromEnv: APP_BASE_URL (http/https) varsa onun altında; geçersizse üretim adresi", () => {
  assert.equal(leadsUrlFromEnv({}), "https://mvp.rastcreative.com/crm/leads");
  assert.equal(leadsUrlFromEnv({ APP_BASE_URL: "https://app.example.com//" }), "https://app.example.com/crm/leads");
  assert.equal(leadsUrlFromEnv({ APP_BASE_URL: "javascript:alert(1)" }), DEFAULT_LEADS_URL);
  assert.equal(leadsUrlFromEnv({ APP_BASE_URL: 'https://x.com/"><script>' }), DEFAULT_LEADS_URL);
});

/* ---------------- Ortak SMTP modülü (Müşteri Bulma uyumu) ---------------- */

test("ortak mailer: Müşteri Bulma aynı smtpConfigFromEnv'i kullanır ve davranış değişmedi", () => {
  assert.equal(smtpConfigFromEnv, sharedSmtpConfigFromEnv);
  assert.deepEqual(smtpConfigFromEnv({ SMTP_HOST: " h ", SMTP_USER: " u ", SMTP_PASS: "p", SMTP_FROM: " f@x.com " }), { host: "h", port: 587, user: "u", pass: "p", from: "f@x.com" });
  assert.equal(smtpConfigFromEnv({ SMTP_HOST: "h", SMTP_USER: "u", SMTP_PASS: "p" }), null);
  assert.equal(smtpConfigFromEnv({ SMTP_HOST: "h", SMTP_USER: "u", SMTP_PASS: "p", SMTP_FROM: "f@x.com", SMTP_PORT: "70000" }), null);
});
