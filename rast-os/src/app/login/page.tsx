"use client";

import { useState } from "react";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/env";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!isSupabaseConfigured) {
      setError(
        "Supabase henüz yapılandırılmadı. .env.local dosyasına anahtarları ekleyin.",
      );
      return;
    }

    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);

    if (error) {
      setError("Giriş başarısız: " + error.message);
      return;
    }
    // Tam yeniden yükleme — store, oturumla birlikte Supabase'den veriyi çeker
    window.location.assign("/");
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center">
          <Image
            src="/brand/rast-white-tight.svg"
            alt="Rast Creative"
            width={240}
            height={146}
            className="h-14 w-auto"
            priority
          />
        </div>

        <div className="card p-6">
          <h1 className="text-lg font-semibold text-foreground">Giriş yap</h1>
          <p className="mt-1 text-sm text-muted">
            Rast Creative Operasyon Sistemi
          </p>

          <form onSubmit={onSubmit} className="mt-6 space-y-4">
            <div>
              <label htmlFor="login-email" className="mb-1 block text-sm text-muted">E-posta</label>
              <input
                id="login-email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-base text-foreground outline-none focus:border-amber/60 focus:ring-4 focus:ring-amber/10 md:text-sm"
                placeholder="ornek@rastcreative.com"
              />
            </div>
            <div>
              <label htmlFor="login-password" className="mb-1 block text-sm text-muted">Şifre</label>
              <input
                id="login-password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-base text-foreground outline-none focus:border-amber/60 focus:ring-4 focus:ring-amber/10 md:text-sm"
                placeholder="••••••••"
              />
            </div>

            {error && (
              <p role="alert" className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="btn-amber min-h-11 w-full rounded-lg py-2.5 text-sm font-medium disabled:opacity-60"
            >
              {loading ? "Giriş yapılıyor…" : "Giriş yap"}
            </button>
          </form>
        </div>

        <p className="mt-4 text-center text-xs text-muted">
          Rast OS · Ajans Operasyon Sistemi
        </p>
      </div>
    </div>
  );
}
