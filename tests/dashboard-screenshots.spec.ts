import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";

test.skip(process.env.UPDATE_DASHBOARD_SCREENSHOTS !== "1", "run pnpm screenshots to refresh documentation captures");
const output = resolve("docs/assets/screenshots");
mkdirSync(output, { recursive: true });

async function live(page: Page) {
  await page.route("**/dashboard-api/status", (route) => route.fulfill({ json: { mode: "live", endpoint: "titen.local", authentication: "server", authenticated: true } }));
  await page.route("**/dashboard-api/session", (route) => route.fulfill({ json: { data: {
    organization_id: "org_docs", principal_id: "docs_operator", principal_kind: "human", key_id: "key_docs",
    scopes: ["*"], max_trust: "verified", organization_role: "root",
  } } }));
  await page.route("**/dashboard-api/health", (route) => route.fulfill({ json: { data: { status: "ok", runtime: "bun", revision: "stable" } } }));
  await page.route("**/dashboard-api/readiness", (route) => route.fulfill({ json: { data: { ready: true } } }));
  await page.route("**/dashboard-api/workspaces", (route) => route.fulfill({ json: { data: { workspaces: [
    { workspace_id: "ws_platform", name: "platform-team", created_at: "2026-08-01T00:00:00Z" },
    { workspace_id: "ws_crm", name: "crm", created_at: "2026-08-02T00:00:00Z" },
  ] } } }));
  await page.route("**/dashboard-api/memories**", (route) => route.fulfill({ json: { data: {
    items: [{ id: "clm_release", subject_id: "platform-team", project_id: null, kind: "procedural", statement: "Production retry budget is 400 ms", confidence: .96, trust: "verified", visibility: "organization", status: "disputed", valid_from: "2026-08-01T00:00:00Z", valid_to: null, created_at: "2026-08-01T00:00:00Z" }],
    page: { limit: 25, has_more: false, next_cursor: null }, query: {}, authorization: { principal_id: "docs_operator", access_mode: "principal" },
  } } }));
  await page.route("**/dashboard-api/atlas/compile", (route) => route.fulfill({ json: { data: {
    lens: "evidence_trace", focus_id: "clm_release",
    nodes: [
      { id: "obs_probe", type: "observation", label: "Runtime probe completed", trust: "verified", status: "tool_result", created_at: "2026-08-01T00:01:00Z" },
      { id: "obs_thread", type: "observation", label: "Release review · 14 Jul", trust: "asserted", status: "user_statement", created_at: "2026-07-14T09:00:00Z" },
      { id: "obs_scope", type: "observation", label: "Scope: checkout only", trust: "asserted", status: "decision", created_at: "2026-07-15T09:00:00Z" },
      { id: "obs_peak", type: "observation", label: "Peak run · p95 268 ms", trust: "asserted", status: "tool_result", created_at: "2026-07-16T09:00:00Z" },
      { id: "clm_release", type: "claim", label: "Production retry budget is 400 ms", trust: "verified", status: "disputed", created_at: "2026-08-01T00:00:00Z" },
      { id: "ctx_release", type: "context", label: "ctx_0138QM7B", trust: "compiled", status: "active", created_at: "2026-08-01T00:02:00Z" },
      { id: "rel_release", type: "release", label: "crm-web · anonymous", trust: "reviewed_snapshot", status: "active", created_at: "2026-08-01T00:03:00Z" },
    ],
    edges: [
      { from: "obs_probe", to: "clm_release", relation: "supports" },
      { from: "obs_thread", to: "clm_release", relation: "supports" },
      { from: "obs_scope", to: "clm_release", relation: "qualifies" },
      { from: "obs_peak", to: "clm_release", relation: "contradicts" },
      { from: "clm_release", to: "ctx_release", relation: "selected-in" },
      { from: "clm_release", to: "rel_release", relation: "released-as" },
    ],
    metadata: { authorization: { principal_id: "docs_operator", access_mode: "principal" } },
  } } }));
}

test("capture live dashboard desktop", async ({ page }) => {
  await live(page);
  await page.setViewportSize({ width: 1600, height: 1080 });
  await page.goto("/dashboard/");
  await page.getByRole("button", { name: "Open in Atlas" }).click();
  await expect(page.locator("[data-atlas-nodes]").getByText("Production retry budget is 400 ms")).toBeVisible();
  await page.screenshot({ path: resolve(output, "dashboard-atlas-evidence.png"), fullPage: true });
});

test("capture live dashboard mobile", async ({ page }) => {
  await live(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dashboard/");
  await page.getByRole("button", { name: "Open in Atlas" }).click();
  await expect(page.locator("[data-atlas-nodes]").getByText("Production retry budget is 400 ms")).toBeVisible();
  await page.screenshot({ path: resolve(output, "dashboard-mobile.png"), fullPage: true });
});

test("capture workspace picker desktop and mobile", async ({ page }) => {
  await live(page);
  await page.setViewportSize({ width: 1600, height: 1080 });
  await page.goto("/dashboard/");
  await page.locator("[data-workspace-menu] summary").click();
  await page.screenshot({ path: resolve(output, "dashboard-workspace-picker.png") });
  await page.setViewportSize({ width: 320, height: 760 });
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.locator("[data-workspace-menu] summary").click();
  await page.screenshot({ path: resolve(output, "dashboard-workspace-picker-mobile.png") });
});
