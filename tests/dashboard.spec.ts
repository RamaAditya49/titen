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

async function mockServerMode(page: Page) {
  let connected = true;
  await page.route("**/dashboard-api/session", (route) => route.fulfill({ json: { data: {
    organization_id: "org_server", principal_id: "server_operator", principal_kind: "human", key_id: "key_server",
    scopes: ["*"], max_trust: "policy_approved", organization_role: "root",
  } } }));
  await page.route("**/dashboard-api/status", (route) => connected
    ? route.fulfill({ json: { mode: "live", endpoint: "titen.internal", authentication: "server", authenticated: true } })
    : route.fulfill({ status: 503, json: { error: { code: "DASHBOARD_DISCONNECTED", message: "disconnected" } } }));
  await page.route("**/dashboard-api/health", (route) => route.fulfill({ json: { data: { status: "ok", runtime: "bun", revision: "stable-42" } } }));
  await page.route("**/dashboard-api/readiness", (route) => route.fulfill({ json: { data: { ready: true, revision: "stable-42" } } }));
  return { disconnect: () => { connected = false; } };
}

test("starts disconnected without fixtures, secrets, storage, or external requests", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  await page.goto("/dashboard/");
  await expect(page).toHaveTitle("Titen · Operator dashboard");
  await expect(page.getByRole("heading", { level: 1, name: "Titen dashboard" })).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("same-origin dashboard adapter");
  await expect(page.locator("[data-product-nav]")).toBeHidden();
  const state = await page.evaluate(() => ({ html: document.documentElement.innerHTML, local: Object.keys(localStorage), session: Object.keys(sessionStorage) }));
  expect(state.html).not.toContain("TITEN_API_KEY='");
  expect(state.html).not.toContain("Production retry budget");
  expect(state.local).toEqual([]);
  expect(state.session).toEqual([]);
  expect(requests.every((url) => new URL(url).hostname === "127.0.0.1")).toBe(true);
});

test("renders live Memories and clears stale private data on disconnect", async ({ page }) => {
  const service = await mockServerMode(page);
  await page.route("**/dashboard-api/atlas/compile", async (route) => {
    expect(route.request().headers().authorization).toBeUndefined();
    expect(route.request().postDataJSON()).toEqual({ lens: "neighborhood", limit: 50, subject_id: "platform-team" });
    await route.fulfill({ json: { data: view } });
  });
  await page.goto("/dashboard/");
  await expect(page.getByText("Connected", { exact: true })).toBeVisible();
  await expect(page.locator("[data-area]:not([hidden])")).toHaveCount(6);
  await page.locator('[data-memory-form] input[name="subject_id"]').fill("platform-team");
  await page.getByRole("button", { name: "Compile memory view" }).click();
  await expect(page.getByText("Production retry budget is 400 ms").first()).toBeVisible();
  await expect(page.locator("[data-inspector-title]")).toHaveText("Production retry budget is 400 ms");
  await expect(page.locator("[data-relationships]")).toContainText("supports");
  await expect(page.locator("[data-metadata]")).toContainText("platform-team");
  service.disconnect();
  await page.getByRole("button", { name: "Refresh service" }).click();
  await expect(page.getByText("Disconnected", { exact: true })).toBeVisible();
  await expect(page.getByText("Production retry budget is 400 ms")).toHaveCount(0);
  await expect(page.locator("[data-inspector-title]")).toHaveText("Nothing selected");
});

test("logs in per principal, wires all six areas, adds a user once, and logs out", async ({ page }) => {
  let loggedIn = false;
  let logoutFails = true;
  const calls: string[] = [];
  const principal = {
    organization_id: "org_live",
    principal_id: "user_admin",
    principal_kind: "human",
    key_id: "key_admin",
    scopes: ["*"],
    max_trust: "policy_approved",
    organization_role: "root",
  };
  await page.route("**/dashboard-api/status", (route) => route.fulfill({ json: {
    mode: "live", endpoint: "titen.internal", authentication: "session", authenticated: loggedIn,
  } }));
  await page.route("**/dashboard-api/session", async (route) => {
    if (route.request().method() === "POST") {
      expect(route.request().postDataJSON()).toEqual({ username: "rama", password: "correct horse battery staple" });
      loggedIn = true;
      return route.fulfill({ status: 201, headers: { "set-cookie": "titen_dashboard_session=opaque; Path=/; HttpOnly; SameSite=Strict" }, json: { data: principal } });
    }
    if (route.request().method() === "DELETE") {
      if (logoutFails) {
        logoutFails = false;
        return route.fulfill({ status: 502, json: { error: { code: "UPSTREAM_UNAVAILABLE", message: "unreachable" } } });
      }
      loggedIn = false;
      return route.fulfill({ json: { data: { logged_out: true } } });
    }
    return route.fulfill({ json: { data: principal } });
  });
  await page.route("**/dashboard-api/health", (route) => route.fulfill({ json: { data: { status: "ok", runtime: "bun" } } }));
  await page.route("**/dashboard-api/readiness", (route) => route.fulfill({ json: { data: { ready: true, revision: "release-candidate" } } }));
  await page.route("**/dashboard-api/atlas/compile", (route) => route.fulfill({ json: { data: view } }));
  await page.route("**/dashboard-api/context/compile", async (route) => {
    calls.push("context");
    return route.fulfill({ json: { data: { context_id: "ctx_live", items: [{ claim_id: "clm_live", statement: "Bounded context" }], budget: { used_tokens: 42 } } } });
  });
  await page.route("**/dashboard-api/work/**", (route) => {
    calls.push(new URL(route.request().url()).pathname);
    const path = new URL(route.request().url()).pathname;
    return route.fulfill({ json: path.endsWith("leases") ? { data: { leases: [{ lease_id: "lease_live", status: "active" }] } }
      : { data: { handoffs: [{ handoff_id: "handoff_live", status: "pending" }] } } });
  });
  await page.route("**/dashboard-api/audit/**", (route) => {
    calls.push(new URL(route.request().url()).pathname);
    return route.fulfill({ json: new URL(route.request().url()).pathname.endsWith("log")
      ? { data: { entries: [{ id: "aud_live", action: "membership.add" }] } }
      : { data: { events: [{ event_id: "evt_live", kind: "lease.created" }] } } });
  });
  for (const path of ["memberships", "keys", "policies", "approvals", "channels", "releases"])
    await page.route(`**/dashboard-api/governance/${path}`, (route) => {
      calls.push(`governance/${path}`);
      return route.fulfill({ json: { data: { [path]: [{ id: `${path}_live`, status: "active" }] } } });
    });
  await page.route("**/dashboard-api/governance/users", async (route) => {
    calls.push("add-user");
    const body = route.request().postDataJSON() as Record<string, unknown>;
    expect(body.username).toBe("new.reader");
    expect(body.password).toBeUndefined();
    expect(body.role).toBe("reader");
    expect(body.scopes).toContain("views:compile");
    return route.fulfill({ status: 201, json: { data: {
      username: "new.reader", principal_id: "human_new", role: "reader", membership_id: "mbr_new",
      temporary_password: "generated temporary password", password_change_required: true,
    } } });
  });
  await page.route("**/dashboard-api/federation/peers", (route) => {
    calls.push("federation");
    return route.fulfill({ json: { data: { peers: [{ peer_id: "peer_live", status: "active" }] } } });
  });

  await page.goto("/dashboard/");
  await expect(page.getByRole("heading", { name: "Sign in", exact: true })).toBeVisible();
  await expect(page.locator(".app-shell")).toHaveAttribute("data-shell", "login");
  await expect(page.locator(".sidebar")).toBeHidden();
  await expect(page.locator(".topbar")).toBeHidden();
  await expect(page.getByLabel("Username").first()).toBeVisible();
  await page.locator('[data-login-form] input[name="username"]').fill("rama");
  await page.locator('[data-login-form] input[name="password"]').fill("correct horse battery staple");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.locator(".app-shell")).toHaveAttribute("data-shell", "private");
  await expect(page.locator(".sidebar")).toBeVisible();
  await expect(page.locator(".topbar")).toBeVisible();
  await expect(page.locator("[data-area]:not([hidden])")).toHaveCount(6);
  await expect(page.locator("[data-principal]")).toHaveText("user_admin");

  await page.locator('[data-area="context"]').click();
  await page.locator('[data-context-form] input[name="subject_id"]').fill("subject_live");
  await page.locator('[data-context-form] input[name="task"]').fill("prepare release");
  await page.getByRole("button", { name: "Compile context" }).click();
  await expect(page.getByText("Bounded context", { exact: true })).toBeVisible();

  await page.locator('[data-area="work"]').click();
  await page.getByRole("button", { name: "Refresh work" }).click();
  await expect(page.getByText("lease_live", { exact: true })).toBeVisible();
  await expect(page.getByText("handoff_live", { exact: true })).toBeVisible();

  await page.locator('[data-area="audit"]').click();
  await page.getByRole("button", { name: "Refresh activity" }).click();
  await expect(page.getByText("membership.add", { exact: true })).toBeVisible();
  await expect(page.getByText("lease.created", { exact: true })).toBeVisible();

  await page.locator('[data-area="governance"]').click();
  await page.getByRole("button", { name: "Refresh governance" }).click();
  await expect(page.getByText("memberships_live", { exact: true })).toBeVisible();
  await page.locator('[data-user-form] input[name="username"]').fill("new.reader");
  await page.getByRole("button", { name: "Create user" }).click();
  await expect(page.locator("[data-user-status]")).toContainText("Created new.reader with role reader");
  await expect(page.locator("[data-user-temporary-password]")).toHaveText("generated temporary password");

  await page.locator('[data-area="federation"]').click();
  await page.getByRole("button", { name: "Refresh peers" }).click();
  await expect(page.getByText("peer_live", { exact: true })).toBeVisible();

  const state = await page.evaluate(() => ({ local: Object.keys(localStorage), session: Object.keys(sessionStorage) }));
  expect(state).toEqual({ local: [], session: [] });
  expect(calls).toContain("context");
  expect(calls).toContain("add-user");
  expect(calls).toContain("federation");
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.locator("[data-service-notice]")).toContainText("unreachable");
  await expect(page.locator("[data-principal]")).toHaveText("user_admin");
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("heading", { name: "Sign in", exact: true })).toBeVisible();
  await expect(page.locator(".sidebar")).toBeHidden();
  await expect(page.getByText("generated temporary password")).toHaveCount(0);
});

test("forces a temporary-password login to replace its password before showing the app", async ({ page }) => {
  let authenticated = false;
  let passwordChangeRequired = true;
  const principal = () => ({
    organization_id: "org_first",
    principal_id: "owner",
    principal_kind: "human",
    key_id: "key_first",
    scopes: passwordChangeRequired ? [] : ["views:compile"],
    max_trust: "policy_approved",
    organization_role: "owner",
    password_change_required: passwordChangeRequired,
  });
  await page.route("**/dashboard-api/status", (route) => route.fulfill({ json: {
    mode: "live", endpoint: "titen.internal", authentication: "session", authenticated,
  } }));
  await page.route("**/dashboard-api/session", async (route) => {
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON() as { username: string; password: string };
      expect(body.username).toBe("owner");
      expect(body.password).toBe(passwordChangeRequired ? "temporary horse battery staple" : "permanent horse battery staple");
      authenticated = true;
      return route.fulfill({ status: 201, json: { data: principal() } });
    }
    return route.fulfill({ json: { data: principal() } });
  });
  await page.route("**/dashboard-api/password", async (route) => {
    expect(route.request().method()).toBe("PATCH");
    expect(route.request().postDataJSON()).toEqual({ password: "permanent horse battery staple" });
    passwordChangeRequired = false;
    authenticated = false;
    return route.fulfill({ json: { data: { password_changed: true, login_required: true } } });
  });
  await page.route("**/dashboard-api/health", (route) => route.fulfill({ json: { data: { status: "ok", runtime: "bun" } } }));
  await page.route("**/dashboard-api/readiness", (route) => route.fulfill({ json: { data: { ready: true } } }));

  await page.goto("/dashboard/");
  await page.locator('[data-login-form] input[name="username"]').fill("owner");
  await page.locator('[data-login-form] input[name="password"]').fill("temporary horse battery staple");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Set a new password" })).toBeVisible();
  await expect(page.locator(".sidebar")).toBeHidden();
  await expect(page.locator("[data-product-nav]")).toBeHidden();
  await page.locator('[data-password-form] input[name="password"]').fill("permanent horse battery staple");
  await page.locator('[data-password-form] input[name="confirm_password"]').fill("permanent horse battery staple");
  await page.getByRole("button", { name: "Set new password" }).click();
  await expect(page.getByRole("heading", { name: "Sign in", exact: true })).toBeVisible();
  await expect(page.locator("[data-login-status]")).toContainText("Password updated");
  await page.locator('[data-login-form] input[name="password"]').fill("permanent horse battery staple");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.locator(".app-shell")).toHaveAttribute("data-shell", "private");
  await expect(page.locator('[data-area="memories"]')).toBeVisible();
});

test("capability discovery exposes only authorized areas and clears denial state", async ({ page }) => {
  const principal = {
    organization_id: "org_audit",
    principal_id: "auditor",
    principal_kind: "human",
    key_id: "key_audit",
    scopes: ["audit:read"],
    max_trust: "asserted",
    organization_role: "reader",
  };
  await page.route("**/dashboard-api/status", (route) => route.fulfill({ json: { mode: "live", endpoint: "titen.internal", authentication: "server", authenticated: true } }));
  await page.route("**/dashboard-api/session", (route) => route.fulfill({ json: { data: principal } }));
  await page.route("**/dashboard-api/health", (route) => route.fulfill({ json: { data: { status: "ok" } } }));
  await page.route("**/dashboard-api/readiness", (route) => route.fulfill({ json: { data: { ready: true } } }));
  await page.route("**/dashboard-api/audit/log**", (route) => route.fulfill({ status: 403, json: { error: { code: "UPSTREAM_403", message: "denied" } } }));
  await page.goto("/dashboard/");
  await expect(page.locator("[data-area]:not([hidden])")).toHaveCount(1);
  await expect(page.locator('[data-area="audit"]')).toBeVisible();
  await expect(page.locator('[data-area="memories"]')).toBeHidden();
  await expect(page.locator("[data-user-admin]")).toBeHidden();
  await page.getByRole("button", { name: "Refresh activity" }).click();
  await expect(page.locator("[data-audit-output]")).toContainText("not authorized");
  await expect(page.locator("[data-audit-output]")).not.toContainText("aud_live");
});

test("remains keyboard and mobile usable with live product navigation", async ({ page }) => {
  await mockServerMode(page);
  await page.route("**/dashboard-api/atlas/compile", (route) => route.fulfill({ json: { data: view } }));
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto("/dashboard/");
  await page.getByText("Evidence trace", { exact: true }).click();
  await expect(page.getByRole("radio", { name: "Evidence trace" })).toBeChecked();
  await expect(page.getByLabel("Focus claim ID")).toHaveAttribute("required", "");
  await page.getByLabel("Focus claim ID").fill("clm_live");
  await page.getByRole("button", { name: "Compile memory view" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText("Production retry budget is 400 ms").first()).toBeVisible();
  await page.locator('[data-area="context"]').focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Compile task-specific context" })).toBeVisible();
  const width = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, body: document.body.scrollWidth }));
  expect(width.body).toBeLessThanOrEqual(width.viewport);
});
