import assert from "node:assert/strict";
import { CASES } from "./cases";

function expectError(res: { status: number; body: any }, status: number, code: string) {
  assert.equal(res.status, status, JSON.stringify(res.body));
  assert.equal(res.body.error.code, code);
}

CASES.push({
  name: "agent ergonomics explain fences, fill one project, and reassign private principals",
  async run(fx) {
    const owner = await fx.provision({ scopes: ["*"], principalId: "agent_owner" });
    const shared = await fx.call("POST", "/v1/projects/resolve", {
      key: owner.key,
      body: { reference: "owner/shared", create: true, default_visibility: "organization" },
    });
    assert.equal(shared.status, 201, JSON.stringify(shared.body));
    const profile = await fx.call("POST", "/v1/projects/resolve", {
      key: owner.key,
      body: { reference: "owner/profile-agent", create: true },
    });
    assert.equal(profile.status, 201, JSON.stringify(profile.body));
    const sharedId = shared.body.data.project_id as string;
    const profileId = profile.body.data.project_id as string;

    const many = await fx.call("POST", "/v1/keys", {
      key: owner.key,
      body: {
        label: "two projects",
        principal_id: "agent_many",
        max_trust: "asserted",
        scopes: ["observations:write", "claims:write", "context:compile", "mcp:call", "projects:resolve"],
        write_subjects: ["team:shared", "team:profile:agent_a"],
        write_projects: [sharedId, profileId],
      },
    });
    assert.equal(many.status, 201, JSON.stringify(many.body));
    const manyKey = many.body.data.api_key as string;

    const missingProject = await fx.call("POST", "/v1/observations", {
      key: manyKey,
      body: {
        subject_id: "team:profile:agent_a",
        kind: "user_statement",
        content: "A fenced write must name its project.",
        source: { type: "chat", ref: "note-1" },
        visibility: "organization",
      },
    });
    expectError(missingProject, 403, "FORBIDDEN");
    assert.equal(missingProject.body.meta.reason, "project_fence");
    assert.equal(missingProject.body.meta.failed, "project_id");
    assert.equal(missingProject.body.meta.got, null);
    assert.deepEqual(missingProject.body.meta.allowed_projects, [profileId, sharedId].sort());
    assert.match(missingProject.body.error.message, /project_id is required/);

    const wrongSubject = await fx.call("POST", "/v1/observations", {
      key: manyKey,
      body: {
        subject_id: "team:profile:agent_b",
        project_id: sharedId,
        kind: "user_statement",
        content: "A fenced write must name an allowed subject.",
        source: { type: "chat", ref: "note-2" },
        visibility: "organization",
      },
    });
    expectError(wrongSubject, 403, "FORBIDDEN");
    assert.equal(wrongSubject.body.meta.failed, "subject_id");
    assert.equal(wrongSubject.body.meta.reason, "subject_fence");

    const trust = await fx.call("POST", "/v1/observations", {
      key: manyKey,
      body: {
        subject_id: "team:shared",
        project_id: sharedId,
        kind: "user_statement",
        content: "Verified trust is above this key.",
        source: { type: "chat", ref: "note-3" },
        trust: "verified",
        visibility: "organization",
      },
    });
    expectError(trust, 403, "FORBIDDEN");
    assert.equal(trust.body.meta.reason, "trust_ceiling");
    assert.deepEqual(trust.body.meta.allowed_trust, ["unverified", "asserted"]);

    const missing = await fx.call("POST", "/v1/context/compile", { key: manyKey, body: {} });
    expectError(missing, 400, "VALIDATION_ERROR");
    const missingFields = (missing.body.meta.fields as Array<{ field: string }>).map((field) => field.field);
    assert.deepEqual(missingFields, ["subject_id", "task", "max_tokens"]);

    const aliased = await fx.call("POST", "/v1/context/compile", {
      key: manyKey,
      body: { subject: "team:shared", query: "shared notes", max_tokens: 800 },
    });
    assert.equal(aliased.status, 200, JSON.stringify(aliased.body));
    assert.deepEqual(aliased.body.meta.deprecated_fields, ["subject", "query"]);
    assert.match(aliased.body.data.scope.hint, /not project-scoped/);
    assert.match(aliased.body.data.scope.hint, new RegExp(sharedId));
    assert.equal(aliased.body.meta.degraded.reason.length > 0, true);
    assert.match(aliased.body.meta.consistent_as_of, /^\d{4}-/);
    assert.equal(aliased.body.meta.read_your_writes, "sql_fts");

    const one = await fx.call("POST", "/v1/keys", {
      key: owner.key,
      body: {
        label: "one project",
        principal_id: "agent_a",
        max_trust: "asserted",
        scopes: ["observations:write", "claims:write", "context:compile", "mcp:call", "projects:resolve"],
        write_subjects: ["team:profile:agent_a"],
        write_projects: [profileId],
      },
    });
    assert.equal(one.status, 201, JSON.stringify(one.body));
    const oneKey = one.body.data.api_key as string;
    const remembered = await fx.call("POST", "/v1/observations", {
      key: oneKey,
      body: {
        subject_id: "team:profile:agent_a",
        kind: "user_statement",
        content: "One fenced project is filled in.",
        source: { type: "chat", ref: "note-4" },
        visibility: "organization",
        consolidate: true,
        tz: "Asia/Bangkok",
      },
    });
    assert.equal(remembered.status, 201, JSON.stringify(remembered.body));
    assert.equal(remembered.body.data.project_id, profileId);
    assert.equal(remembered.body.data.project_id_source, "key_fence");
    assert.match(remembered.body.data.ingested_at_local, /\+07:00$/);
    assert.match(remembered.body.data.ingested_at, /Z$/);

    const compiled = await fx.call("POST", "/v1/context/compile", {
      key: oneKey,
      body: {
        subject_id: "team:profile:agent_a",
        task: "filled project",
        max_tokens: 800,
        tz: "Asia/Bangkok",
      },
    });
    assert.equal(compiled.status, 200, JSON.stringify(compiled.body));
    assert.equal(compiled.body.data.scope.project_id, profileId);
    assert.equal(compiled.body.data.scope.project_id_source, "key_fence");
    assert.equal(compiled.body.data.scope.project_mode, "project");
    assert.match(compiled.body.data.scope.as_of_local, /\+07:00$/);
    assert.equal(compiled.body.data.budget.unconsolidated_observations, 0);
    const tight = await fx.call("POST", "/v1/context/compile", {
      key: oneKey,
      body: { subject_id: "team:profile:agent_a", task: "filled project", max_tokens: 128 },
    });
    assert.equal(tight.status, 200, JSON.stringify(tight.body));
    if (tight.body.data.items.length === 0 && tight.body.data.budget.budget_exhausted === true)
      assert.match(tight.body.data.budget.hint, /increase max_tokens/);

    const pending = await fx.call("POST", "/v1/observations", {
      key: oneKey,
      body: {
        subject_id: "team:profile:agent_a",
        kind: "user_statement",
        content: "This note still needs a claim.",
        source: { type: "chat", ref: "note-5" },
        visibility: "organization",
      },
    });
    assert.equal(pending.status, 201, JSON.stringify(pending.body));
    const empty = await fx.call("POST", "/v1/context/compile", {
      key: oneKey,
      body: { subject_id: "team:profile:agent_a", task: "pending note", max_tokens: 800 },
    });
    assert.equal(empty.status, 200, JSON.stringify(empty.body));
    assert.equal(empty.body.data.budget.unconsolidated_observations, 1);
    assert.deepEqual(empty.body.data.budget.unconsolidated_observation_ids, [pending.body.data.observation_id]);
    assert.match(empty.body.data.budget.hint, /titen_consolidate/);

    const subjectLookup = await fx.call("POST", "/v1/projects/resolve", {
      key: oneKey,
      body: { reference: "team:profile:agent_a" },
    });
    assert.equal(subjectLookup.status, 200, JSON.stringify(subjectLookup.body));
    assert.equal(subjectLookup.body.data.matched, "subject");
    assert.deepEqual(subjectLookup.body.data.projects, [{
      project_id: profileId,
      reference: "owner/profile-agent",
      default_visibility: "private",
    }]);

    const suggestion = await fx.call("POST", "/v1/projects/resolve", {
      key: oneKey,
      body: { reference: "owner/profile-agen" },
    });
    expectError(suggestion, 404, "NOT_FOUND");
    assert.deepEqual(suggestion.body.meta.suggestions, [{
      project_id: profileId,
      reference: "owner/profile-agent",
      default_visibility: "private",
    }]);

    const who = await fx.call("GET", "/v1/principal", { key: oneKey });
    assert.equal(who.status, 200, JSON.stringify(who.body));
    assert.equal(who.body.data.principal_id, "agent_a");
    assert.deepEqual(who.body.data.allowed_trust, ["unverified", "asserted"]);
    assert.equal(JSON.stringify(who.body).includes(oneKey), false);
    assert.equal(who.body.data.projects[0].reference, "owner/profile-agent");
    const mcpWho = await fx.call("POST", "/mcp", {
      key: oneKey,
      body: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "titen_whoami", arguments: {} } },
    });
    assert.equal(mcpWho.status, 200, JSON.stringify(mcpWho.body));
    const whoText = mcpWho.body.result.content[0].text as string;
    assert.equal(whoText.includes(oneKey), false);
    assert.match(whoText, /agent_a/);
    assert.equal(mcpWho.body.result.isError, undefined);

    const writer = await fx.provision({
      orgId: owner.orgId,
      principalId: "agent_old",
      scopes: ["observations:write", "context:compile"],
    });
    const kept = await fx.call("POST", "/v1/observations", {
      key: writer.key,
      body: {
        subject_id: "team:shared",
        kind: "decision",
        content: "Private note that should follow the principal.",
        source: { type: "chat", ref: "note-6" },
        visibility: "private",
      },
    });
    assert.equal(kept.status, 201, JSON.stringify(kept.body));
    const reader = await fx.provision({
      orgId: owner.orgId,
      principalId: "agent_next",
      scopes: ["observations:write", "context:compile", "claims:write"],
    });
    const before = await fx.call("POST", "/v1/context/compile", {
      key: reader.key,
      body: { subject_id: "team:shared", task: "private note", max_tokens: 800 },
    });
    assert.equal(before.body.data.budget.unconsolidated_observations, 0);
    const preview = await fx.call("POST", "/v1/principals/reassign", {
      key: owner.key,
      body: { from: "agent_old", to: "agent_next", dry_run: true },
    });
    assert.equal(preview.status, 200, JSON.stringify(preview.body));
    assert.equal(preview.body.data.dry_run, true);
    assert.equal(preview.body.data.observations, 1);
    const stillOld = await fx.query<{ actor_id: string }>(
      "SELECT actor_id FROM observations WHERE id = ?",
      [kept.body.data.observation_id],
    );
    assert.equal(stillOld[0]?.actor_id, "agent_old");
    const moved = await fx.call("POST", "/v1/principals/reassign", {
      key: owner.key,
      body: { from: "agent_old", to: "agent_next" },
    });
    assert.equal(moved.status, 200, JSON.stringify(moved.body));
    assert.equal(moved.body.data.observations, 1);
    const after = await fx.call("POST", "/v1/context/compile", {
      key: reader.key,
      body: { subject_id: "team:shared", task: "private note", max_tokens: 800 },
    });
    assert.equal(after.body.data.budget.unconsolidated_observations, 1);
    assert.deepEqual(after.body.data.budget.unconsolidated_observation_ids, [kept.body.data.observation_id]);
    const outsider = await fx.provision();
    expectError(await fx.call("POST", "/v1/principals/reassign", {
      key: outsider.key,
      body: { from: "agent_old", to: "agent_next" },
    }), 403, "FORBIDDEN");

    const ready = await fx.call("GET", "/readyz");
    assert.equal(ready.status, 200, JSON.stringify(ready.body));
    assert.equal(typeof ready.body.data.version, "string");
    assert.equal(ready.body.data.schema_version, ready.body.data.schema.applied);
  },
});
