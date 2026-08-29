import { expect, test, type Page } from "@playwright/test";

const view = {
  lens: "neighborhood",
  focus_id: null,
  nodes: [
    { id: "clm_live", type: "claim", label: "Production retry budget is 400 ms", trust: "verified", status: "active", created_at: "2026-08-01T00:00:00Z" },
    { id: "obs_live", type: "observation", label: "Measured runtime result", trust: "verified", status: "active", created_at: "2026-08-01T00:01:00Z" },
  ],
  edges: [{ from: "clm_live", to: "obs_live", relation: "supports" }],
  metadata: {
    subject_id: "platform-team",
    claim_count: 1,
    authorization: { principal_id: "server_operator", access_mode: "principal" },
  },
};

async function mockServerMode(page: Page, readiness: Record<string, unknown> = { data: { ready: true }, meta: { revision: "stable-42" } }) {
  let connected = true;
  await page.route("**/dashboard-api/memories**", (route) => route.fulfill({ json: { data: {
    items: [], page: { limit: 25, has_more: false, next_cursor: null }, query: {},
    authorization: { principal_id: "server_operator", access_mode: "principal" },
  } } }));
  await page.route("**/dashboard-api/session", (route) => route.fulfill({ json: { data: {
    organization_id: "org_server", principal_id: "server_operator", principal_kind: "human", key_id: "key_server",
    scopes: ["*"], max_trust: "policy_approved", organization_role: "root",
  } } }));
  await page.route("**/dashboard-api/status", (route) => connected
    ? route.fulfill({ json: { mode: "live", endpoint: "titen.internal", authentication: "server", authenticated: true } })
    : route.fulfill({ status: 503, json: { error: { code: "DASHBOARD_DISCONNECTED", message: "disconnected" } } }));
  await page.route("**/dashboard-api/health", (route) => route.fulfill({ json: { data: { status: "ok", runtime: "bun", revision: "stable-42" } } }));
  await page.route("**/dashboard-api/readiness", (route) => route.fulfill({ json: readiness }));
  await page.route("**/dashboard-api/workspaces", (route) => route.fulfill({ json: { data: { workspaces: [
    { workspace_id: "ws_platform", name: "platform-team", created_at: "2026-08-01T00:00:00Z" },
    { workspace_id: "ws_crm", name: "crm", created_at: "2026-08-02T00:00:00Z" },
  ] } } }));
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

test("loads Memories as a searchable list and opens one record in Atlas", async ({ page }) => {
  await mockServerMode(page);
  let compileCalls = 0;
  await page.route("**/dashboard-api/memories**", async (route) => {
    const query = new URL(route.request().url()).searchParams;
    const statement = query.get("q") ? "Rollback smoke is required before release." : "Production release keeps evidence.";
    await route.fulfill({ json: { data: {
      items: [{ id: "clm_memory", subject_id: "platform-team", project_id: null, kind: "procedural", statement,
        confidence: 0.96, trust: "verified", visibility: "organization", status: "active",
        valid_from: "2026-08-01T00:00:00Z", valid_to: null, created_at: "2026-08-01T00:00:00Z" }],
      page: { limit: 25, has_more: false, next_cursor: null }, query: {},
      authorization: { principal_id: "server_operator", access_mode: "principal" },
    } } });
  });
  await page.route("**/dashboard-api/atlas/compile", async (route) => {
    compileCalls += 1;
    expect(route.request().postDataJSON()).toEqual({ lens: "evidence_trace", limit: 50, subject_id: "platform-team", focus_id: "clm_memory" });
    await route.fulfill({ json: { data: {
      lens: "evidence_trace", focus_id: "clm_memory",
      nodes: [
        { id: "obs_live", type: "observation", label: "Measured runtime result", trust: "verified", status: "active", created_at: "2026-08-01T00:01:00Z" },
        { id: "clm_memory", type: "claim", label: "Production release keeps evidence.", trust: "verified", status: "disputed", created_at: "2026-08-01T00:00:00Z" },
        { id: "ctx_live", type: "context", label: "ctx_01J8Q7MB", trust: "compiled", status: "active", created_at: "2026-08-01T00:02:00Z" },
        { id: "rel_live", type: "release", label: "crm-web · anonymous", trust: "reviewed_snapshot", status: "active", created_at: "2026-08-01T00:03:00Z" },
      ],
      edges: [
        { from: "obs_live", to: "clm_memory", relation: "supports" },
        { from: "clm_memory", to: "ctx_live", relation: "selected-in" },
        { from: "clm_memory", to: "rel_live", relation: "released-as" },
      ],
      metadata: { authorization: { principal_id: "server_operator", access_mode: "principal" } },
    } } });
  });
  await page.goto("/dashboard/");
  await expect(page.locator("[data-memory-list-table]")).toBeVisible();
  await expect(page.getByText("Production release keeps evidence.", { exact: true })).toBeVisible();
  await page.locator("[data-memory-list-search]").fill("rollback smoke");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.getByText("Rollback smoke is required before release.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Open in Atlas" }).click();
  await expect(page.locator('[data-area="atlas"]')).toHaveAttribute("aria-current", "page");
  await expect(page.locator('[data-area="memories"]')).toHaveAttribute("aria-current", "false");
  await expect(page.locator("[data-atlas-graph]")).toBeVisible();
  await expect(page.locator("[data-atlas-nodes] .atlas-node--claim")).toHaveCount(1);
  await expect(page.locator("[data-atlas-nodes] .atlas-node--context")).toHaveCount(1);
  await expect(page.locator("[data-atlas-nodes] .atlas-node--release")).toHaveCount(1);
  await expect(page.locator("[data-atlas-edges] .atlas-edge-label")).toHaveText(["supports", "selected-in", "released-as"]);
  expect(compileCalls).toBe(1);
});

test("matches the workspace mockup and scopes live requests without storing state", async ({ page }) => {
  await mockServerMode(page);
  const memoryQueries: string[] = [];
  await page.route("**/dashboard-api/memories**", async (route) => {
    memoryQueries.push(new URL(route.request().url()).search);
    await route.fulfill({ json: { data: {
      items: [], page: { limit: 25, has_more: false, next_cursor: null }, query: {}, facets: {},
      authorization: { principal_id: "server_operator", access_mode: "principal" },
    } } });
  });
  await page.goto("/dashboard/");
  const picker = page.locator("[data-workspace-menu]");
  await expect(picker.locator("summary")).toContainText("Unscoped memory");
  await expect(picker.locator("summary")).toContainText("organization-visible memory");
  await expect(page.locator("[data-workspace-picker]")).toBeHidden();
  await picker.locator("summary").click();
  await expect(page.locator("[data-workspace-options] .workspace-option")).toHaveCount(3);
  await expect(page.locator('[data-workspace-value=""]')).toHaveAttribute("aria-current", "true");
  await page.getByRole("button", { name: /platform-team/ }).click();
  await expect(picker.locator("summary")).toContainText("platform-team");
  await expect(page.locator("[data-workspace-picker]")).toHaveValue("ws_platform");
  await expect.poll(() => memoryQueries.at(-1)).toContain("workspace_id=ws_platform");
  await expect(picker).not.toHaveAttribute("open", "");
  await picker.locator("summary").click();
  await page.keyboard.press("Escape");
  await expect(picker).not.toHaveAttribute("open", "");
  await picker.locator("summary").click();
  await page.locator(".topbar-title").click();
  await expect(picker).not.toHaveAttribute("open", "");
  expect(await page.evaluate(() => [Object.keys(localStorage), Object.keys(sessionStorage)])).toEqual([[], []]);

  await page.setViewportSize({ width: 320, height: 760 });
  await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(page.locator(".sidebar")).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, 0)");
  const box = await picker.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(320);
});

test("renders a structured project directory with contextual details", async ({ page }) => {
  await mockServerMode(page);
  await page.route("**/dashboard-api/projects**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/references")) {
      return route.fulfill({ json: { data: {
        project_id: "project_titen",
        references: [
          { namespace: "canonical", value: "ramaaditya49/titen" },
          { namespace: "git", value: "https://github.com/RamaAditya49/titen.git" },
        ],
      } } });
    }
    return route.fulfill({ json: { data: { projects: [
      {
        project_id: "project_titen",
        reference: "ramaaditya49/titen",
        created_at: "2026-08-01T00:00:00Z",
        record_count: 184,
        subject_count: 7,
        last_write: "2026-08-29T13:57:14Z",
      },
      {
        project_id: null,
        reference: "(unscoped)",
        created_at: null,
        record_count: 24,
        subject_count: 2,
        last_write: "2026-08-28T09:12:11Z",
      },
    ] } } });
  });

  await page.goto("/dashboard/");
  await page.getByRole("button", { name: "Projects" }).click();

  const output = page.locator("[data-projects-output]");
  await expect(output.getByRole("columnheader")).toHaveText([
    "Reference", "Scope", "Records", "Subjects", "Last write", "Action",
  ]);
  await expect(output.getByText("ramaaditya49/titen", { exact: true })).toBeVisible();
  await expect(output.getByText("Unscoped", { exact: true })).toBeVisible();
  await expect(output).not.toContainText("Record 1");
  const payload = output.getByText("Technical payload", { exact: true });
  await expect(payload).toBeVisible();
  await expect(payload.locator("xpath=..")).not.toHaveAttribute("open", "");

  await output.getByRole("button", { name: "Inspect ramaaditya49/titen" }).click();
  const details = page.locator("[data-project-references]");
  await expect(details).toContainText("project_titen");
  await expect(details).toContainText("canonical");
  await expect(details).toContainText("https://github.com/RamaAditya49/titen.git");

  await page.setViewportSize({ width: 320, height: 700 });
  const width = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, body: document.body.scrollWidth }));
  expect(width.body).toBeLessThanOrEqual(width.viewport);
});

test("clears structured private data after a disconnect", async ({ page }) => {
  const service = await mockServerMode(page);
  await page.route("**/dashboard-api/projects**", (route) => route.fulfill({ json: { data: { projects: [{
    project_id: "private_project",
    reference: "internal/private-project",
    record_count: 91,
    subject_count: 4,
    last_write: "2026-08-29T13:57:14Z",
  }] } } }));

  await page.goto("/dashboard/");
  await page.getByRole("button", { name: "Projects" }).click();
  await expect(page.locator("[data-projects-output]")).toContainText("internal/private-project");
  service.disconnect();
  await page.getByRole("button", { name: "Refresh service" }).click();
  await expect(page.locator("[data-projects-output]")).not.toContainText("internal/private-project");
  await expect(page.locator("[data-projects-output]")).toContainText("No live data loaded");
});

test("renders subject identities with canonical references", async ({ page }) => {
  await mockServerMode(page);
  await page.route("**/dashboard-api/subjects**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/references")) {
      return route.fulfill({ json: { data: {
        subject_id: "user:rama",
        references: [
          { namespace: "canonical", value: "user:rama" },
          { namespace: "account", value: "ramaaditya49" },
        ],
      } } });
    }
    return route.fulfill({ json: { data: { subjects: [{
      subject_id: "user:rama",
      label: "Rama Aditya",
      type: "human",
      reference_count: 2,
      created_at: "2026-08-01T00:00:00Z",
    }] } } });
  });

  await page.goto("/dashboard/");
  await page.getByRole("button", { name: "Subjects" }).click();

  const output = page.locator("[data-subjects-output]");
  await expect(output.getByRole("columnheader")).toHaveText([
    "Identity", "Type", "References", "Created", "Action",
  ]);
  await output.getByRole("button", { name: "Inspect Rama Aditya" }).click();
  const details = page.locator("[data-subject-references]");
  await expect(details).toContainText("user:rama");
  await expect(details).toContainText("ramaaditya49");
  await expect(output).not.toContainText("Record 1");
});

test("separates federation peers from the exchange log", async ({ page }) => {
  await mockServerMode(page);
  await page.route("**/dashboard-api/federation/peers", (route) => route.fulfill({ json: { data: { peers: [{
    peer_id: "peer_primary",
    name: "Primary VPS",
    endpoint: "https://titen.internal",
    direction: "bidirectional",
    source_org_id: "org_remote",
    status: "active",
    last_sync_at: "2026-08-29T13:57:14Z",
  }] } } }));
  await page.route("**/dashboard-api/federation/log**", (route) => route.fulfill({ json: { data: { entries: [{
    id: "exchange_01",
    direction: "received",
    resource_type: "claim",
    resource_id: "clm_remote",
    status: "success",
    created_at: "2026-08-29T14:01:02Z",
  }] } } }));

  await page.goto("/dashboard/");
  await page.getByRole("button", { name: "Federation" }).click();
  await page.getByRole("button", { name: "Refresh peers" }).click();

  const output = page.locator("[data-federation-output]");
  await expect(output.locator('[data-collection="peers"] h3')).toHaveText("Federation peers");
  await expect(output.getByRole("columnheader")).toHaveText([
    "Peer", "Endpoint", "Direction", "Source organization", "Status", "Last sync", "Action",
  ]);
  await expect(output).toContainText("Primary VPS");
  await expect(output).toContainText("org_remote");

  await page.locator('[data-federation-form] input[name="peer_id"]').fill("peer_primary");
  await page.locator("[data-federation-form]").getByRole("button", { name: "Load peer log" }).click();
  await expect(output.locator('[data-collection="federation_entries"] h3')).toHaveText("Exchange log");
  await expect(output.getByRole("columnheader")).toHaveText([
    "ID", "Direction", "Resource", "Resource ID", "Status", "Time", "Action",
  ]);
  await expect(output).toContainText("exchange_01");
  await expect(output).not.toContainText("Metadata activity");
});

test("renders structured administration and diagnostic facts", async ({ page }) => {
  await mockServerMode(page, { data: {
    ready: true,
    revision: "release-candidate",
    checks: { database: "ok", semantic_index: "current" },
    capabilities: { vector: "enabled", extraction: "configured" },
  } });
  await page.route("**/dashboard-api/access/principals", (route) => route.fulfill({ json: { data: { principals: [{
    principal_id: "user_editor",
    username: "editor",
    principal_kind: "human",
    organization_role: "member",
    max_trust: "verified",
    status: "active",
  }] } } }));
  await page.route("**/dashboard-api/access/grants**", (route) => route.fulfill({ json: { data: { grants: [{
    grant_id: "grant_editor",
    principal_id: "user_editor",
    target_type: "project",
    target_id: "project_titen",
    permissions: ["read", "write"],
    status: "active",
  }] } } }));
  await page.route("**/dashboard-api/governance/keys", (route) => route.fulfill({ json: { data: { keys: [{
    key_id: "key_editor",
    label: "Editor CLI",
    principal_id: "user_editor",
    scopes: ["views:compile", "context:compile"],
    max_trust: "verified",
    data_target_type: "project",
    data_target_id: "project_titen",
    status: "active",
  }] } } }));
  await page.route("**/dashboard-api/models/config", (route) => route.fulfill({ json: { data: {
    extraction: { model: "qwen3-30b", provider: "openai-compatible", api_key: "set", response_mode: "json_object" },
    embedding: { model: "embeddinggemma", dimensions: 768, api_key: "set", profile: "balanced" },
  } } }));

  await page.goto("/dashboard/");
  await page.getByRole("button", { name: "System" }).click();
  await expect(page.locator('[data-system-checks] .operator-facts h3')).toHaveText(["Checks", "Capabilities"]);
  await expect(page.locator("[data-system-checks]")).toContainText("Database");
  await expect(page.locator("[data-system-checks]")).toContainText("enabled");

  await page.getByRole("button", { name: "Models" }).click();
  await expect(page.locator("[data-extraction-model]")).toContainText("qwen3-30b");
  await expect(page.locator("[data-embedding-model]")).toContainText("embeddinggemma");
  await expect(page.locator("[data-extraction-model] details")).not.toHaveAttribute("open", "");

  await page.getByRole("button", { name: "Access" }).click();
  await expect(page.locator('[data-collection="principals"] h3')).toHaveText("Principals");
  await page.locator("[data-access-principal]").selectOption("user_editor");
  const grantRow = page.locator('[data-collection="grants"] tbody tr').filter({ hasText: "grant_editor" });
  await expect(grantRow.getByRole("button", { name: "Revoke grant_editor" })).toBeVisible();

  await page.getByRole("button", { name: "API & Keys" }).click();
  const keyRow = page.locator('[data-collection="keys"] tbody tr').filter({ hasText: "Editor CLI" });
  await expect(keyRow.getByRole("button", { name: "Revoke Editor CLI" })).toBeVisible();
  await expect(keyRow).toContainText("views:compile");
});

test("renders live Memories and clears stale private data on disconnect", async ({ page }) => {
  const service = await mockServerMode(page);
  await page.route("**/dashboard-api/atlas/compile", async (route) => {
    expect(route.request().headers().authorization).toBeUndefined();
    expect(route.request().postDataJSON()).toEqual({ lens: "neighborhood", limit: 50, subject_id: "platform-team" });
    await route.fulfill({ json: { data: view } });
  });
  await page.goto("/dashboard/");
  await expect(page.locator("[data-connection-label]")).toHaveText("Connected");
  await expect(page.locator("[data-system-revision]")).toHaveText("stable-42");
  await expect(page.locator("[data-area]:not([hidden])")).toHaveCount(14);
  await page.getByRole("button", { name: "Atlas live" }).click();
  await page.getByText("Neighborhood", { exact: true }).click();
  await page.locator('[data-memory-form] input[name="subject_id"]').fill("platform-team");
  await page.getByRole("button", { name: "Compile authorized graph" }).click();
  await expect(page.getByText("Production retry budget is 400 ms").first()).toBeVisible();
  await expect(page.locator("[data-inspector-title]")).toHaveText("Production retry budget is 400 ms");
  await expect(page.locator("[data-relationships]")).toContainText("supports");
  await expect(page.locator("[data-metadata]")).toContainText("platform-team");
  await expect(page.locator("[data-atlas-graph]")).toBeVisible();
  await expect(page.locator("[data-atlas-nodes] .atlas-node")).toHaveCount(2);
  await expect(page.locator("[data-atlas-edges] path")).toHaveCount(1);
  await expect(page.locator("[data-compile-trace]")).toBeVisible();
  await page.getByRole("button", { name: "Memories query" }).click();
  await expect(page.locator('[data-area="memories"]')).toHaveAttribute("aria-current", "page");
  await expect(page.locator('[data-area="atlas"]')).toHaveAttribute("aria-current", "false");
  await page.getByRole("button", { name: "Atlas live" }).click();
  await expect(page.locator('[data-area="atlas"]')).toHaveAttribute("aria-current", "page");
  await expect(page.locator('[data-area="memories"]')).toHaveAttribute("aria-current", "false");
  await page.getByRole("button", { name: "System" }).click();
  await expect(page.locator('[data-area-panel="system"] h2')).toHaveText("System status");
  await page.getByRole("button", { name: "Access" }).click();
  await expect(page.locator('[data-area-panel="access"] h2')).toHaveText("Scoped access control");
  await page.getByRole("button", { name: "Releases" }).click();
  await expect(page.locator('[data-area-panel="releases"] h2')).toHaveText("Release policy");
  await page.getByRole("button", { name: "Atlas" }).click();
  await expect(page.locator('[data-area-panel="atlas"] h2').first()).toHaveText("Memory Atlas");
  await page.locator("[data-profile-open]").click();
  await expect(page.locator('[data-area-panel="profile"] h2')).toHaveText("Profile");
  await expect(page.locator("[data-profile-password-form]")).toBeHidden();
  await expect(page.locator("[data-profile-password-note]")).toContainText("session-authenticated");
  service.disconnect();
  await page.getByRole("button", { name: "Refresh service" }).click();
  await expect(page.getByText("Disconnected", { exact: true })).toBeVisible();
  await expect(page.getByText("Production retry budget is 400 ms")).toHaveCount(0);
  await expect(page.locator("[data-inspector-title]")).toHaveText("Nothing selected");
  await expect(page.locator("[data-workspace-control]")).toBeHidden();
  await expect(page.locator("[data-workspace-options] .workspace-option")).toHaveCount(1);
});

test("explains principal-scoped empty results and explicitly audits administrator mode", async ({ page }) => {
  await mockServerMode(page);
  const requests: Record<string, unknown>[] = [];
  await page.route("**/dashboard-api/atlas/compile", async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    requests.push(body);
    const accessMode = body.access_mode === "organization_admin" ? "organization_admin" : "principal";
    await route.fulfill({ json: { data: {
      lens: "neighborhood",
      focus_id: null,
      nodes: [],
      edges: [],
      metadata: {
        subject_id: body.subject_id,
        claim_count: 0,
        authorization: { principal_id: "server_operator", access_mode: accessMode },
      },
    } } });
  });
  await page.goto("/dashboard/");
  await page.getByRole("button", { name: "Atlas live" }).click();
  await page.getByText("Neighborhood", { exact: true }).click();
  await expect(page.locator("[data-admin-view]")).toBeVisible();
  await page.locator('[data-memory-form] input[name="subject_id"]').fill("foreign-private-subject");
  await page.getByRole("button", { name: "Compile authorized graph" }).click();
  await expect(page.locator("[data-memory-empty] strong")).toHaveText("No records are visible to principal server_operator.");
  await expect(page.locator("[data-memory-empty] p")).toContainText("principal-scoped query succeeded");
  await expect(page.locator("[data-memory-empty]")).not.toContainText("globally empty");
  await expect(page.locator("[data-trace-scope]")).toHaveText("principal-scoped · server_operator");

  await page.getByLabel("Organization administrator view").check();
  await page.getByLabel("Audit reason").selectOption("recovery");
  await page.getByRole("button", { name: "Compile authorized graph" }).click();
  expect(requests).toEqual([
    { lens: "neighborhood", limit: 50, subject_id: "foreign-private-subject" },
    {
      lens: "neighborhood",
      limit: 50,
      subject_id: "foreign-private-subject",
      access_mode: "organization_admin",
      administrator_reason: "recovery",
    },
  ]);
  await expect(page.locator("[data-trace-scope]")).toHaveText("organization administrator · server_operator");
});

test("reports normal semantic projection lag as ready and syncing", async ({ page }) => {
  await mockServerMode(page, { data: {
    ready: true,
    revision: "syncing-42",
    checks: { semantic_index: "index_projection_pending" },
    capabilities: { vector: "enabled" },
  } });
  await page.goto("/dashboard/");
  await expect(page.locator("[data-readiness]")).toHaveText("Ready · semantic syncing");
  await expect(page.locator("[data-system-readiness]")).toHaveText("Ready · semantic syncing");
  await expect(page.locator("[data-service-notice]")).toContainText("Canonical requests are ready");
  await expect(page.locator("[data-service-notice]")).not.toContainText("Product requests may fail");
});

test("logs in per principal, wires all fifteen destinations, adds a user once, and logs out", async ({ page }) => {
  let loggedIn = false;
  let logoutFails = true;
  let handoffStatus = "pending";
  let approvalStatus = "pending";
  let releaseStatus = "draft";
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
      expect(route.request().postDataJSON()).toEqual({ username: "owner", password: "correct horse battery staple" });
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
    const path = new URL(route.request().url()).pathname;
    calls.push(path);
    if (route.request().method() === "POST" && path.endsWith("/resolve")) {
      handoffStatus = String(route.request().postDataJSON().status);
      calls.push(`handoff:${handoffStatus}`);
      return route.fulfill({ json: { data: { handoff_id: "handoff_live", status: handoffStatus } } });
    }
    return route.fulfill({ json: path.endsWith("leases") ? { data: { leases: [{ lease_id: "lease_live", resource_id: "subject_live", holder_id: "user_admin", status: "active" }] } }
      : { data: { handoffs: handoffStatus === "pending" ? [{ handoff_id: "handoff_live", subject_id: "subject_live", to_principal: "user_admin", status: handoffStatus }] : [] } } });
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
      const row = path === "approvals" ? { approval_id: "approval_live", claim_id: "clm_live", status: approvalStatus, version: approvalStatus === "pending" ? 1 : 2 }
        : path === "releases" ? { release_id: "release_live", status: releaseStatus, version: releaseStatus === "draft" ? 1 : 2 }
        : { id: `${path}_live`, status: "active" };
      return route.fulfill({ json: { data: { [path]: [row] } } });
    });
  await page.route("**/dashboard-api/approvals/approval_live/decide", (route) => {
    const body = route.request().postDataJSON();
    approvalStatus = body.decision === "approve" ? "approved" : body.decision;
    calls.push(`approval:${body.decision}`);
    return route.fulfill({ json: { data: { approval_id: "approval_live", status: approvalStatus, version: 2 } } });
  });
  await page.route("**/dashboard-api/releases/release_live/approve", (route) => {
    expect(route.request().postDataJSON().expected_version).toBe(1);
    releaseStatus = "approved";
    calls.push("release:approve");
    return route.fulfill({ json: { data: { release_id: "release_live", status: releaseStatus, version: 2 } } });
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
  await page.route("**/dashboard-api/access/principals", (route) => route.fulfill({ json: { data: { principals: [] } } }));
  await page.route("**/dashboard-api/access/grants**", (route) => route.fulfill({ json: { data: { grants: [] } } }));

  await page.goto("/dashboard/");
  await expect(page.getByRole("heading", { name: "Sign in", exact: true })).toBeVisible();
  await expect(page.locator(".app-shell")).toHaveAttribute("data-shell", "login");
  await expect(page.locator(".sidebar")).toBeHidden();
  await expect(page.locator(".topbar")).toBeHidden();
  await expect(page.getByLabel("Username").first()).toBeVisible();
  await expect(page.locator('[data-login-form] input[name="username"]')).toHaveAttribute("placeholder", "owner");
  await page.locator('[data-login-form] input[name="username"]').fill("owner");
  await page.locator('[data-login-form] input[name="password"]').fill("correct horse battery staple");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.locator(".app-shell")).toHaveAttribute("data-shell", "private");
  await expect(page.locator(".sidebar")).toBeVisible();
  await expect(page.locator(".topbar")).toBeVisible();
  await expect(page.locator("[data-area]:not([hidden])")).toHaveCount(14);
  await expect(page.locator("[data-principal]")).toHaveText("user_admin");

  await page.locator('[data-area="context"]').click();
  await page.locator('[data-context-form] input[name="subject_id"]').fill("subject_live");
  await page.locator('[data-context-form] input[name="task"]').fill("prepare release");
  await page.getByRole("button", { name: "Compile context" }).click();
  await expect(page.getByText("Bounded context", { exact: true })).toBeVisible();
  await expect(page.locator('[data-collection="items"] h3')).toHaveText("Selected context items");

  await page.locator('[data-area="work"]').click();
  await page.getByRole("button", { name: "Refresh work" }).click();
  await expect(page.getByText("lease_live", { exact: true })).toBeVisible();
  await expect(page.getByText("handoff_live", { exact: true })).toBeVisible();
  await expect(page.locator('[data-collection="leases"] h3')).toHaveText("Active leases");
  await expect(page.locator('[data-collection="handoffs"] h3')).toHaveText("Handoffs");
  const handoffRow = page.locator('[data-collection="handoffs"] tbody tr').filter({ hasText: "subject_live" });
  await expect(handoffRow.getByRole("button", { name: "Accept handoff · subject_live" })).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await handoffRow.getByRole("button", { name: "Accept handoff · subject_live" }).click();
  await expect.poll(() => calls.includes("handoff:accepted")).toBe(true);

  await page.locator('[data-area="audit"]').click();
  await page.getByRole("button", { name: "Refresh activity" }).click();
  await expect(page.getByText("membership.add", { exact: true })).toBeVisible();
  await expect(page.getByText("lease.created", { exact: true })).toBeVisible();
  await expect(page.locator('[data-collection="entries"] h3')).toHaveText("Metadata activity");
  await expect(page.locator('[data-collection="events"] h3')).toHaveText("Domain events");

  await page.locator('[data-area="governance"]').click();
  await page.getByRole("button", { name: "Refresh governance" }).click();
  await expect(page.getByText("policies_live", { exact: true })).toBeVisible();
  const approvalRow = page.locator('[data-collection="approvals"] tbody tr').filter({ hasText: "clm_live" });
  await expect(approvalRow.getByRole("button", { name: "Approve · clm_live" })).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept("Independent browser review passed."));
  await approvalRow.getByRole("button", { name: "Approve · clm_live" }).click();
  await expect.poll(() => calls.includes("approval:approve")).toBe(true);
  await page.locator('[data-area="releases"]').click();
  await page.getByRole("button", { name: "Refresh releases" }).click();
  const releaseRow = page.locator('[data-collection="releases"] tbody tr').filter({ hasText: "release_live" });
  await expect(releaseRow.getByRole("button", { name: "Approve · release_live" })).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept("Release wording reviewed."));
  await releaseRow.getByRole("button", { name: "Approve · release_live" }).click();
  await expect.poll(() => calls.includes("release:approve")).toBe(true);
  await page.locator('[data-area="access"]').click();
  await page.locator('[data-user-form] input[name="username"]').fill("new.reader");
  await page.getByRole("button", { name: "Create user" }).click();
  await expect(page.locator("[data-user-status]")).toContainText("Created new.reader with role reader");
  await expect(page.locator("[data-user-temporary-password]")).toHaveText("generated temporary password");

  await page.locator('[data-area="federation"]').click();
  await page.getByRole("button", { name: "Refresh peers" }).click();
  await expect(page.getByText("peer_live", { exact: true })).toBeVisible();
  await expect(page.locator('[data-collection="peers"] h3')).toHaveText("Federation peers");

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
  await expect(page.locator('[data-area="memories"]:not([hidden])').first()).toBeVisible();
  await page.locator("[data-profile-open]").click();
  await expect(page.locator('[data-area-panel="profile"] h2')).toHaveText("Profile");
  await page.locator('[data-profile-password-form] input[name="password"]').fill("permanent horse battery staple");
  await page.locator('[data-profile-password-form] input[name="confirm_password"]').fill("permanent horse battery staple");
  await page.getByRole("button", { name: "Update password" }).click();
  await expect(page.getByRole("heading", { name: "Sign in", exact: true })).toBeVisible();
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
  await expect(page.locator("[data-area]:not([hidden])")).toHaveCount(2);
  await expect(page.locator('[data-area="audit"]')).toBeVisible();
  await expect(page.locator('[data-area="memories"]').first()).toBeHidden();
  await expect(page.locator('[data-area="system"]')).toBeVisible();
  await expect(page.locator('[data-area="access"]')).toBeHidden();
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
  await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(page.getByRole("button", { name: "Open navigation" })).toHaveAttribute("aria-expanded", "true");
  await page.getByRole("button", { name: "Atlas live" }).click();
  await page.getByText("Evidence trace", { exact: true }).click();
  await expect(page.getByRole("radio", { name: "Evidence trace" })).toBeChecked();
  await expect(page.getByLabel("Focus claim ID")).toHaveAttribute("required", "");
  await page.getByLabel("Focus claim ID").fill("clm_live");
  await page.getByRole("button", { name: "Compile authorized graph" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText("Production retry budget is 400 ms").first()).toBeVisible();
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.locator('[data-area="context"]').focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Compile task-specific context" })).toBeVisible();
  const width = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, body: document.body.scrollWidth }));
  expect(width.body).toBeLessThanOrEqual(width.viewport);
});
