/** Supabase ortam değişkenleri tanımlı mı? (henüz kurulmadıysa UI graceful davranır) */
export const isSupabaseConfigured = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
);
