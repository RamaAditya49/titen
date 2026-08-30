import { test } from "bun:test";
import assert from "node:assert/strict";
import { scanPublicText } from "../../scripts/check-public-artifacts.mjs";

test("the public-artifact scanner rejects private deployment identifiers", () => {
  const fixtures = [
    ["host", `Connect to ${["server", "private"].join("-")} for the release.`],
    ["domain", `Use https://${["memory", "corp", "local"].join(".")}/healthz.`],
    ["network", `The node uses ${["private-tailnet", "ts", "net"].join(".")}.`],
    ["home_path", `Read /home/${["private", "operator"].join("-")}/service/.env.`],
    ["secret_path", `Load /etc/${["private", "service"].join("-")}/dashboard.env before startup.`],
    ["cloud_account_id", `"account_id": "${"a".repeat(32)}"`],
    ["cloud_resource_id", `"database_id": "${["aaaaaaaa", "bbbb", "cccc", "dddd", "eeeeeeeeeeee"].join("-")}"`],
  ] as const;
  for (const [rule, value] of fixtures) {
    const matches = scanPublicText("fixture.md", value);
    assert.ok(matches.some((match) => match.rule === rule), `${rule} must reject its fixture`);
  }
});

test("the public-artifact scanner accepts neutral open-source examples", () => {
  const text = [
    "Connect to deployment-host.example.com.",
    "Set TITEN_DB_PATH through the service environment.",
    "Use a private reverse proxy when the deployment requires one.",
    "Read the EARS source at https://alistairmavin.com/ears/.",
  ].join("\n");
  assert.deepEqual(scanPublicText("fixture.md", text), []);
});
