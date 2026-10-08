/** Supabase ortam değişkenleri tanımlı mı? (henüz kurulmadıysa UI graceful davranır) */
export const isSupabaseConfigured = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
);

/**
 * Giriş zorunlu mu? Fail-closed: değişken yoksa / tanınmıyorsa ZORUNLU kabul edilir.
 * Yalnızca açıkça NEXT_PUBLIC_REQUIRE_AUTH="false" verilirse kapanır (yerel demo/kurulum).
 */
export const isAuthRequired = process.env.NEXT_PUBLIC_REQUIRE_AUTH !== "false";
