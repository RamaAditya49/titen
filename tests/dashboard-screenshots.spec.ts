import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

const output = resolve("docs/assets/screenshots");
mkdirSync(output, { recursive: true });

test("capture final dashboard views", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1080 });
  await page.goto("/dashboard/");
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator("#atlas-view-heading")).toHaveText(
    "Evidence Trace",
  );
  await page.screenshot({
    path: resolve(output, "dashboard-atlas-evidence.png"),
    fullPage: true,
  });

  await page
    .getByRole("button", { name: "Conflict & Freshness", exact: true })
    .click();
  await page
    .locator('[data-lens-panel="conflict"] [data-select="disputed"]')
    .click();
  await expect(page.locator('[data-inspector="disputed"]')).toBeVisible();
  await page.screenshot({
    path: resolve(output, "dashboard-conflict-freshness.png"),
    fullPage: true,
  });
});

test("capture mobile inspection flow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dashboard/");
  await page.evaluate(() => document.fonts.ready);
  await page.locator(".focus-node").first().click();
  await expect(page.locator('[data-inspector="focus"]')).toBeVisible();
  await page.locator('[data-inspector="focus"]').screenshot({
    path: resolve(output, "dashboard-mobile.png"),
  });
});
