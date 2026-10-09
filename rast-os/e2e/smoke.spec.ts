import { expect, test } from "@playwright/test";
import { DEMO_APPROVAL_TOKENS } from "../src/lib/seed";

// Demo modu smoke testleri: Supabase yok, veri src/lib/seed.ts'ten gelir. Her test kendi tarayıcı
// bağlamında (temiz localStorage/store) çalışır; testler birbirine bağlı değildir.

test.beforeEach(async ({ page }) => {
  // Yazdırma sayfası Google Fonts yükler; ağ olmadan da hızlı/aynı sonuçla çalışsın.
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
});

test("dashboard (Bugün): MRR kartı ve Son işlemler görünür", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Bugün" })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Aylık tekrarlayan gelir \(MRR\)/ })).toBeVisible();
  await expect(page.getByText("MRR · KDV hariç")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Son işlemler" })).toBeVisible();
  await expect(page.getByText("Berat fatura güncelledi: 2026-082")).toBeVisible();
});

test("/teklifler: seed teklifleri ve toplamlar listelenir", async ({ page }) => {
  await page.goto("/teklifler");
  await expect(page.getByRole("heading", { name: "Teklifler" })).toBeVisible();
  const row = page.getByRole("row").filter({ hasText: "RC-2026-001" });
  await expect(row).toBeVisible();
  await expect(row).toContainText("Hekim İçerik Sistemi — Standart");
  await expect(row).toContainText("₺25.000");
  await expect(row).toContainText("₺30.000");
  await expect(row).toContainText("Gönderildi");
  // Özet şeridi: 1 açık teklif (25.000), 3 kabul edilen (84.000); + 1 reddedilen (bildirim demosu)
  await expect(page.getByText("Açık tutar (KDV hariç)")).toBeVisible();
  await expect(page.getByText("₺84.000")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Tümü\s*5$/ })).toBeVisible();
});

test("teklif oluştur: Hekim Standart paketi → 25.000 / 30.000", async ({ page }) => {
  await page.goto("/teklifler");
  await page.getByRole("button", { name: "Yeni Teklif" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("combobox", { name: "Paket" })).toHaveValue(/hekim/);
  await dialog.getByRole("button", { name: "Oluştur ve düzenle" }).click();

  await expect(page).toHaveURL(/\/teklifler\/[^/]+$/);
  await expect(page.getByText("Hekim İçerik Sistemi — Standart").first()).toBeVisible();
  const grandTotal = page.getByText("Genel toplam", { exact: true });
  await expect(grandTotal).toBeVisible();
  const totals = grandTotal.locator("xpath=ancestor::dl[1]");
  await expect(totals).toContainText("₺25.000");
  await expect(totals).toContainText("₺30.000");
});

test("teklif yazdırma görünümü: A4 sayfa ve Yazdır düğmesi", async ({ page }) => {
  await page.goto("/teklifler/pr1/yazdir");
  await expect(page.getByRole("button", { name: /Yazdır/ })).toBeVisible();
  const sheet = page.getByRole("article", { name: "Teklif RC-2026-001" });
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText("Hekim İçerik Sistemi — Standart");
  await expect(sheet).toContainText("₺25.000");
  // A4 genişliği: 210 mm ≈ 793,7 px (96 dpi)
  const box = await sheet.boundingBox();
  expect(box?.width).toBeGreaterThan(780);
  expect(box?.width).toBeLessThan(805);
});

test("/raporlar/aylik: kayıtlı Ağustos 2026 raporu ve yazdırma görünümü", async ({ page }) => {
  await page.goto("/raporlar/aylik");
  await expect(page.getByRole("heading", { name: "Aylık müşteri raporu" })).toBeVisible();
  const saved = page.getByRole("region", { name: "Kayıtlı raporlar" });
  await expect(saved).toBeVisible();
  const item = saved.getByRole("listitem").filter({ hasText: "Adatıp Sağlık Grubu" });
  await expect(item).toContainText("Ağustos 2026");

  await item.getByRole("link", { name: "Yazdır" }).click();
  await expect(page).toHaveURL(/\/raporlar\/aylik\/c2\/2026-08\/yazdir$/);
  await expect(page.getByRole("button", { name: /Yazdır/ })).toBeVisible();
  const sheet = page.getByRole("article", { name: /Adatıp Sağlık Grubu .*raporu/ });
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText("Kardiyoloji bilgilendirme serisi başladı");
});

test("/content: onay rozetleri görünür", async ({ page }) => {
  await page.goto("/content");
  await expect(page.getByRole("heading", { name: "İçerik Merkezi" })).toBeVisible();
  await expect(page.getByText("Onay bekliyor", { exact: true })).toBeVisible();
  await expect(page.getByText("Onaylı", { exact: true })).toBeVisible();
});

test("/onay/<token>: 8 madde ve ad girilmeden onay verilmez", async ({ page }) => {
  await page.goto(`/onay/${DEMO_APPROVAL_TOKENS.pending}`);
  await expect(page.getByRole("heading", { name: "Doktor tanıtımı — Kardiyoloji" })).toBeVisible();
  await expect(page.getByText("Demo modu:")).toBeVisible();
  const boxes = page.getByRole("checkbox");
  await expect(boxes).toHaveCount(8);

  const approve = page.getByRole("button", { name: "Onaylıyorum" });
  const alert = page.getByRole("alert").filter({ hasText: /\S/ }); // route announcer boş

  // Ad yok → reddedilir
  await approve.click();
  await expect(alert).toContainText("adınızı ve soyadınızı");

  // Ad var, madde yok → reddedilir
  await page.getByLabel(/Adınız soyadınız/).fill("Uzm. Dr. Test Hekim");
  await approve.click();
  await expect(alert).toContainText("8 maddenin tamamını");

  // 7/8 → hâlâ reddedilir
  for (let i = 0; i < 7; i++) await boxes.nth(i).check();
  await expect(page.getByText("7/8")).toBeVisible();
  await approve.click();
  await expect(alert).toContainText("8 maddenin tamamını");
  await expect(page.getByRole("heading", { name: "İçerik onaylandı" })).toHaveCount(0);

  // 8/8 + ad → demo akışı tamamlanır
  await boxes.nth(7).check();
  await approve.click();
  await expect(page.getByRole("heading", { name: "İçerik onaylandı" })).toBeVisible();
  await expect(page.getByText("Uzm. Dr. Test Hekim")).toBeVisible();
});

test("/onay/<geçersiz token>: bulunamadı mesajı", async ({ page }) => {
  await page.goto(`/onay/${"0".repeat(64)}`);
  await expect(page.getByRole("heading", { name: "Onay bağlantısı bulunamadı" })).toBeVisible();
});

test("/settings/islem-gecmisi: işlem türü ve modül filtreleri", async ({ page }) => {
  await page.goto("/settings/islem-gecmisi");
  await expect(page.getByRole("heading", { name: "İşlem Geçmişi" })).toBeVisible();
  const rows = page.getByRole("row");
  await expect(page.getByRole("button", { name: /^Tümü\s*10$/ })).toHaveAttribute("aria-pressed", "true");
  await expect(rows.filter({ hasText: "Eski ekipman kirası" })).toHaveCount(1);

  // İşlem türü: yalnızca Silme
  await page.getByRole("button", { name: /^Silme\s*1$/ }).click();
  await expect(rows.filter({ hasText: "Eski ekipman kirası" })).toBeVisible();
  await expect(rows.filter({ hasText: "2026-082" })).toHaveCount(0);

  // Tümü'ne dön, modül = Teklif
  await page.getByRole("button", { name: /^Tümü\s*10$/ }).click();
  await page.getByRole("combobox", { name: "Modül" }).selectOption({ label: "Teklif" });
  await expect(rows.filter({ hasText: "Hekim İçerik Sistemi — Standart" })).toHaveCount(2);
  await expect(rows.filter({ hasText: "2026-082" })).toHaveCount(0);
});

test("/import: uygulamadan önce kuru çalıştırma önizlemesi çıkar", async ({ page }) => {
  await page.goto("/import");
  await expect(page.getByRole("heading", { name: "İçe Aktar" })).toBeVisible();
  const csv = "Firma adı,Aylık ücret,Notlar\nE2E Test Klinik,12000,smoke\nE2E Test Diş,8000,smoke\n";
  await page.locator('input[type="file"]').first().setInputFiles({
    name: "musteriler.csv", mimeType: "text/csv", buffer: Buffer.from(csv, "utf-8"),
  });

  await expect(page.getByText("Önizleme (kuru çalıştırma) — henüz hiçbir şey yazılmadı")).toBeVisible();
  await expect(page.getByText(/^\d+ eklenecek$/)).toBeVisible();
  await expect(page.getByRole("cell", { name: "E2E Test Klinik" }).first()).toBeVisible();
  const apply = page.getByRole("button", { name: "Uygula" });
  await expect(apply).toBeEnabled();
  // Uygulamadan önce sonuç mesajı yok
  await expect(page.getByText(/kayıt akıllı aktarıldı/)).toHaveCount(0);

  await apply.click();
  await expect(page.getByText(/2 kayıt akıllı aktarıldı/).first()).toBeVisible();
  await expect(page.getByText(/Önizleme (kuru çalıştırma)/)).toHaveCount(0);
});

test("mobil (375px): dashboard yatay kaydırma üretmez", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Son işlemler" })).toBeVisible();
  const overflow = await page.evaluate(() => {
    const el = document.scrollingElement ?? document.documentElement;
    return el.scrollWidth - el.clientWidth;
  });
  expect(overflow).toBeLessThanOrEqual(0);
});
