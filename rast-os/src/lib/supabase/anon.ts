import { createClient } from "@supabase/supabase-js";

/**
 * Oturumsuz anon istemci (sunucu ve tarayıcı). Çerez / oturum okumaz ve saklamaz: herkese açık
 * onay sayfası yalnızca anon'a açık RPC'leri (approval_get / approval_decide) çağırır.
 */
export function createAnonClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
