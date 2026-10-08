import { defineConfig, devices } from "@playwright/test";

const PORT = 3499;

// Demo modu: boş Supabase env → hiçbir veritabanına bağlanmaz; REQUIRE_AUTH=false → sayfalar girişsiz açılır.
const demoEnv = {
  NEXT_PUBLIC_SUPABASE_URL: "",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "",
  NEXT_PUBLIC_REQUIRE_AUTH: "false",
  NEXT_TELEMETRY_DISABLED: "1",
};

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    locale: "tr-TR",
    timezoneId: "Europe/Istanbul",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npm run build && npm run start -- -H 127.0.0.1 -p ${PORT}`,
    url: `http://127.0.0.1:${PORT}/login`,
    env: demoEnv,
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
  },
});
