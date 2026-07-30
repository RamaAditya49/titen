import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/dashboard/");
  await page.evaluate(() => document.fonts.ready);
});

test("renders the approved Atlas frame without external requests", async ({
  page,
}) => {
  const requests: string[] = [];
  const failed: string[] = [];
  const errors: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  page.on("requestfailed", (request) => failed.push(request.url()));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  await page.reload();
  await page.evaluate(() => document.fonts.ready);

  await expect(page).toHaveTitle("Titen · Memory Atlas");
  await expect(
    page.getByRole("heading", { level: 1, name: "Memory Atlas" }),
  ).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Product areas" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Evidence Trace" }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('[data-lens-panel="evidence"]')).toBeVisible();
  await expect(page.locator('[data-inspector="focus"]')).toContainText(
    "400 ms",
  );

  expect(failed).toEqual([]);
  expect(errors).toEqual([]);
  expect(requests.every((url) => new URL(url).hostname === "127.0.0.1")).toBe(
    true,
  );
});

test("switches all lenses and inspector states without a request", async ({
  page,
}) => {
  let requests = 0;
  page.on("request", () => requests++);
  const initialRequests = requests;

  const views = [
    ["Neighborhood", "neighborhood", "Memory Neighborhood"],
    ["Conflict & Freshness", "conflict", "Conflict & Freshness"],
    ["Scope Preview", "scope", "Scope Preview"],
    ["Evidence Trace", "evidence", "Evidence Trace"],
  ];

  for (const [label, id, heading] of views) {
    await page.getByRole("button", { name: label, exact: true }).click();
    await expect(page.locator(`[data-lens-panel="${id}"]`)).toBeVisible();
    await expect(page.locator("#atlas-view-heading")).toHaveText(heading);
    await expect(
      page.getByRole("button", { name: label, exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("[data-lens-panel]:visible")).toHaveCount(1);
  }

  await page.locator('[data-select="observation"]').click();
  await expect(page.locator('[data-inspector="observation"]')).toBeVisible();
  await page.locator('[data-select="disputed"]').first().click();
  await expect(page.locator('[data-inspector="disputed"]')).toBeVisible();
  await page.locator('[data-select="focus"]').first().click();
  await expect(page.locator('[data-inspector="focus"]')).toBeVisible();
  expect(requests).toBe(initialRequests);
});

test("opens and closes the native search dialog from keyboard", async ({
  page,
}) => {
  await page.keyboard.press("Control+k");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(page.locator("#command-search")).toBeFocused();
  await page.locator("#command-search").fill("scope");
  await dialog.getByRole("button", { name: "Scope Preview" }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.locator('[data-lens-panel="scope"]')).toBeVisible();

  await page.getByRole("button", { name: /Search or jump/ }).click();
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
});

test("disconnects, clears private presentation, and reconnects without storage", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Disconnect" }).click();
  await expect(page.locator(".connected-workspace")).toBeHidden();
  await expect(
    page.getByRole("heading", { name: "Memory Atlas is disconnected." }),
  ).toBeVisible();
  await expect(page.getByText("no endpoint connected")).toBeVisible();

  const storage = await page.evaluate(() => ({
    local: Object.keys(localStorage),
    session: Object.keys(sessionStorage),
  }));
  expect(storage).toEqual({ local: [], session: [] });

  await page.getByRole("button", { name: "Reconnect demo" }).click();
  await expect(page.locator(".connected-workspace")).toBeVisible();
  await expect(page.locator('[data-inspector="focus"]')).toBeVisible();
});

test("uses only same-origin adapter responses for opt-in live Atlas", async ({ page }) => {
  await page.route("**/dashboard-api/status", (route) => route.fulfill({ json: { mode: "live", endpoint: "titen.internal" } }));
  await page.route("**/dashboard-api/atlas/compile", async (route) => {
    expect(route.request().headers().authorization).toBeUndefined();
    const body = route.request().postDataJSON();
    expect(body).toEqual({ lens: "conflict_freshness", subject_id: "default", limit: 5 });
    await route.fulfill({ json: { data: { lens: "conflict_freshness", nodes: [{ id: "clm_live", type: "claim", label: "Live measured outcome", trust: "verified", status: "active", created_at: "2026-07-30T00:00:00Z" }], edges: [], metadata: {} } } });
  });
  await page.goto("/dashboard/?live=1");
  await expect(page.locator(".runtime-label")).toHaveText("titen.internal · Conflict & Freshness live; other lenses synthetic");
  await page.getByRole("button", { name: "Conflict & Freshness" }).click();
  await expect(page.getByText("Live measured outcome")).toBeVisible();
  expect(await page.content()).not.toContain("TITEN_API_KEY");
});

test("labels live adapter failure without relabelling fixture rows live", async ({ page }) => {
  await page.route("**/dashboard-api/status", (route) => route.fulfill({ json: { mode: "live", endpoint: "titen.internal" } }));
  await page.route("**/dashboard-api/atlas/compile", (route) => route.fulfill({ status: 502, json: { error: { code: "UPSTREAM_UNAVAILABLE" } } }));
  await page.goto("/dashboard/?live=1");
  await expect(page.locator(".runtime-label")).toHaveText("live Atlas unavailable · demo retained");
  await expect(page.locator(".connected-label")).toContainText("error");
});

test("keeps unavailable product areas as non-interactive orientation", async ({
  page,
}) => {
  for (const label of [
    "Memories",
    "Context",
    "Work",
    "Audit & Events",
    "System",
    "Access",
    "Approvals",
    "Releases",
  ])
    await expect(
      page.getByText(label, { exact: true }).first(),
    ).not.toHaveAttribute("href");
  await expect(page.locator(".nav-item:not(.active)")).toHaveCount(8);
});

test("uses a readable mobile trail and bounded tablet graph", async ({
  page,
}) => {
  for (const viewport of [
    { width: 320, height: 700 },
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
  ]) {
    await page.setViewportSize(viewport);
    await page.reload();
    await page.evaluate(() => document.fonts.ready);
    const overflow = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      body: document.body.scrollWidth,
      graph: document.querySelector(".graph-scroll")?.scrollWidth,
      graphClient: document.querySelector(".graph-scroll")?.clientWidth,
    }));
    expect(overflow.body).toBeLessThanOrEqual(overflow.viewport);
    if (viewport.width < 640)
      expect(overflow.graph).toBeLessThanOrEqual(overflow.graphClient ?? 0);
    else expect(overflow.graph).toBeGreaterThan(overflow.graphClient ?? 0);
    await expect(page.locator(".runtime-label")).toContainText("synthetic");
    await expect(page.locator(".runtime-label")).toBeVisible();
  }
  await expect(
    page.getByRole("heading", { level: 1, name: "Memory Atlas" }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: /Evidence Trace relationship/ }),
  ).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await page.locator(".focus-node").first().click();
  await expect(page.locator('[data-inspector="focus"]')).toBeVisible();
  expect(
    await page
      .locator(".inspector-column")
      .evaluate((element) => Math.abs(element.getBoundingClientRect().top)),
  ).toBeLessThan(160);

  for (const lens of ["Conflict & Freshness", "Scope Preview"]) {
    await page.getByRole("button", { name: lens, exact: true }).click();
    const table = page.locator("[data-lens-panel]:visible .table-scroll");
    const widths = await table.evaluate((element) => ({
      scroll: element.scrollWidth,
      client: element.clientWidth,
    }));
    expect(widths.scroll).toBeLessThanOrEqual(widths.client);
  }
});
