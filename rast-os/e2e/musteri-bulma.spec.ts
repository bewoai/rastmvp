import { expect, test } from "@playwright/test";

// Müşteri Bulma (demo modu): veri src/lib/growth/demo-seed.ts'ten; Places / site çekici SAHTE (ağ yok).
// Seed: 16 aday (11'i Bugün listesine uygun), 1 dizi, 2 taslak, 2 manuel temas (dün ve 2 gün önce), 1 ret kaydı.

test("/musteri-bulma/bugun: 10 kart; WhatsApp bağlantısı adayın adını içerir; manuel temas kaydı sayacı artırır", async ({ page }) => {
  await page.goto("/musteri-bulma/bugun");
  await expect(page.getByRole("heading", { name: "Bugünün listesi" })).toBeVisible();
  const cards = page.getByRole("list", { name: "Bugünün adayları" }).getByRole("article");
  await expect(cards).toHaveCount(10);

  const first = cards.first();
  const heading = first.getByRole("heading", { level: 2 });
  await expect(heading).not.toHaveText("Yükleniyor…"); // ad canlı (sahte) Place Details'ten gelir
  const name = (await heading.textContent())!.trim();
  expect(name.length).toBeGreaterThan(3);
  await expect(first.getByText("Google Maps")).toBeVisible(); // atıf

  const wa = first.getByRole("link", { name: "WhatsApp" });
  await expect.poll(async () => decodeURIComponent((await wa.getAttribute("href")) ?? "")).toContain(name);
  expect(await wa.getAttribute("href")).toMatch(/^https:\/\/wa\.me\/90\d{10}\?text=/);
  expect(await wa.getAttribute("target")).toBe("_blank");

  await expect(page.getByTestId("daily-count")).toHaveText("0");
  await expect(page.getByTestId("streak")).toHaveText("2 gün");
  await first.getByRole("button", { name: "WhatsApp attım" }).click();
  await expect(page.getByTestId("daily-count")).toHaveText("1");
  await expect(page.getByTestId("streak")).toHaveText("3 gün");
  await expect(first.getByText(/Bugün: WhatsApp/)).toBeVisible();
  await expect(cards).toHaveCount(10); // liste gün içinde sabit
});

test("/musteri-bulma: onay kuyruğu — gönderim kapalı bandı, 2 taslak, onay planlamaz", async ({ page }) => {
  await page.goto("/musteri-bulma");
  await expect(page.getByRole("heading", { name: "Müşteri Bulma" })).toBeVisible();
  await page.getByRole("tab", { name: /Onay kuyruğu/ }).click();
  await expect(page.getByText("E-posta gönderimi kapalı (İYS kaydı bekleniyor)")).toBeVisible();
  const queue = page.getByRole("list", { name: "Onay kuyruğu" }).getByRole("listitem");
  await expect(queue).toHaveCount(2);
  await expect(queue.first()).toContainText("hasta bilgilendirme içeriği");
  await queue.first().getByRole("button", { name: "Onayla" }).click();
  await expect(queue.first()).toContainText("Onaylandı");
  await expect(page.getByText("planlanmadı (gönderim kapalı)")).toBeVisible();
});

test("/musteri-bulma: Keşfet örnek veriyle arar; hedef klinik listesi kalifiye olarak gelir", async ({ page }) => {
  await page.goto("/musteri-bulma");
  await page.getByRole("tab", { name: "Keşfet" }).click();
  await page.getByRole("button", { name: "Ara" }).click();
  const results = page.getByRole("region", { name: "Arama sonuçları" });
  await expect(results.getByRole("listitem").first()).toBeVisible();
  await expect(results.getByText("Google Maps")).toBeVisible();

  await page.getByRole("button", { name: "Hedef klinik listesini aktar (18)" }).click();
  await expect(page.getByText("18 aday eklendi (kalifiye), 0 zaten vardı")).toBeVisible();
  await page.getByRole("tab", { name: /Adaylar/ }).click();
  await page.getByRole("button", { name: /^Kalifiye\s*\d+$/ }).click();
  await page.getByRole("searchbox", { name: "Aday ara" }).fill("Vatan");
  await expect(page.getByText("Vatan Diş Kliniği").first()).toBeVisible();
});

test("mobil (375px): Bugün listesi yatay kaydırma üretmez, eylemler dokunulabilir", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/musteri-bulma/bugun");
  const cards = page.getByRole("list", { name: "Bugünün adayları" }).getByRole("article");
  await expect(cards).toHaveCount(10);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  const box = await cards.first().getByRole("button", { name: "Aradım" }).boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(40);
  if (process.env.GROWTH_SHOT_DIR) await page.screenshot({ path: `${process.env.GROWTH_SHOT_DIR}/bugun-mobil.png`, fullPage: false });
});
