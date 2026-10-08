// Müşteri Bulma — ret (unsubscribe) bağlantısı token'ı. YALNIZCA SUNUCU.
// Biçim: "<message_id>.<hex(HMAC-SHA256(message_id, key))>" — SQL public.outreach_unsub_token() ile AYNI.
// key = outreach_settings.unsub_key_hash (rastgele bir sırrın SHA-256 hex'i; sır saklanmaz). Asıl doğrulama
// DB'de (outreach_unsubscribe RPC) yapılır; buradaki fonksiyonlar biçim ön kontrolü, testler ve demo içindir.
// Not: yalnızca node: modülleri (type-stripping).
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TOKEN_RE = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.([0-9a-f]{64})$/;

/** Sırdan anahtar (DB'deki unsub_key_hash ile aynı türetme: SHA-256 hex). */
export function unsubKeyFromSecret(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

export function signUnsubToken(messageId: string, keyHex: string): string {
  const id = messageId.toLowerCase();
  if (!UUID_RE.test(id)) throw new Error("Geçersiz mesaj kimliği");
  return `${id}.${createHmac("sha256", keyHex).update(id, "utf8").digest("hex")}`;
}

/** Biçim ön kontrolü (anahtarsız): DB'ye yalnızca biçimi doğru token'lar gönderilir. */
export function isUnsubTokenShape(token: unknown): token is string {
  return typeof token === "string" && TOKEN_RE.test(token);
}

/** Sabit-zamanlı doğrulama; geçerliyse mesaj kimliği, değilse null. */
export function verifyUnsubToken(token: unknown, keyHex: string): string | null {
  if (!isUnsubTokenShape(token)) return null;
  const [, id, sig] = token.match(TOKEN_RE)!;
  const expected = createHmac("sha256", keyHex).update(id, "utf8").digest();
  const given = Buffer.from(sig, "hex");
  return given.length === expected.length && timingSafeEqual(given, expected) ? id : null;
}
