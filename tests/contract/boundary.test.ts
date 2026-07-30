import { describe, expect, test } from "bun:test";
import { abstain, allow, crossBoundary, deny, requireBoundary } from "../../src/core/boundary";
import { bindSingleTenant } from "../../src/core/auth";
import { createApp } from "../../src/core/app";

const db = { all: async () => [], batch: async () => [] } as any;

describe("fail-closed boundary", () => {
  test("uses deny-overrides and treats abstain as incomplete", () => {
    expect(() => requireBoundary([allow("scope"), deny("policy", "blocked")])).toThrow();
    expect(() => requireBoundary([allow("scope"), abstain("visibility", "no opinion")])).toThrow();
    expect(() => requireBoundary([])).toThrow();
    expect(() => requireBoundary([allow("tenant"), allow("scope")])).not.toThrow();
  });

  test("does not call fetch/embed/vector/sink after denial", async () => {
    for (const kind of ["policy", "scope", "visibility", "trust", "release_filter"] as const) {
      let calls = 0;
      await expect(crossBoundary([deny(kind, "test denial")], async () => { calls++; return true; })).rejects.toThrow();
      expect(calls).toBe(0);
    }
  });

  test("single tenant binding is explicit and complete", () => {
    expect(() => bindSingleTenant(undefined)).toThrow();
    expect(() => bindSingleTenant({ orgId: "", principalId: "svc", scopes: ["context:compile"], maxTrust: "asserted" })).toThrow();
    expect(bindSingleTenant({ orgId: "org_configured", principalId: "svc", scopes: ["context:compile"], maxTrust: "asserted" }).orgId).toBe("org_configured");
  });

  test("configured tenant still enforces scope before handler/storage", async () => {
    let storageCalls = 0;
    const guardedDb = { all: async () => { storageCalls++; return []; }, batch: async () => { storageCalls++; return []; } } as any;
    const app = createApp({ db: guardedDb, runtime: "test", singleTenant: { orgId: "org_configured", principalId: "svc", scopes: [], maxTrust: "asserted" } });
    const response = await app(new Request("http://titen.test/v1/context/compile", { method: "POST", body: "{}" }));
    expect(response.status).toBe(403);
    expect(storageCalls).toBe(0);
  });
});
