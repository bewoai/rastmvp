import { expect, test } from "@playwright/test";
import { DEMO_APPROVAL_TOKENS, DEMO_PORTAL_TOKENS } from "../src/lib/seed";

// Demo modu: Supabase yok, portal verisi seed'den (Adatıp Sağlık Grubu) gelir; oturum gerekmez.
test("/portal/<token>: seed bağlantısı Bu ay'ı gösterir, bekleyen onay /onay/'a gider", async ({ page }) => {
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());

  const res = await page.goto(`/portal/${DEMO_PORTAL_TOKENS.active}`);
  // Token sızmasın / dizinlenmesin: HTTP başlığı + meta
  expect(res?.headers()["referrer-policy"]).toBe("no-referrer");
  expect(res?.headers()["x-robots-tag"]).toContain("noindex");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);

  await expect(page.getByRole("heading", { level: 1, name: "Adatıp Sağlık Grubu" })).toBeVisible();
  const thisMonth = page.getByRole("region", { name: "Bu ay" });
  await expect(thisMonth).toBeVisible();
  await expect(thisMonth).toContainText("Doktor tanıtımı — Kardiyoloji");
  await expect(page.getByRole("region", { name: "Çekim günleri" })).toContainText("Adatıp Hastanesi, Kardiyoloji katı");
  await expect(page.getByRole("region", { name: "Son rapor" })).toContainText("Kardiyoloji bilgilendirme serisi başladı");
  await expect(page.getByText("Bu sayfa gizli bağlantıyla paylaşılır; bağlantıyı iletmeyin.")).toBeVisible();

  // Bekleyen onayın düğmesi onay sayfasına gider
  const approve = thisMonth.getByRole("link", { name: "İncele ve onayla" });
  await expect(approve).toHaveCount(1);
  await expect(approve).toHaveAttribute("href", `/onay/${DEMO_APPROVAL_TOKENS.pending}`);
  await approve.click();
  await expect(page).toHaveURL(new RegExp(`/onay/${DEMO_APPROVAL_TOKENS.pending}$`));
  await expect(page.getByRole("heading", { name: "Doktor tanıtımı — Kardiyoloji" })).toBeVisible();

  // İptal edilmiş bağlantı: veri yok, "bulunamadı"
  await page.goto(`/portal/${DEMO_PORTAL_TOKENS.revoked}`);
  await expect(page.getByRole("heading", { name: "Portal bağlantısı bulunamadı" })).toBeVisible();
  await expect(page.getByText("Adatıp Sağlık Grubu")).toHaveCount(0);
});
