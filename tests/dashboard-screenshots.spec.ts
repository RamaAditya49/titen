import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";

test.skip(process.env.UPDATE_DASHBOARD_SCREENSHOTS !== "1", "run pnpm screenshots to refresh documentation captures");
const output = resolve("docs/assets/screenshots");
mkdirSync(output, { recursive: true });

async function live(page: Page) {
  await page.route("**/dashboard-api/status", (route) => route.fulfill({ json: { mode: "live", endpoint: "titen.local" } }));
  await page.route("**/dashboard-api/health", (route) => route.fulfill({ json: { data: { status: "ok", runtime: "bun", revision: "stable" } } }));
  await page.route("**/dashboard-api/readiness", (route) => route.fulfill({ json: { data: { ready: true } } }));
  await page.route("**/dashboard-api/atlas/compile", (route) => route.fulfill({ json: { data: { lens: "neighborhood", focus_id: null, nodes: [{ id: "clm_release", type: "claim", label: "Production retry budget is 400 ms", trust: "verified", status: "active", created_at: "2026-08-01T00:00:00Z" }, { id: "obs_probe", type: "observation", label: "Runtime probe completed", trust: "verified", status: "active", created_at: "2026-08-01T00:01:00Z" }], edges: [{ from: "clm_release", to: "obs_probe", relation: "supports" }], metadata: { subject_id: "platform-team", claim_count: 1 } } } }));
}

test("capture live dashboard desktop", async ({ page }) => {
  await live(page);
  await page.setViewportSize({ width: 1600, height: 1080 });
  await page.goto("/dashboard/");
  await page.getByLabel("Subject ID").fill("platform-team");
  await page.getByRole("button", { name: "Compile authorized view" }).click();
  await expect(page.getByText("Production retry budget is 400 ms").first()).toBeVisible();
  await page.screenshot({ path: resolve(output, "dashboard-atlas-evidence.png"), fullPage: true });
  await page.screenshot({ path: resolve(output, "dashboard-conflict-freshness.png"), fullPage: true });
});

test("capture live dashboard mobile", async ({ page }) => {
  await live(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dashboard/");
  await page.getByLabel("Subject ID").fill("platform-team");
  await page.getByRole("button", { name: "Compile authorized view" }).click();
  await expect(page.getByText("Production retry budget is 400 ms").first()).toBeVisible();
  await page.screenshot({ path: resolve(output, "dashboard-mobile.png"), fullPage: true });
});
