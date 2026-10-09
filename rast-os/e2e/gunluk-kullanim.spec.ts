import { expect, test } from "@playwright/test";

// Günlük kullanım: Ctrl/⌘K kayıt araması, bildirim zili, görev atama, klavye kısayolları (demo modu, seed verisi).
// Demo modunda oturumdaki kullanıcı "Berat Değirmenci" (DEMO_USER_ID); ekip: Berat + Mohammed Akram Adnan.

test("Ctrl+K: ekran ve kayıt sonuçları gruplu; Enter ile kayıt açılır", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Bugün" })).toBeVisible();
  await page.keyboard.press("Control+K");
  const box = page.getByRole("combobox", { name: "Ara: kayıtlar ve ekranlar" });
  await expect(box).toBeFocused();

  // Türkçe/aksan duyarsız: "kavis" → lead "Kavis Mimarlık"; "gorev" → Görevler ekranı
  await box.fill("gorev");
  const list = page.getByRole("listbox", { name: "Arama sonuçları" });
  await expect(list.getByRole("group", { name: "Ekranlar" }).getByRole("option", { name: /Görevler/ })).toBeVisible();

  await box.fill("KAVİS");
  const leads = list.getByRole("group", { name: "Potansiyel müşteriler" });
  await expect(leads.getByRole("option", { name: /Kavis Mimarlık/ })).toBeVisible();
  // İlk seçenek aktif; Enter → lead sayfası, düzenleme penceresi açık
  await expect(list.getByRole("option").first()).toHaveAttribute("aria-selected", "true");
  await box.press("Enter");
  await expect(page).toHaveURL(/\/crm\/leads/);
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("textbox").first()).toHaveValue("Kavis Mimarlık");
  // Kapatınca ?ac= adres çubuğundan silinir
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page).not.toHaveURL(/ac=/);

  // Ok tuşlarıyla gezinme: "aytas" → müşteri, proje, görev…; ↓ ile ikinci seçenek
  await page.keyboard.press("Control+K");
  await box.fill("aytas");
  await expect(list.getByRole("group", { name: "Müşteriler" })).toBeVisible();
  await expect(list.getByRole("group", { name: "Projeler" })).toBeVisible();
  await box.press("ArrowDown");
  await expect(list.getByRole("option").nth(1)).toHaveAttribute("aria-selected", "true");
  await box.press("ArrowUp");
  await box.press("Enter");
  await expect(page).toHaveURL(/\/crm\/clients\/c1$/);
});

test("Ctrl+K: görev sonucu Görevler'de satırı vurgular", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("Control+K");
  await page.getByRole("combobox", { name: "Ara: kayıtlar ve ekranlar" }).fill("story serisi");
  await page.getByRole("option", { name: /Story serisi tasarım/ }).click();
  await expect(page).toHaveURL(/\/tasks/);
  await expect(page.locator("#task-t6")).toBeInViewport();
});

test("bildirim zili: ilk açılışta dolu; yeni lead, müşteri kararı, teklif sonucu; okundu kalıcı; sekme başlığında sayı", async ({ page }) => {
  await page.goto("/");
  const bell = page.getByRole("button", { name: /^Bildirimler \(\d+ okunmamış\)$/ });
  await expect(bell).toBeVisible();
  await expect(page).toHaveTitle(/^\(\d+\) Bugün · Rast OS$/);
  await bell.click();
  const panel = page.getByRole("region", { name: "Bildirimler" });
  await expect(panel.getByText("Yeni lead: Dr. Elif Demir Kliniği")).toBeVisible();
  await expect(panel.getByText("Müşteri onayladı: Global hasta deneyimi")).toBeVisible();
  await expect(panel.getByText("Teklif reddedildi: Aytaş Home — Kurumsal tanıtım filmi")).toBeVisible();

  await panel.getByRole("button", { name: "Tümünü okundu işaretle" }).click();
  await expect(page.getByRole("button", { name: "Bildirimler", exact: true })).toBeVisible();
  await expect(page).toHaveTitle("Bugün · Rast OS");

  // localStorage: yenilemeden sonra da okunmuş
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Bugün" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Bildirimler", exact: true })).toBeVisible();
  await expect(page).toHaveTitle("Bugün · Rast OS");
});

test("görev atama: sorumlu seç, 'Bana atanan' süzgeci; Bugün'de varsayılan bana + atanmamış", async ({ page }) => {
  await page.goto("/tasks");
  await expect(page.getByRole("heading", { level: 1, name: "Görevler" })).toBeVisible();
  const row = page.locator("li", { hasText: "Alt yazı + renk" });
  // Atanmamış görev → Berat'a ata (avatar BD)
  await row.getByRole("combobox", { name: "Sorumlu ata" }).selectOption({ label: "Berat Değirmenci" });
  await expect(row.getByRole("combobox", { name: "Sorumlu: Berat Değirmenci" })).toBeVisible();
  await expect(row.getByText("BD", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: /^Bana atanan/ }).click();
  await expect(page.getByRole("button", { name: /^Bana atanan/ })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("li", { hasText: "Alt yazı + renk" })).toBeVisible();
  await expect(page.locator("li", { hasText: "Story serisi tasarım" })).toHaveCount(0); // Mohammed'in görevi

  // Bugün: varsayılan "Benim" (bana atanan + atanmamış); "Herkes" ile başkasının görevi de görünür
  await page.getByRole("link", { name: "Bugün", exact: true }).click();
  const todo = page.getByRole("region", { name: "Yapılacaklar" });
  await expect(todo.getByRole("button", { name: "Benim" })).toHaveAttribute("aria-pressed", "true");
  await expect(todo.getByText("Ağustos caption seti")).toBeVisible();
  await expect(todo.getByText("Story serisi tasarım")).toHaveCount(0);
  await todo.getByRole("button", { name: "Herkes" }).click();
  await expect(todo.getByText("Story serisi tasarım")).toBeVisible();
  await expect(todo.getByText("Mohammed Akram Adnan").first()).toBeVisible();
});

test("klavye kısayolları: g + harf ile gezinme, ? yardım; yazı alanında devre dışı", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Bugün" })).toBeVisible();
  await page.keyboard.press("g");
  await page.keyboard.press("t");
  await expect(page).toHaveURL(/\/teklifler$/);
  await page.keyboard.press("g");
  await page.keyboard.press("g");
  await expect(page).toHaveURL(/\/tasks$/);

  await page.keyboard.press("?");
  const help = page.getByRole("dialog", { name: "Klavye kısayolları" });
  await expect(help).toBeVisible();
  await expect(help.getByText("Potansiyel müşteriler")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(help).toHaveCount(0);

  // Arama kutusu odaktayken "g" "b" yazıdır, gezinme değil
  await page.getByRole("searchbox", { name: "Görev ara" }).click();
  await page.keyboard.press("g");
  await page.keyboard.press("b");
  await expect(page).toHaveURL(/\/tasks$/);
  await expect(page.getByRole("searchbox", { name: "Görev ara" })).toHaveValue("gb");
});

test("Dosyalar menüde yok, rota duruyor", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("navigation", { name: "Ana menü" }).getByRole("link", { name: "Dosyalar" })).toHaveCount(0);
  await page.goto("/files");
  await expect(page.getByRole("heading", { name: "Dosyalar" })).toBeVisible();
});

test("mobil (390px): büyüteç arama penceresi açar; yatay kaydırma yok", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Bugün" })).toBeVisible();
  await page.getByRole("button", { name: "Ara", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "Ara" });
  await expect(sheet).toBeVisible();
  await sheet.getByRole("combobox").fill("mira");
  await expect(sheet.getByRole("option", { name: /Mira Kozmetik/ }).first()).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);
  // Bildirim paneli ekrandan taşmaz
  await page.getByRole("button", { name: /^Bildirimler/ }).click();
  const box = await page.getByRole("region", { name: "Bildirimler" }).boundingBox();
  expect(box?.x ?? -1).toBeGreaterThanOrEqual(0);
  expect((box?.x ?? 0) + (box?.width ?? 999)).toBeLessThanOrEqual(390);
  await page.keyboard.press("Escape");
  const overflow = await page.evaluate(() => {
    const el = document.scrollingElement ?? document.documentElement;
    return el.scrollWidth - el.clientWidth;
  });
  expect(overflow).toBeLessThanOrEqual(0);
});
