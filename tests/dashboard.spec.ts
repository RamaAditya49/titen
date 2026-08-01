import { expect, test, type Page } from "@playwright/test";

const view = {
  lens: "neighborhood",
  focus_id: null,
  nodes: [
    { id: "clm_live", type: "claim", label: "Production retry budget is 400 ms", trust: "verified", status: "active", created_at: "2026-08-01T00:00:00Z" },
    { id: "obs_live", type: "observation", label: "Measured runtime result", trust: "verified", status: "active", created_at: "2026-08-01T00:01:00Z" },
  ],
  edges: [{ from: "clm_live", to: "obs_live", relation: "supports" }],
  metadata: { subject_id: "platform-team", claim_count: 1 },
};

async function mockService(page: Page) {
  let connected = true;
  await page.route("**/dashboard-api/status", (route) => connected
    ? route.fulfill({ json: { mode: "live", endpoint: "titen.internal" } })
    : route.fulfill({ status: 503, json: { error: { code: "DASHBOARD_DISCONNECTED", message: "disconnected" } } }));
  await page.route("**/dashboard-api/health", (route) => route.fulfill({ json: { data: { status: "ok", runtime: "bun", revision: "stable-42" } } }));
  await page.route("**/dashboard-api/readiness", (route) => route.fulfill({ json: { data: { ready: true } } }));
  return { disconnect: () => { connected = false; } };
}

test("starts disconnected without fixtures, secrets, storage, or external requests", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  await page.goto("/dashboard/");
  await expect(page).toHaveTitle("Titen · Live Memory Atlas");
  await expect(page.getByRole("heading", { level: 1, name: "Live Memory Atlas" })).toBeVisible();
  await expect(page.getByText("No fixture is loaded.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Compile authorized view" })).toBeDisabled();
  await expect(page.getByRole("alert")).toContainText("TITEN_API_URL");
  const state = await page.evaluate(() => ({ html: document.documentElement.innerHTML, local: Object.keys(localStorage), session: Object.keys(sessionStorage) }));
  expect(state.html).not.toContain("TITEN_API_KEY='");
  expect(state.html).not.toContain("Production retry budget");
  expect(state.local).toEqual([]);
  expect(state.session).toEqual([]);
  expect(requests.every((url) => new URL(url).hostname === "127.0.0.1")).toBe(true);
});

test("renders live service checks and authorized Atlas records", async ({ page }) => {
  const service = await mockService(page);
  await page.route("**/dashboard-api/atlas/compile", async (route) => {
    expect(route.request().headers().authorization).toBeUndefined();
    expect(route.request().postDataJSON()).toEqual({ lens: "neighborhood", limit: 50, subject_id: "platform-team" });
    await route.fulfill({ json: { data: view } });
  });
  await page.goto("/dashboard/");
  await expect(page.getByText("Connected", { exact: true })).toBeVisible();
  await expect(page.getByText("Ready", { exact: true })).toBeVisible();
  await page.getByLabel("Subject ID").fill("platform-team");
  await page.getByRole("button", { name: "Compile authorized view" }).click();
  await expect(page.getByText("Production retry budget is 400 ms").first()).toBeVisible();
  await expect(page.locator("[data-inspector-title]")).toHaveText("Production retry budget is 400 ms");
  await expect(page.locator("[data-relationships]")).toContainText("supports");
  await expect(page.locator("[data-metadata]")).toContainText("platform-team");
  await expect(page.getByText("Live view compiled from the Titen API.")).toBeVisible();
  service.disconnect();
  await page.getByRole("button", { name: "Refresh service" }).click();
  await expect(page.getByText("Disconnected", { exact: true })).toBeVisible();
  await expect(page.getByText("Production retry budget is 400 ms")).toHaveCount(0);
  await expect(page.locator("[data-inspector-title]")).toHaveText("Nothing selected");
  await expect(page.locator("[data-metadata]")).toHaveText("No live view compiled.");
  await expect(page.locator("[data-records] button")).toHaveCount(0);
});

test("clears a successful projection before and after denial", async ({ page }) => {
  await mockService(page);
  let mode: "success" | "denied" | "unauthenticated" = "success";
  await page.route("**/dashboard-api/atlas/compile", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 80));
    if (mode === "denied") return route.fulfill({ status: 403, json: { error: { code: "UPSTREAM_403", message: "denied" } } });
    if (mode === "unauthenticated") return route.fulfill({ status: 401, json: { error: { code: "UPSTREAM_401", message: "unauthenticated" } } });
    return route.fulfill({ json: { data: view } });
  });
  await page.goto("/dashboard/");
  await page.getByLabel("Subject ID").fill("platform-team");
  await page.getByRole("button", { name: "Compile authorized view" }).click();
  await expect(page.getByText("Production retry budget is 400 ms").first()).toBeVisible();
  await expect(page.locator("[data-metadata]")).toContainText("platform-team");

  mode = "denied";
  await page.getByRole("button", { name: "Compile authorized view" }).click();
  await expect(page.locator("[data-loading]")).toBeVisible();
  await expect(page.getByText("Production retry budget is 400 ms")).toHaveCount(0);
  await expect(page.locator("[data-query-error]")).toContainText("not authorized");
  await expect(page.getByText("Query failed without a fixture fallback.")).toBeVisible();
  await expect(page.getByText("Production retry budget is 400 ms")).toHaveCount(0);
  await expect(page.locator("[data-inspector-title]")).toHaveText("Nothing selected");
  await expect(page.locator("[data-inspector-body]")).toBeHidden();
  await expect(page.locator("[data-metadata]")).toHaveText("No live view compiled.");
  await expect(page.locator("[data-records] button")).toHaveCount(0);
  await expect(page.locator("[data-projection]")).toHaveText("Query failed");

  mode = "unauthenticated";
  await page.getByRole("button", { name: "Compile authorized view" }).click();
  await expect(page.locator("[data-query-error]")).toContainText("Authentication failed");
});

test("validates lens-specific input and remains keyboard/mobile usable", async ({ page }) => {
  await mockService(page);
  await page.route("**/dashboard-api/atlas/compile", (route) => route.fulfill({ json: { data: view } }));
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto("/dashboard/");
  await page.getByText("Evidence trace", { exact: true }).click();
  await expect(page.getByRole("radio", { name: "Evidence trace" })).toBeChecked();
  await expect(page.getByLabel("Focus claim ID")).toHaveAttribute("required", "");
  await expect(page.getByLabel("Subject ID")).not.toHaveAttribute("required", "");
  await page.getByLabel("Focus claim ID").fill("clm_live");
  await page.getByRole("button", { name: "Compile authorized view" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText("Production retry budget is 400 ms").first()).toBeVisible();
  const width = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, body: document.body.scrollWidth }));
  expect(width.body).toBeLessThanOrEqual(width.viewport);
  await expect(page.locator(".inactive-area")).toHaveCount(6);
  await expect(page.locator(".inactive-area small")).toHaveText(Array(6).fill("not wired"));
  await expect(page.locator(".inactive-area a")).toHaveCount(0);
});

test("compiles governance lenses with their exact focus contracts", async ({ page }) => {
  await mockService(page);
  const bodies: Record<string, unknown>[] = [];
  await page.route("**/dashboard-api/atlas/compile", async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    bodies.push(body);
    const node = body.lens === "scope_preview"
      ? { id: "principal_ops", type: "principal", label: "agent", trust: "n/a", status: "active", created_at: "" }
      : { id: "release_1", type: "release", label: "Reviewed rollback procedure", trust: "reviewed_snapshot", status: "active", created_at: "2026-08-01T00:00:00Z" };
    await route.fulfill({ json: { data: { lens: body.lens, focus_id: body.focus_id ?? null, nodes: [node], edges: [], metadata: {} } } });
  });
  await page.goto("/dashboard/");

  await page.getByText("Scope preview", { exact: true }).click();
  await expect(page.getByLabel("Focus principal ID")).toHaveAttribute("required", "");
  await expect(page.getByText("Required for Scope preview.")).toBeVisible();
  await page.getByLabel("Focus principal ID").fill("principal_ops");
  await page.getByRole("button", { name: "Compile authorized view" }).click();
  await expect(page.locator("[data-inspector-title]")).toHaveText("agent");
  await expect(page.getByText("Invalid Date")).toHaveCount(0);

  await page.getByText("Knowledge releases", { exact: true }).click();
  await expect(page.getByLabel("Focus channel ID")).not.toHaveAttribute("required", "");
  await expect(page.getByText("Optional; leave blank to include all authorized channels.")).toBeVisible();
  await page.getByLabel("Focus channel ID").clear();
  await page.getByRole("button", { name: "Compile authorized view" }).click();
  await expect(page.locator("[data-inspector-title]")).toHaveText("Reviewed rollback procedure");

  expect(bodies).toEqual([
    { lens: "scope_preview", limit: 50, focus_id: "principal_ops" },
    { lens: "knowledge_release", limit: 50 },
  ]);
});
