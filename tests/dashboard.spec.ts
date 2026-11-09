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

test("renders the Javanese wordmark with a bundled font as hidden decoration", async ({ page }) => {
  const fontRequests: { url: string; status: number }[] = [];
  page.on("response", (response) => {
    if (/noto-sans-javanese-javanese.*\.woff2/.test(response.url())) fontRequests.push({ url: response.url(), status: response.status() });
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/dashboard/");
  const wordmark = page.locator("span.javanese");
  await expect(wordmark).toBeVisible();
  await expect(wordmark).toHaveAttribute("aria-hidden", "true");
  await expect(wordmark).not.toHaveAttribute("title", /.*/);
  const loaded = await page.evaluate(async () => {
    await document.fonts.ready;
    return document.fonts.check('600 15px "Noto Sans Javanese Variable"', "ꦠꦶꦠꦺꦤ꧀");
  });
  expect(loaded).toBe(true);
  expect(fontRequests.length).toBeGreaterThan(0);
  expect(fontRequests.every((item) => item.status === 200 && new URL(item.url).hostname === "127.0.0.1")).toBe(true);
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
  await page.route("**/dashboard-api/governance/keys**", (route) => route.fulfill({ json: { data: { keys: [{
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

async function routeTwoKeys(page: Page) {
  await page.route("**/dashboard-api/governance/keys**", (route) => route.fulfill({ json: { data: { keys: [
    { key_id: "key_owner", label: "owner", principal_id: "server_operator", scopes: ["*"], max_trust: "verified", status: "active" },
    { key_id: "key_session", label: "Dashboard session", principal_id: "server_operator", scopes: ["views:compile"], max_trust: "verified", status: "active" },
  ] } } }));
}
async function rowActionRects(page: Page) {
  return page.locator('[data-collection="keys"] tbody tr').evaluateAll((rows) => rows.map((row) =>
    [...row.querySelectorAll(".collection-actions button")].map((button) => {
      const rect = button.getBoundingClientRect();
      return { name: button.textContent ?? "", danger: button.classList.contains("danger-action"), x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    })));
}

test("collection row actions meet the 24px target size and keep Revoke away from Inspect", async ({ page }) => {
  await mockServerMode(page);
  await routeTwoKeys(page);
  await page.goto("/dashboard/#api");
  for (const width of [1440, 1024, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.locator('[data-collection="keys"] tbody tr')).toHaveCount(2);
    const rows = await rowActionRects(page);
    for (const actions of rows) {
      expect(actions.length).toBeGreaterThanOrEqual(2);
      for (const action of actions) {
        expect(action.height, `${action.name} at ${width}px`).toBeGreaterThanOrEqual(24);
        expect(action.width, `${action.name} at ${width}px`).toBeGreaterThanOrEqual(24);
      }
      const inspect = actions.find((action) => action.name.startsWith("Inspect"))!;
      const revoke = actions.find((action) => action.danger)!;
      // 2.5.8: a 24px circle centred on Inspect must not reach Revoke's target.
      const cx = inspect.x + inspect.width / 2;
      const cy = inspect.y + inspect.height / 2;
      const dx = Math.max(revoke.x - cx, 0, cx - (revoke.x + revoke.width));
      const dy = Math.max(revoke.y - cy, 0, cy - (revoke.y + revoke.height));
      expect(Math.hypot(dx, dy), `Inspect to Revoke at ${width}px`).toBeGreaterThanOrEqual(12);
    }
  }
  await page.locator("[data-logout]").evaluate((button) => { (button as HTMLButtonElement).hidden = false; });
  const disconnect = (await page.locator("[data-logout]").boundingBox())!;
  expect(disconnect.height).toBeGreaterThanOrEqual(24);
});

test("collection row actions grow to 44px for a coarse pointer", async ({ browser }) => {
  const context = await browser.newContext({ hasTouch: true, viewport: { width: 390, height: 900 } });
  const page = await context.newPage();
  await mockServerMode(page);
  await routeTwoKeys(page);
  await page.goto("/dashboard/#api");
  await expect(page.locator('[data-collection="keys"] tbody tr')).toHaveCount(2);
  expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(true);
  for (const actions of await rowActionRects(page))
    for (const action of actions) expect(action.height, action.name).toBeGreaterThanOrEqual(44);
  await context.close();
});

test("Work, Federation, Approvals and Releases load on open and reference panes keep their prompts", async ({ page }) => {
  await mockServerMode(page);
  const requested: string[] = [];
  const record = (path: string, body: Record<string, unknown>) => page.route(`**/dashboard-api/${path}`, (route) => {
    requested.push(path);
    return route.fulfill({ json: { data: body } });
  });
  await record("work/leases**", { leases: [] });
  await record("work/handoffs", { handoffs: [] });
  await record("federation/peers", { peers: [] });
  await record("governance/policies", { policies: [] });
  await record("governance/approvals", { approvals: [] });
  await record("governance/releases", { releases: [] });
  await record("subjects**", { subjects: [{ subject_id: "team:shared", label: "Shared" }] });
  await page.goto("/dashboard/");

  for (const [area, output, paths] of [
    ["work", "[data-work-output]", ["work/leases**", "work/handoffs"]],
    ["federation", "[data-federation-output]", ["federation/peers"]],
    ["governance", "[data-governance-output]", ["governance/policies", "governance/approvals"]],
    ["releases", "[data-releases-output]", ["governance/releases"]],
  ] as const) {
    await page.locator(`[data-area="${area}"]`).click();
    for (const path of paths) await expect.poll(() => requested.includes(path), `${area} requests ${path}`).toBe(true);
    await expect(page.locator(`${output} .operator-collection`).first()).toBeVisible();
    await expect(page.locator(output)).not.toContainText("No live data loaded for this principal");
  }

  await page.locator('[data-area="subjects"]').click();
  await expect(page.locator('[data-collection="subjects"] tbody tr')).toHaveCount(1);
  await expect(page.locator("[data-subject-references]")).toHaveText("Select a subject to inspect its canonical references.");
});

test("System lists failing readiness checks first, names them, and shows each capability once", async ({ page }) => {
  await mockServerMode(page, { error: { code: "NOT_READY", message: "Service is not ready." }, data: {
    ready: false,
    checks: {
      canonical_sql: "ok",
      migrations: "invalid or pending (applied 26, expected 27)",
      signing_secrets: "ok",
      webauthn: "disabled",
      semantic_index: "disabled",
      extraction: "enabled",
      background_enrichment: "enabled",
      enrichment_jobs: { state: "terminal_error" },
    },
    capabilities: { version: 3, fts: "enabled", vector: "disabled", embedding: "disabled", extraction: "enabled", background_enrichment: "enabled", model: "disabled", webauthn: "disabled" },
  } });
  await page.route("**/dashboard-api/readiness", (route) => route.fulfill({ status: 503, json: { error: { code: "NOT_READY", message: "Service is not ready." }, data: {
    ready: false,
    checks: {
      canonical_sql: "ok",
      migrations: "invalid or pending (applied 26, expected 27)",
      signing_secrets: "ok",
      webauthn: "disabled",
      semantic_index: "disabled",
      extraction: "enabled",
      background_enrichment: "enabled",
      enrichment_jobs: { state: "terminal_error" },
    },
    capabilities: { version: 3, fts: "enabled", vector: "disabled", embedding: "disabled", extraction: "enabled", background_enrichment: "enabled", model: "disabled", webauthn: "disabled" },
  } } }));
  await page.goto("/dashboard/");
  await page.getByRole("button", { name: "System" }).click();
  const checks = page.getByRole("list", { name: "Readiness checks" }).locator("li");
  await expect(checks.nth(0)).toHaveAttribute("data-state", "error");
  await expect(checks.nth(1)).toHaveAttribute("data-state", "error");
  const failing = page.locator('.check-list li[data-state="error"]');
  await expect(failing.locator("strong")).toHaveText(["Migrations", "Enrichment Jobs"]);
  await expect(failing.first().locator(".check-state")).toHaveText("Failing");
  await expect(failing.first()).toContainText("invalid or pending (applied 26, expected 27)");
  await expect(failing.nth(1)).toContainText("titen jobs list --status terminal_error");
  await expect(page.locator("[data-service-notice]")).toHaveText("Not ready: migrations, enrichment jobs failing. Open System for details.");
  // The technical payload keeps the raw JSON; the visible lists must not.
  expect((await page.locator("[data-system-checks] > section").allTextContents()).join(" ")).not.toContain('{"state"');

  const visible = page.locator("[data-system-checks] > section .check-list strong");
  const labels = await visible.allTextContents();
  for (const label of ["Extraction", "Background Enrichment", "Webauthn", "Embedding"])
    expect(labels.filter((value) => value === label), label).toHaveLength(1);
  expect(labels).not.toContain("Model");
  expect(labels).not.toContain("Version");
});

test("Access previews only the selected principal's active key clamps, bounded, with a status column", async ({ page }) => {
  await mockServerMode(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  const keyRequests: URLSearchParams[] = [];
  const key = (index: number, status: string) => ({
    key_id: `key_${status}_${index}`, label: status === "active" ? `Agent key ${index}` : "Dashboard session",
    principal_id: "agent_a", scopes: ["views:compile"], max_trust: "asserted", status, data_target_type: "organization",
  });
  const active = Array.from({ length: 12 }, (_, index) => key(index, "active"));
  const expired = Array.from({ length: 40 }, (_, index) => key(index, "expired"));
  await page.route("**/dashboard-api/access/principals**", (route) => route.fulfill({ json: { data: { principals: [
    { principal_id: "agent_a", principal_kind: "agent", username: null, key_count: 12 },
  ] } } }));
  await page.route("**/dashboard-api/access/grants**", (route) => route.fulfill({ json: { data: { grants: [] } } }));
  await page.route("**/dashboard-api/governance/keys**", (route) => {
    const query = new URL(route.request().url()).searchParams;
    keyRequests.push(query);
    const keys = query.get("status") === "active" ? active : [...active, ...expired];
    return route.fulfill({ json: { data: { keys, next_cursor: null } } });
  });
  await page.goto("/dashboard/#access");
  await expect(page.locator("[data-key-clamp-prompt]")).toHaveText("Select a principal to preview its key clamps.");
  await expect(page.locator('[data-collection="key_clamp_preview"]')).toHaveCount(0);
  expect(keyRequests, "no organization-wide key download before a principal is chosen").toHaveLength(0);

  await page.locator("[data-access-principal]").selectOption("agent_a");
  const preview = page.locator('[data-collection="key_clamp_preview"]');
  await expect(preview.locator("tbody tr")).toHaveCount(10);
  expect(keyRequests.every((query) => query.get("principal_id") === "agent_a")).toBe(true);
  expect(keyRequests.some((query) => query.get("status") === "active")).toBe(true);
  await expect(preview.locator("thead")).toContainText("Status");
  await expect(preview.locator('tbody td[data-label="Status"]').first()).toHaveText("active");
  const footer = preview.locator("[data-key-clamp-footer]");
  await expect(footer.getByRole("status")).toHaveText("Showing 10 of 12 active keys.");
  await expect(footer.getByRole("button", { name: "Include expired and revoked (40)" })).toBeVisible();
  const panelTop = (await page.locator('[data-area-panel="access"]').boundingBox())!.y;
  const simulatorTop = (await page.locator("[data-access-simulator]").boundingBox())!.y;
  expect(simulatorTop - panelTop).toBeLessThan(5000);

  await footer.getByRole("button", { name: "Show all 12 active keys" }).click();
  await expect(preview.locator("tbody tr")).toHaveCount(12);
  await preview.locator("[data-key-clamp-footer]").getByRole("button", { name: "Include expired and revoked (40)" }).click();
  await expect(preview.locator("[data-key-clamp-footer]").getByRole("status")).toHaveText("Showing 10 of 52 keys.");
  await preview.locator("[data-key-clamp-footer]").getByRole("button", { name: "Show all 52 keys" }).click();
  await expect(preview.locator("tbody tr")).toHaveCount(52);
  await expect(preview.locator('tbody td[data-label="Status"]', { hasText: "expired" })).toHaveCount(40);
});

test("Models disables probes for unconfigured providers and names the real failure", async ({ page }) => {
  await mockServerMode(page);
  let extractionState = "disabled";
  await page.route("**/dashboard-api/models/config", (route) => route.fulfill({ json: { data: {
    immutable_startup_snapshot: true,
    extraction: { state: extractionState, response_mode: "json_schema", api_key: "unset" },
    embedding: { state: "disabled", vector_state: "disabled", api_key: "unset" },
  } } }));
  let probes = 0;
  await page.route("**/dashboard-api/models/probe", (route) => {
    probes += 1;
    return route.fulfill({ status: 429, json: { error: { code: "PROBE_RATE_LIMITED", message: "Wait ten seconds before probing a model provider again." } } });
  });
  await page.goto("/dashboard/#models");
  const extraction = page.locator('[data-model-probe="extraction"]');
  const embedding = page.locator('[data-model-probe="embedding"]');
  await expect(extraction).toBeDisabled();
  await expect(embedding).toBeDisabled();
  await expect(page.locator('[data-model-probe-note="extraction"]')).toHaveText("Not configured. Set TITEN_EXTRACT_* and restart to enable probing.");
  await expect(embedding).toHaveAccessibleDescription("Not configured. Set TITEN_EMBED_* and restart to enable probing.");
  await expect(page.locator("[data-model-env]")).toHaveText("# FTS-only mode; no model tuple configured.");

  extractionState = "enabled";
  await page.getByRole("button", { name: "Refresh configuration" }).click();
  await expect(extraction).toBeEnabled();
  await expect(embedding).toBeDisabled();
  await extraction.click();
  await expect(page.locator("[data-model-status]")).toHaveText("Wait ten seconds before probing a model provider again.");
  await expect(page.locator("[data-model-status]")).not.toContainText("sign-in");
  await expect(extraction).toBeDisabled();
  await expect(extraction).toHaveText(/Probe extraction again in \d+ s/);
  expect(probes).toBe(1);
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

test("keeps second-factor sessions outside the product shell until recovery succeeds", async ({ page }) => {
  let authenticated = false;
  let staged = false;
  const stagedPrincipal = {
    organization_id: "org_mfa",
    principal_id: "operator_mfa",
    principal_kind: "human",
    key_id: "key_staged",
    scopes: [],
    max_trust: "verified",
    organization_role: "admin",
    password_change_required: false,
    second_factor_required: true,
    auth_stage: "second_factor",
  };
  const fullPrincipal = {
    ...stagedPrincipal,
    key_id: "key_full",
    scopes: ["views:compile"],
    second_factor_required: false,
    auth_stage: "full",
  };
  await page.route("**/dashboard-api/status", (route) => route.fulfill({ json: {
    mode: "live", endpoint: "memory.example.com", authentication: "session", authenticated,
  } }));
  await page.route("**/dashboard-api/session", async (route) => {
    if (route.request().method() === "POST") {
      expect(route.request().postDataJSON()).toEqual({ username: "operator", password: "correct horse battery staple" });
      authenticated = true;
      staged = true;
      return route.fulfill({ status: 201, json: { data: stagedPrincipal } });
    }
    return route.fulfill({ json: { data: staged ? stagedPrincipal : fullPrincipal } });
  });
  await page.route("**/dashboard-api/session/recovery-code", async (route) => {
    expect(route.request().postDataJSON()).toEqual({ recovery_code: "once-only-recovery" });
    staged = false;
    return route.fulfill({ status: 201, json: { data: fullPrincipal } });
  });
  await page.route("**/dashboard-api/health", (route) => route.fulfill({ json: { data: { status: "ok", runtime: "bun" } } }));
  await page.route("**/dashboard-api/readiness", (route) => route.fulfill({ json: { data: { ready: true, capabilities: { webauthn: "enabled" } } } }));
  await page.route("**/dashboard-api/memories**", (route) => route.fulfill({ json: { data: {
    items: [], page: { limit: 25, has_more: false, next_cursor: null }, query: {}, facets: {},
    authorization: { principal_id: "operator_mfa", access_mode: "principal" },
  } } }));

  await page.goto("/dashboard/");
  await page.locator('[data-login-form] input[name="username"]').fill("operator");
  await page.locator('[data-login-form] input[name="password"]').fill("correct horse battery staple");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Verify identity" })).toBeVisible();
  await expect(page.locator("[data-product-nav]")).toBeHidden();
  await page.locator('[data-recovery-form] input[name="recovery_code"]').fill("once-only-recovery");
  await page.getByRole("button", { name: "Use recovery code" }).click();
  await expect(page.locator(".app-shell")).toHaveAttribute("data-shell", "private");
  await expect(page.locator('[data-area="memories"]:not([hidden])').first()).toBeVisible();
});

test("hides passkey and recovery controls when the deployment has WebAuthn disabled", async ({ page }) => {
  let authenticated = false;
  let webauthn: string | undefined = "disabled";
  const principal = {
    organization_id: "org_plain", principal_id: "owner", principal_kind: "human", key_id: "key_plain",
    scopes: ["views:compile"], max_trust: "verified", organization_role: "owner", auth_stage: "full",
  };
  await page.route("**/dashboard-api/status", (route) => route.fulfill({ json: { mode: "live", endpoint: "titen.internal", authentication: "session", authenticated } }));
  await page.route("**/dashboard-api/session", (route) => route.fulfill({ json: { data: principal } }));
  await page.route("**/dashboard-api/session/recovery", (route) => route.fulfill({ status: 409, json: { error: { code: "UPSTREAM_409", message: "The operation conflicts with current canonical state." } } }));
  await page.route("**/dashboard-api/health", (route) => route.fulfill({ json: { data: { status: "ok" } } }));
  await page.route("**/dashboard-api/readiness", (route) => route.fulfill({ json: { data: { ready: true, capabilities: webauthn ? { webauthn } : {} } } }));
  await page.route("**/dashboard-api/memories**", (route) => route.fulfill({ json: { data: {
    items: [], page: { limit: 25, has_more: false, next_cursor: null }, query: {}, facets: {},
  } } }));

  await page.goto("/dashboard/");
  await expect(page.getByRole("heading", { name: "Sign in", exact: true })).toBeVisible();
  await expect(page.locator("[data-start-recovery]")).toBeHidden();

  authenticated = true;
  await page.reload();
  await page.locator("[data-profile-open]").click();
  const disabled = page.locator("[data-passkey-disabled]");
  await expect(disabled).toBeVisible();
  await expect(disabled).toContainText("Passkeys are not enabled on this deployment");
  await expect(disabled).toContainText("TITEN_WEBAUTHN_RP_ID");
  for (const selector of ["[data-passkey-register-form]", "[data-passkey-password]", "[data-recovery-regenerate]", "[data-passkey-list]"])
    await expect(page.locator(selector)).toBeHidden();

  // Without a readiness answer the sign-in path stays, and a 409 names the cause.
  authenticated = false;
  webauthn = undefined;
  await page.reload();
  await page.locator('[data-login-form] input[name="username"]').fill("owner");
  await page.getByRole("button", { name: "Use passkey or recovery code" }).click();
  await expect(page.locator("[data-login-status]")).toHaveText("Passkeys are not enabled on this deployment. Password sign-in is unaffected.");
});

test("registers a passkey and shows recovery codes once in Profile", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "PublicKeyCredential", { value: class PublicKeyCredential {} });
    Object.defineProperty(navigator, "credentials", { value: {
      async create() {
        return {
          id: "credential-browser",
          rawId: new Uint8Array([1, 2, 3]).buffer,
          type: "public-key",
          authenticatorAttachment: "platform",
          response: {
            attestationObject: new Uint8Array([4, 5]).buffer,
            clientDataJSON: new Uint8Array([6, 7]).buffer,
            getTransports: () => ["internal"],
          },
          getClientExtensionResults: () => ({}),
        };
      },
    } });
  });
  const principal = {
    organization_id: "org_passkey",
    principal_id: "operator_passkey",
    principal_kind: "human",
    key_id: "key_passkey",
    scopes: ["views:compile"],
    max_trust: "verified",
    organization_role: "admin",
    auth_stage: "full",
  };
  let registered = false;
  await page.route("**/dashboard-api/status", (route) => route.fulfill({ json: {
    mode: "live", endpoint: "memory.example.com", authentication: "session", authenticated: true,
  } }));
  await page.route("**/dashboard-api/session", (route) => route.fulfill({ json: { data: principal } }));
  await page.route("**/dashboard-api/health", (route) => route.fulfill({ json: { data: { status: "ok", runtime: "bun" } } }));
  await page.route("**/dashboard-api/readiness", (route) => route.fulfill({ json: { data: {
    ready: true, capabilities: { webauthn: "enabled" },
  } } }));
  await page.route("**/dashboard-api/memories**", (route) => route.fulfill({ json: { data: {
    items: [], page: { limit: 25, has_more: false, next_cursor: null }, query: {}, facets: {},
    authorization: { principal_id: "operator_passkey", access_mode: "principal" },
  } } }));
  await page.route("**/dashboard-api/profile/passkeys/options", (route) => route.fulfill({ status: 201, json: { data: {
    challenge_id: "wch_browser",
    options: {
      challenge: "AQ",
      rp: { id: "127.0.0.1", name: "Titen" },
      user: { id: "Ag", name: "operator", displayName: "operator" },
      pubKeyCredParams: [{ alg: -7, type: "public-key" }],
      timeout: 60_000,
      attestation: "none",
      authenticatorSelection: { userVerification: "required" },
    },
  } } }));
  await page.route("**/dashboard-api/profile/passkeys", async (route) => {
    if (route.request().method() === "GET") return route.fulfill({ json: { data: { credentials: registered ? [{
      id: "wcr_browser", label: "Laptop", device_type: "singleDevice", backed_up: false,
      created_at: "2026-08-30T00:00:00.000Z", last_used_at: null,
    }] : [] } } });
    const body = route.request().postDataJSON() as Record<string, any>;
    expect(body.challenge_id).toBe("wch_browser");
    expect(body.label).toBe("Laptop");
    expect(body.response.id).toBe("credential-browser");
    expect(body.response.response.attestationObject).toBe("BAU");
    registered = true;
    return route.fulfill({ status: 201, json: { data: {
      credential: { id: "wcr_browser", label: "Laptop" },
      recovery_codes: ["recovery-code-one", "recovery-code-two"],
    } } });
  });

  await page.goto("/dashboard/");
  await page.locator("[data-profile-open]").click();
  await page.locator('[data-passkey-register-form] input[name="label"]').fill("Laptop");
  await page.getByRole("button", { name: "Register passkey" }).click();
  await expect(page.locator("[data-passkey-list]")).toContainText("Laptop");
  await expect(page.locator("[data-recovery-codes]")).toContainText("recovery-code-one");
  await expect(page.locator("[data-recovery-codes]")).toContainText("Shown once");
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
  await handoffRow.getByRole("button", { name: "Accept handoff · subject_live" }).click();
  await page.locator("dialog[data-danger-dialog]").getByRole("button", { name: "Accept handoff" }).click();
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
  await approvalRow.getByRole("button", { name: "Approve · clm_live" }).click();
  await page.locator("dialog[data-danger-dialog]").getByLabel("Reason (required)").fill("Independent browser review passed.");
  await page.locator("dialog[data-danger-dialog]").getByRole("button", { name: "Approve approval" }).click();
  await expect.poll(() => calls.includes("approval:approve")).toBe(true);
  await page.locator('[data-area="releases"]').click();
  await page.getByRole("button", { name: "Refresh releases" }).click();
  const releaseRow = page.locator('[data-collection="releases"] tbody tr').filter({ hasText: "release_live" });
  await expect(releaseRow.getByRole("button", { name: "Approve · release_live" })).toBeVisible();
  await releaseRow.getByRole("button", { name: "Approve · release_live" }).click();
  await page.locator("dialog[data-danger-dialog]").getByLabel("Reason (required)").fill("Release wording reviewed.");
  await page.locator("dialog[data-danger-dialog]").getByRole("button", { name: "Approve release" }).click();
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

test("audit activity opens on the newest entries, pages by cursor, and says when the walk is partial", async ({ page }) => {
  const principal = {
    organization_id: "org_audit",
    principal_id: "auditor",
    principal_kind: "human",
    key_id: "key_audit",
    scopes: ["audit:read", "events:read"],
    max_trust: "asserted",
    organization_role: "reader",
  };
  const entries = Array.from({ length: 450 }, (_, index) => ({
    id: `aud_${String(index).padStart(3, "0")}`,
    action: index % 2 ? "key.revoke" : "dashboard_session.create",
    actor_id: "auditor",
    created_at: new Date(Date.UTC(2026, 10, 1) + index * 60_000).toISOString(),
  }));
  let endless = false;
  const logRequests: URL[] = [];
  await page.route("**/dashboard-api/status", (route) => route.fulfill({ json: { mode: "live", endpoint: "titen.internal", authentication: "server", authenticated: true } }));
  await page.route("**/dashboard-api/session", (route) => route.fulfill({ json: { data: principal } }));
  await page.route("**/dashboard-api/health", (route) => route.fulfill({ json: { data: { status: "ok" } } }));
  await page.route("**/dashboard-api/readiness", (route) => route.fulfill({ json: { data: { ready: true } } }));
  await page.route("**/dashboard-api/audit/events**", (route) => route.fulfill({ json: { data: { events: [{ id: "evt_1", kind: "lease.acquired" }], cursor: "evt_1" } } }));
  await page.route("**/dashboard-api/audit/log**", (route) => {
    const url = new URL(route.request().url());
    logRequests.push(url);
    const limit = Number(url.searchParams.get("limit"));
    const action = url.searchParams.get("action");
    if (endless) {
      const start = logRequests.length * limit;
      const rows = Array.from({ length: limit }, (_, index) => ({ id: `aud_x${start + index}`, action: "key.revoke", created_at: "2026-11-01T00:00:00.000Z" }));
      return route.fulfill({ json: { data: { entries: rows, cursor: rows.at(-1)!.id } } });
    }
    const matching = entries.filter((entry) => !action || entry.action === action);
    const after = url.searchParams.get("after");
    const start = after ? matching.findIndex((entry) => entry.id === after) + 1 : 0;
    const rows = matching.slice(start, start + limit);
    return route.fulfill({ json: { data: { entries: rows, cursor: rows.at(-1)?.id ?? null } } });
  });
  await page.goto("/dashboard/");

  const rows = page.locator('[data-collection="entries"] tbody tr');
  await expect(rows.first()).toContainText("aud_449");
  expect(logRequests).toHaveLength(3);
  expect(logRequests.every((url) => url.searchParams.get("limit") === "200")).toBe(true);
  await expect(rows).toHaveCount(50);
  const status = page.locator('[data-activity-page="entries"]');
  await expect(status).toHaveText("Showing 1–50 of 450 audit entries, newest first.");
  const footer = page.locator('[data-activity-footer="entries"]');
  await expect(footer.getByRole("button", { name: "Newer" })).toBeDisabled();
  await footer.getByRole("button", { name: "Older" }).click();
  await expect(rows.first()).toContainText("aud_399");
  await expect(status).toHaveText("Showing 51–100 of 450 audit entries, newest first.");
  await expect(page.locator('[data-activity-page="events"]')).toHaveText("Showing 1–1 of 1 events, newest first.");

  logRequests.length = 0;
  await page.locator('[data-audit-form] input[name="action"]').fill("key.revoke");
  await page.locator('[data-audit-form] input[name="action"]').press("Enter");
  await expect(status).toHaveText("Showing 1–50 of 225 audit entries, newest first.");
  expect(logRequests.every((url) => url.searchParams.get("action") === "key.revoke")).toBe(true);
  await expect(rows.first()).toContainText("aud_449");

  endless = true;
  logRequests.length = 0;
  await page.locator('[data-audit-form] input[name="action"]').fill("");
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(status).toContainText("Partial view: showing 1–50 of the first 2,000 audit entries.");
  expect(logRequests).toHaveLength(10);
  await footer.getByRole("button", { name: "Load more recent audit entries" }).click();
  await expect(status).toContainText("of the first 4,000 audit entries");
  expect(logRequests).toHaveLength(20);
});

test("the command dialog searches on Enter, jumps to authorized areas, and returns focus", async ({ page }) => {
  await mockServerMode(page);
  const memoryQueries: string[] = [];
  await page.route("**/dashboard-api/memories**", (route) => {
    memoryQueries.push(new URL(route.request().url()).searchParams.get("q") ?? "");
    return route.fulfill({ json: { data: { items: [], page: { limit: 25, has_more: false, next_cursor: null }, query: {}, facets: {} } } });
  });
  await page.goto("/dashboard/");
  await page.locator('[data-area="system"]').click();
  const trigger = page.locator("[data-search-open]");
  await expect(trigger.locator("kbd")).toHaveText("Ctrl K");
  await expect(trigger).toHaveAttribute("aria-keyshortcuts", "Meta+K Control+K");
  await expect(trigger).toHaveAccessibleName("Search or jump to (Ctrl K)");

  await page.keyboard.press("Control+k");
  const dialog = page.locator("[data-search-dialog]");
  const query = dialog.getByRole("combobox");
  await expect(query).toBeFocused();
  await query.fill("rollback");
  await query.press("Enter");
  await expect(dialog).not.toBeVisible();
  await expect(page.locator('[data-area="memories"]').first()).toHaveAttribute("aria-current", "page");
  await expect(page.locator("[data-memory-list-search]")).toHaveValue("rollback");
  await expect.poll(() => memoryQueries.includes("rollback")).toBe(true);
  await expect(page.locator("[data-memory-list-search]")).toBeFocused();

  await page.keyboard.press("Control+k");
  await query.fill("Releases");
  await expect(dialog.getByRole("option")).toHaveText(["Go to Release policy", "Search memories for “Releases”"]);
  await query.press("ArrowDown");
  await expect(dialog.getByRole("option", { name: "Go to Release policy" })).toHaveAttribute("aria-selected", "true");
  await query.press("Enter");
  await expect(page.locator('[data-area="releases"][aria-current="page"]')).toBeVisible();

  await trigger.click();
  await query.fill("zzz-nothing");
  await expect(dialog.getByRole("option")).toHaveText(["Search memories for “zzz-nothing”"]);
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await dialog.getByRole("button", { name: "Close search" }).click();
  await expect(trigger).toBeFocused();
});

test("the command dialog offers only authorized destinations and fits beside a 320px breadcrumb", async ({ page }) => {
  const principal = {
    organization_id: "org_audit", principal_id: "auditor", principal_kind: "human", key_id: "key_audit",
    scopes: ["audit:read"], max_trust: "asserted", organization_role: "reader",
  };
  await page.setViewportSize({ width: 320, height: 720 });
  await page.route("**/dashboard-api/status", (route) => route.fulfill({ json: { mode: "live", endpoint: "titen.internal", authentication: "server", authenticated: true } }));
  await page.route("**/dashboard-api/session", (route) => route.fulfill({ json: { data: principal } }));
  await page.route("**/dashboard-api/health", (route) => route.fulfill({ json: { data: { status: "ok" } } }));
  await page.route("**/dashboard-api/readiness", (route) => route.fulfill({ json: { data: { ready: true } } }));
  await page.route("**/dashboard-api/audit/**", (route) => route.fulfill({ json: { data: { entries: [], events: [] } } }));
  await page.goto("/dashboard/");
  const trigger = page.locator("[data-search-open]");
  await expect(trigger).toBeVisible();
  const box = (await trigger.boundingBox())!;
  const crumb = (await page.locator(".breadcrumb").boundingBox())!;
  const overlaps = box.x < crumb.x + crumb.width && crumb.x < box.x + box.width
    && box.y < crumb.y + crumb.height && crumb.y < box.y + box.height;
  expect(overlaps).toBe(false);

  await trigger.click();
  const dialog = page.locator("[data-search-dialog]");
  // An empty query lists every destination this principal can open, and nothing else.
  const options = dialog.getByRole("option");
  await expect(options.first()).toHaveText("Go to Audit & Events");
  const labels = await options.allTextContents();
  expect(labels.some((label) => label.includes("Release policy"))).toBe(false);
  await dialog.getByRole("combobox").fill("release");
  await expect(dialog.getByRole("option")).toHaveCount(0);
  await expect(dialog.locator(".search-empty")).toHaveText("No authorized area matches.");
});

test("the phone navigation rail closes on its own control, Escape, or an outside tap, and manages focus", async ({ page }) => {
  await mockServerMode(page);
  await page.setViewportSize({ width: 390, height: 760 });
  await page.goto("/dashboard/");
  const shell = page.locator(".app-shell");
  const toggle = page.locator("[data-menu-toggle]");
  await expect(page.locator("#product-navigation")).toHaveCount(1);
  await expect(toggle).toHaveAttribute("aria-controls", "product-navigation");

  await toggle.click();
  await expect(shell).toHaveAttribute("data-nav-open", "");
  const close = page.getByRole("button", { name: "Close navigation" });
  await expect(close).toBeVisible();
  // The rail slides in; hit-test only once it has arrived.
  await expect(page.locator(".sidebar")).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, 0)");
  const box = (await close.boundingBox())!;
  const hit = await page.evaluate(([x, y]) => document.elementFromPoint(x!, y!)?.closest("[data-nav-close]") !== null, [box.x + box.width / 2, box.y + box.height / 2]);
  expect(hit, "the close control is not covered").toBe(true);
  expect(await page.evaluate(() => (document.querySelector("#workspace") as HTMLElement).inert)).toBe(true);
  expect(await page.evaluate(() => document.activeElement?.closest(".sidebar") !== null)).toBe(true);
  await close.click();
  await expect(shell).not.toHaveAttribute("data-nav-open", "");
  await expect(toggle).toBeFocused();
  expect(await page.evaluate(() => (document.querySelector("#workspace") as HTMLElement).inert)).toBe(false);

  await toggle.click();
  await page.keyboard.press("Escape");
  await expect(shell).not.toHaveAttribute("data-nav-open", "");
  await expect(toggle).toBeFocused();

  await toggle.click();
  await page.mouse.click(380, 500);
  await expect(shell).not.toHaveAttribute("data-nav-open", "");
  await expect(toggle).toBeFocused();

  await toggle.click();
  await page.locator('[data-area="system"]').click();
  await expect(shell).not.toHaveAttribute("data-nav-open", "");
  const focused = await page.evaluate(() => {
    const rect = document.activeElement!.getBoundingClientRect();
    return { x: rect.x, right: rect.right, width: innerWidth, id: document.activeElement!.id };
  });
  expect(focused.id).toBe("workspace");
  expect(focused.x).toBeGreaterThanOrEqual(0);
  expect(focused.right).toBeLessThanOrEqual(focused.width);
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


test("starts password-independent recovery and shows preceding failed attempts", async ({ page }) => {
  let authenticated = false;
  let stage = "second_factor";
  const principal = () => ({ organization_id: "org_rescue", principal_id: "owner", principal_kind: "human", key_id: "key_rescue", scopes: stage === "full" ? ["views:compile"] : [], max_trust: "asserted", organization_role: "owner", auth_stage: stage, second_factor_required: stage === "second_factor", failed_attempts: stage === "full" ? 50 : 0 });
  await page.route("**/dashboard-api/status", (route) => route.fulfill({ json: { mode: "live", authentication: "session", authenticated } }));
  await page.route("**/dashboard-api/session", (route) => route.fulfill({ json: { data: principal() } }));
  await page.route("**/dashboard-api/session/recovery", (route) => {
    expect(route.request().postDataJSON()).toEqual({ username: "owner" });
    authenticated = true;
    return route.fulfill({ status: 201, json: { data: principal() } });
  });
  await page.route("**/dashboard-api/session/recovery-code", (route) => {
    expect(route.request().postDataJSON()).toEqual({ recovery_code: "unused-recovery-code" });
    stage = "full";
    return route.fulfill({ status: 201, json: { data: principal() } });
  });
  await page.route("**/dashboard-api/health", (route) => route.fulfill({ json: { data: { status: "ok" } } }));
  await page.route("**/dashboard-api/readiness", (route) => route.fulfill({ json: { data: { ready: true } } }));
  await page.goto("/dashboard/");
  await page.locator('[data-login-form] input[name="username"]').fill("owner");
  await page.getByRole("button", { name: "Use passkey or recovery code" }).click();
  await expect(page.getByRole("heading", { name: "Verify identity" })).toBeVisible();
  await page.locator('[data-recovery-form] input[name="recovery_code"]').fill("unused-recovery-code");
  await page.getByRole("button", { name: "Use recovery code", exact: true }).click();
  await expect(page.locator(".app-shell")).toHaveAttribute("data-shell", "private");
  await expect(page.locator("[data-login-attempt-notice]")).toContainText("50 failed sign-in attempts");
});

test("collection tables keep every row action inside their container at desktop widths", async ({ page }) => {
  await mockServerMode(page);
  await page.route("**/dashboard-api/governance/keys", (route) => route.fulfill({ json: { data: { keys: [
    { key_id: "key_owner", label: "owner", principal_id: "owner", scopes: ["*"], max_trust: "policy_approved", status: "active" },
    { key_id: "key_session", label: "Dashboard session", principal_id: "owner", scopes: ["memory:read"], max_trust: "policy_approved", status: "revoked" },
  ] } } }));
  await page.route("**/dashboard-api/access/principals", (route) => route.fulfill({ json: { data: { principals: [{
    principal_id: "user_editor", username: "editor", principal_kind: "human", organization_role: "member", max_trust: "verified", status: "active",
  }] } } }));

  const clipped = (collection: string) => page.locator(`[data-collection="${collection}"]`).evaluate((section) => {
    const wrap = section.querySelector(".operator-table-wrap");
    const bounds = (wrap ?? section).getBoundingClientRect();
    return [...section.querySelectorAll("tbody button")]
      .filter((button) => {
        const box = button.getBoundingClientRect();
        return box.right > bounds.right + 0.5 || box.left < bounds.left - 0.5;
      })
      .map((button) => button.textContent);
  });

  for (const width of [1440, 1280, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/dashboard/");
    await page.getByRole("button", { name: "API & Keys" }).click();
    await expect(page.locator('[data-collection="keys"] tbody tr')).toHaveCount(2);
    expect(await clipped("keys"), `keys at ${width}px`).toEqual([]);
    // Enumerated values never break inside a word.
    const statusLines = await page.locator('[data-collection="keys"] tbody td[data-label="Status"]').evaluateAll((cells) =>
      cells.map((cell) => {
        const range = document.createRange();
        range.selectNodeContents(cell);
        return new Set([...range.getClientRects()].map((rect) => Math.round(rect.top))).size;
      }));
    expect(statusLines.every((lines) => lines <= 1), `status wraps at ${width}px: ${statusLines}`).toBe(true);

    await page.getByRole("button", { name: "Access" }).click();
    await expect(page.locator('[data-collection="principals"] tbody tr')).toHaveCount(1);
    expect(await clipped("principals"), `principals at ${width}px`).toEqual([]);
  }

  // Any remaining scroll region is named and reachable by keyboard.
  const wraps = page.locator(".operator-table-wrap");
  for (const wrap of await wraps.all()) {
    await expect(wrap).toHaveAttribute("role", "region");
    await expect(wrap).toHaveAttribute("tabindex", "0");
    await expect(wrap).toHaveAttribute("aria-label", /table$/);
  }
});

test("the sidebar shows every navigation group on a 1280x720 laptop and keeps the active area in view", async ({ page }) => {
  await mockServerMode(page);
  await page.route("**/dashboard-api/status", (route) => route.fulfill({ json: {
    mode: "live", endpoint: "titen.internal", authentication: "session", authenticated: true,
  } }));
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/dashboard/");
  await expect(page.locator("[data-product-nav]")).toBeVisible();
  await expect(page.locator("[data-credential-mode]")).toHaveText("Per-principal session");

  const outside = () => page.locator("[data-product-nav]").evaluate((nav) => {
    const bounds = nav.getBoundingClientRect();
    return [...nav.querySelectorAll<HTMLElement>(".nav-group-label, button[data-area]:not([hidden])")]
      .filter((item) => {
        const box = item.getBoundingClientRect();
        return box.top < bounds.top - 0.5 || box.bottom > bounds.bottom + 0.5;
      })
      .map((item) => item.textContent?.trim().split(/\s+/u)[0]);
  });
  expect(await outside()).toEqual([]);

  // The footer keeps identity and Disconnect; the credential explanation is one disclosure away.
  const footer = page.locator(".credential-note");
  expect((await footer.boundingBox())!.height).toBeLessThanOrEqual(96);
  const detail = footer.locator("details");
  await expect(detail).not.toHaveAttribute("open", "");
  await detail.locator("summary").click();
  await expect(footer.locator("[data-credential-copy]")).toBeVisible();

  // When the nav must scroll, the active destination is scrolled into view.
  await page.setViewportSize({ width: 1280, height: 480 });
  await page.getByRole("button", { name: /Releases/ }).click();
  const releases = await page.locator("[data-product-nav]").evaluate((nav) => {
    const bounds = nav.getBoundingClientRect();
    const box = nav.querySelector<HTMLElement>('button[data-area="releases"]')!.getBoundingClientRect();
    return { scrolls: nav.scrollHeight > nav.clientHeight, inView: box.top >= bounds.top - 0.5 && box.bottom <= bounds.bottom + 0.5 };
  });
  expect(releases).toEqual({ scrolls: true, inView: true });
  await page.getByRole("button", { name: /Memories/ }).first().click();
  await page.reload();
  await page.getByRole("button", { name: /Releases/ }).focus();
  await page.keyboard.press("Enter");
  expect(await page.locator("[data-product-nav]").evaluate((nav) => nav.classList.contains("nav-scrolls") || getComputedStyle(nav).backgroundImage !== "none")).toBe(true);
});

for (const width of [1440, 320]) {
  test(`Memories says which empty state applies and clears every filter at ${width}px`, async ({ page }) => {
    await mockServerMode(page);
    const queries: URLSearchParams[] = [];
    await page.route("**/dashboard-api/memories**", (route) => {
      queries.push(new URL(route.request().url()).searchParams);
      return route.fulfill({ json: { data: {
        items: [], page: { limit: 25, has_more: false, next_cursor: null }, query: {}, facets: {},
        authorization: { principal_id: "server_operator", access_mode: "principal" },
      } } });
    });
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/dashboard/");
    const panel = page.locator('[data-area-panel="memories"]');
    const empty = panel.locator("[data-memory-list-empty]");
    const status = panel.locator("[data-memory-list-status-text]");

    // Nothing filtered: the "nothing visible yet" state, with no clear-filter advice.
    await expect(empty).toBeVisible();
    await expect(empty.locator("strong")).toHaveText("No memories visible to you yet");
    await expect(empty).toContainText("REST API or MCP");
    await expect(panel).not.toContainText("clear the filter");
    await expect(empty.locator("[data-memory-list-clear]")).toBeHidden();
    await expect(status).toHaveText("0 authorized memories shown.");
    await expect(panel.locator(".memory-pagination")).toBeHidden();

    // Filtered: name every active filter and offer one control that clears them.
    await panel.locator("[data-memory-list-search]").fill("zzz-nonexistent");
    await panel.locator("[data-memory-list-status]").selectOption("revoked");
    await panel.getByRole("button", { name: "Search", exact: true }).click();
    await expect(empty.locator("strong")).toHaveText("No memories match");
    await expect(empty).toContainText('Search "zzz-nonexistent"');
    await expect(empty).toContainText("Status: Revoked");
    await expect(status).toHaveText("0 authorized memories shown.");
    const before = queries.length;
    await empty.getByRole("button", { name: "Clear search and filters" }).click();
    await expect(empty.locator("strong")).toHaveText("No memories visible to you yet");
    await expect(panel.locator("[data-memory-list-search]")).toHaveValue("");
    await expect(panel.locator("[data-memory-list-status]")).toHaveValue("");
    expect(queries.length).toBeGreaterThan(before);
    const last = queries.at(-1)!;
    expect([last.get("q"), last.get("status"), last.get("kind")]).toEqual([null, null, null]);
  });
}

test("key revocation names its target, marks this session, and confirms in a dialog", async ({ page }) => {
  await mockServerMode(page);
  const nativeDialogs: string[] = [];
  page.on("dialog", (dialog) => { nativeDialogs.push(dialog.message()); void dialog.dismiss(); });
  const session = (id: string, created: string, used: string) => ({
    key_id: id, label: "Dashboard session", principal_id: "server_operator", principal_kind: "human",
    scopes: ["*"], max_trust: "policy_approved", status: "active", created_at: created, last_used_at: used,
  });
  await page.route("**/dashboard-api/governance/keys", (route) => route.fulfill({ json: { data: { keys: [
    session("key_old_a1b2", "2026-11-01T08:00:00Z", "2026-11-01T09:00:00Z"),
    session("key_server", "2026-11-03T10:15:00Z", "2026-11-03T10:20:00Z"),
    session("key_mid_c3d4", "2026-11-02T08:00:00Z", "2026-11-02T09:00:00Z"),
  ] } } }));
  const revoked: string[] = [];
  await page.route("**/dashboard-api/api/keys/**", (route) => {
    revoked.push(new URL(route.request().url()).pathname.split("/").at(-1)!);
    return route.fulfill({ json: { data: { revoked: true } } });
  });

  await page.goto("/dashboard/");
  await page.getByRole("button", { name: "API & Keys" }).click();
  const rows = page.locator('[data-collection="keys"] tbody tr');
  await expect(rows).toHaveCount(3);
  await expect(rows.filter({ hasText: "This session" })).toHaveCount(1);
  await expect(rows.filter({ hasText: "This session" })).toContainText("…rver");
  await expect(page.locator('[data-collection="keys"] thead')).toContainText("Last used");
  const names = await page.locator('[data-collection="keys"] tbody button.danger-action').allTextContents();
  expect(names).toHaveLength(3);
  expect(new Set(names).size).toBe(3);

  // Cancel is the default, and nothing is revoked.
  const dialog = page.locator("dialog[data-danger-dialog]");
  await rows.filter({ hasText: "…a1b2" }).locator("button.danger-action").click();
  await expect(dialog).toHaveAttribute("open", "");
  await expect(dialog).toContainText("…a1b2");
  await expect(dialog).toContainText("401");
  await expect(dialog).toContainText("cannot be undone");
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).not.toHaveAttribute("open", "");
  expect(revoked).toEqual([]);

  // Revoking the current session warns first, then says the operator did it.
  await rows.filter({ hasText: "This session" }).locator("button.danger-action").click();
  await expect(dialog).toContainText("signed out");
  await dialog.getByRole("button", { name: "Revoke key" }).click();
  await expect.poll(() => revoked).toEqual(["key_server"]);
  await expect(page.locator("body")).toContainText("You revoked this session. Sign in again.");
  expect(nativeDialogs).toEqual([]);
});

test("release activation and reasoned decisions use the confirmation dialog", async ({ page }) => {
  await mockServerMode(page);
  const nativeDialogs: string[] = [];
  page.on("dialog", (dialog) => { nativeDialogs.push(dialog.message()); void dialog.dismiss(); });
  await page.route("**/dashboard-api/governance/releases", (route) => route.fulfill({ json: { data: { releases: [
    { release_id: "rel_approved", channel_id: "chan_main", claim_id: "claim_1", audience: "agents", status: "approved", version: 2 },
  ] } } }));
  const posts: { path: string; body: Record<string, unknown> }[] = [];
  await page.route("**/dashboard-api/releases/**", (route) => {
    posts.push({ path: new URL(route.request().url()).pathname, body: route.request().postDataJSON() });
    return route.fulfill({ json: { data: {} } });
  });
  await page.goto("/dashboard/");
  await page.getByRole("button", { name: /Releases/ }).click();
  await page.locator("[data-releases-refresh]").click();
  const dialog = page.locator("dialog[data-danger-dialog]");

  await page.getByRole("button", { name: "Activate · rel_approved" }).click();
  await expect(dialog).toHaveAttribute("open", "");
  await expect(dialog).toContainText("rel_approved");
  expect(posts).toEqual([]);
  await dialog.getByRole("button", { name: "Activate release" }).click();
  await expect.poll(() => posts.map((post) => post.path)).toEqual(["/dashboard-api/releases/rel_approved/activate"]);

  // A reason is collected in a labelled field, and confirm stays disabled until it is filled.
  await page.getByRole("button", { name: "Revoke · rel_approved" }).click();
  const confirm = dialog.getByRole("button", { name: "Revoke release" });
  await expect(confirm).toBeDisabled();
  await dialog.getByLabel("Reason (required)").fill("Superseded by a corrected claim");
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect.poll(() => posts.at(-1)?.body.reason).toBe("Superseded by a corrected claim");
  expect(nativeDialogs).toEqual([]);
});

test("credential failures say what went wrong, mark the field, and never claim an expired session", async ({ page }) => {
  let stage = "none";
  await page.route("**/dashboard-api/status", (route) => route.fulfill({ json: { mode: "live", authentication: "session", authenticated: stage !== "none" } }));
  const secondFactor = {
    organization_id: "org_rescue", principal_id: "owner", principal_kind: "human", key_id: "key_rescue", scopes: [],
    max_trust: "asserted", organization_role: "owner", auth_stage: "second_factor", second_factor_required: true,
  };
  await page.route("**/dashboard-api/session", (route) => route.request().method() === "POST"
    ? route.fulfill({ status: 401, json: { error: { code: "INVALID_LOGIN", message: "Username or password is invalid." } } })
    : route.fulfill({ json: { data: secondFactor } }));
  await page.route("**/dashboard-api/session/recovery", (route) => {
    stage = "second_factor";
    return route.fulfill({ status: 201, json: { data: secondFactor } });
  });
  await page.route("**/dashboard-api/session/recovery-code", (route) => route.fulfill({ status: 401, json: { error: { code: "SECOND_FACTOR_INVALID", message: "Second-factor verification failed." } } }));
  await page.route("**/dashboard-api/health", (route) => route.fulfill({ json: { data: { status: "ok" } } }));
  await page.route("**/dashboard-api/readiness", (route) => route.fulfill({ json: { data: { ready: true } } }));
  await page.goto("/dashboard/");

  const form = page.locator("[data-login-form]");
  const status = page.locator("[data-login-status]");
  const password = form.locator('input[name="password"]');
  await form.locator('input[name="username"]').fill("owner");
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await password.fill(`wrong-${attempt}`);
    await form.getByRole("button", { name: "Continue" }).click();
    await expect(status).toContainText("Username or password is invalid.");
    await expect(status).not.toContainText("no longer valid");
    await expect(password).toHaveAttribute("aria-invalid", "true");
    await expect(password).toHaveAttribute("aria-describedby", "login-status");
    await expect(password).toBeFocused();
    if (attempt < 3) await expect(status).not.toContainText("30 minutes");
  }
  await expect(status).toContainText("Repeated failures add a delay of up to 30 minutes, even for the correct password.");
  // Typing clears the invalid mark.
  await password.fill("retyping");
  await expect(password).not.toHaveAttribute("aria-invalid", "true");

  // Switching to the second-factor panel clears the stale sign-in message.
  await page.getByRole("button", { name: "Use passkey or recovery code" }).click();
  await expect(page.getByRole("heading", { name: "Verify identity" })).toBeVisible();
  await expect(status).toHaveText("");
  const code = page.locator('[data-recovery-form] input[name="recovery_code"]');
  await code.fill("used-code");
  await page.getByRole("button", { name: "Use recovery code", exact: true }).click();
  await expect(page.locator("[data-recovery-status]")).toHaveText("That recovery code is invalid or already used.");
  await expect(code).toHaveAttribute("aria-invalid", "true");
  await expect(code).toBeFocused();
});

test("Context lays out its form and explains why a compiled pack is empty or short", async ({ page }) => {
  await mockServerMode(page);
  await page.route("**/dashboard-api/subjects**", (route) => route.fulfill({ json: { data: { subjects: [
    { subject_id: "user:ux-demo-alpha", label: "UX demo alpha", type: "human", record_count: 1 },
    { subject_id: "project:ux-demo-beta", label: "UX demo beta", type: "concept", record_count: 1 },
  ] } } }));
  const budgets: Record<string, Record<string, unknown>> = {
    "user:ux-demo-alpha": { max_tokens: 1200, used_tokens: 0, selected_items: 0, omitted_items: 0, deduplicated_items: 0,
      unconsolidated_observations: 2, hint: "call titen_consolidate (or remember with consolidate: true)", budget_exhausted: false, omissions: [] },
    "project:ux-demo-beta": { max_tokens: 1200, used_tokens: 1150, selected_items: 1, omitted_items: 2, deduplicated_items: 0,
      unconsolidated_observations: 0, budget_exhausted: true, omissions: [
        { claim_id: "clm_a", tokens: 400, reason: "token_budget" }, { claim_id: "clm_b", tokens: 300, reason: "token_budget" }] },
    "user:typo": { max_tokens: 1200, used_tokens: 0, selected_items: 0, omitted_items: 0, deduplicated_items: 0,
      unconsolidated_observations: 0, budget_exhausted: false, omissions: [] },
  };
  await page.route("**/dashboard-api/context/compile", async (route) => {
    const body = route.request().postDataJSON();
    const budget = budgets[body.subject_id];
    await route.fulfill({ json: { data: { items: body.subject_id === "project:ux-demo-beta" ? [{ claim_id: "clm_c", statement: "Kept item", kind: "semantic_fact", tokens: 1150 }] : [], conflicts: [], budget } } });
  });

  for (const width of [1440, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/dashboard/");
    if (width <= 960) await page.getByRole("button", { name: "Open navigation" }).click();
    await page.locator('[data-area="context"]').click();
    const form = page.locator("[data-context-form]");
    const layout = await form.evaluate((element) => {
      const grid = element.querySelector(".input-grid")!;
      const stacked = [...grid.querySelectorAll("label")].every((label) =>
        label.querySelector("span")!.getBoundingClientRect().bottom <= label.querySelector("input")!.getBoundingClientRect().top + 0.5);
      return { display: getComputedStyle(grid).display, stacked, noScroll: document.documentElement.scrollWidth <= window.innerWidth };
    });
    expect(layout, `layout at ${width}px`).toEqual({ display: "grid", stacked: true, noScroll: true });
  }

  const form = page.locator("[data-context-form]");
  const output = page.locator("[data-context-output]");
  const status = page.locator("[data-context-status]");
  // Subject suggestions come from the authorized Subjects directory.
  await expect.poll(() => form.locator('input[name="subject_id"]').evaluate((input: HTMLInputElement) =>
    [...(input.list?.options ?? [])].map((option) => option.value))).toEqual(["user:ux-demo-alpha", "project:ux-demo-beta"]);

  const compile = async (subject: string) => {
    await form.locator('input[name="subject_id"]').fill(subject);
    await form.locator('input[name="task"]').fill("deploy window");
    await form.getByRole("button", { name: "Compile context" }).click();
  };
  await compile("user:ux-demo-alpha");
  await expect(output).toContainText("2 observations for this subject are not yet consolidated");
  await expect(output.locator("code")).toHaveText("call titen_consolidate (or remember with consolidate: true)");
  await expect(status).toHaveText("Compiled · 0 items");

  await compile("project:ux-demo-beta");
  await expect(output).toContainText("2 items did not fit the 1,200-token budget");
  await expect(output).toContainText("clm_a");
  await expect(status).toHaveText("Compiled · 1 item");

  await compile("user:typo");
  await expect(output).toContainText("No authorized claims matched this subject and task.");
  await expect(output).not.toContainText("not yet consolidated");

  // Subjects offers a row action that opens Context with the subject filled in (narrow layout).
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.locator('[data-area="subjects"]').click();
  await page.getByRole("button", { name: "Compile context for UX demo beta" }).click();
  await expect(page.locator('[data-area-panel="context"]')).toBeVisible();
  await expect(form.locator('input[name="subject_id"]')).toHaveValue("project:ux-demo-beta");
  await expect(form.locator('input[name="task"]')).toBeFocused();
});
