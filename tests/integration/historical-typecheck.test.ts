import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";
import { checkHistoricalHarnesses } from "../../scripts/check-historical-harnesses.mjs";

const source = "const total: string = 42;\n";
const entry = {
  path: "probe.ts",
  sha256: createHash("sha256").update(source).digest("hex"),
  diagnostics: [{
    code: 2322,
    line: 1,
    character: 7,
    message: "Type 'number' is not assignable to type 'string'.",
  }],
};
const options: ts.CompilerOptions = {
  strict: true,
  noEmit: true,
  skipLibCheck: true,
  types: [],
  target: ts.ScriptTarget.ES2022,
};

function check(content: string | null, diagnostics = entry.diagnostics) {
  const root = mkdtempSync(join(tmpdir(), "titen-historical-typecheck-"));
  try {
    if (content !== null) writeFileSync(join(root, entry.path), content);
    return checkHistoricalHarnesses(root, [{ ...entry, diagnostics }], options);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe("historical harness compiler check", () => {
  test("accepts unchanged evidence with its exact known diagnostic", () => {
    expect(check(source)).toEqual([]);
  });

  test("rejects an edited archive even when its diagnostic stays the same", () => {
    expect(check(`${source}// changed evidence\n`).join("\n")).toContain("probe.ts: content hash differs");
  });

  test("rejects a missing archive", () => {
    expect(check(null).join("\n")).toContain("probe.ts: cannot read archive");
  });

  test("rejects an unexpected compiler error", () => {
    expect(check(source, []).join("\n")).toContain("compiler diagnostics differ");
  });

  test("rejects a removed or changed compiler error", () => {
    expect(check(source, [{ ...entry.diagnostics[0]!, code: 2307 }]).join("\n"))
      .toContain("compiler diagnostics differ");
  });
});
