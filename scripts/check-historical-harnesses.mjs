import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

/**
 * @typedef {{ code: number, line: number, character: number, message: string }} ArchiveDiagnostic
 * @typedef {{ path: string, sha256: string, diagnostics: ArchiveDiagnostic[] }} ArchiveEntry
 */

/**
 * Check frozen evidence without suppressing new compiler errors.
 * @param {string} root
 * @param {ArchiveEntry[]} entries
 * @param {ts.CompilerOptions} options
 * @returns {string[]}
 */
export function checkHistoricalHarnesses(root, entries, options) {
  const problems = [];
  for (const entry of entries) {
    try {
      const content = readFileSync(resolve(root, entry.path));
      if (createHash("sha256").update(content).digest("hex") !== entry.sha256)
        problems.push(`${entry.path}: content hash differs`);
    } catch {
      problems.push(`${entry.path}: cannot read archive`);
    }
  }
  if (problems.length) return problems;

  const program = ts.createProgram(entries.map((entry) => resolve(root, entry.path)), {
    ...options,
    noEmit: true,
  });
  const actual = ts.getPreEmitDiagnostics(program).map((diagnostic) => {
    const position = diagnostic.file?.getLineAndCharacterOfPosition(diagnostic.start ?? 0);
    return {
      path: diagnostic.file ? relative(root, diagnostic.file.fileName).replaceAll("\\", "/") : "<config>",
      code: diagnostic.code,
      line: position ? position.line + 1 : 0,
      character: position ? position.character + 1 : 0,
      message: ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
    };
  });
  const expected = entries.flatMap((entry) =>
    entry.diagnostics.map((diagnostic) => ({ path: entry.path, ...diagnostic })),
  );
  const canonical = (diagnostics) => diagnostics.map((item) => JSON.stringify(item)).sort();
  if (JSON.stringify(canonical(actual)) !== JSON.stringify(canonical(expected))) {
    problems.push(`Historical compiler diagnostics differ.\nExpected: ${JSON.stringify(expected)}\nActual: ${JSON.stringify(actual)}`);
  }
  return problems;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const manifest = JSON.parse(readFileSync(resolve(root, "scripts/historical-harnesses.json"), "utf8"));
  const config = ts.readConfigFile(resolve(root, "tsconfig.json"), ts.sys.readFile);
  if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, "\n"));
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
  if (parsed.errors.length)
    throw new Error(parsed.errors.map((error) => ts.flattenDiagnosticMessageText(error.messageText, "\n")).join("\n"));
  const problems = checkHistoricalHarnesses(root, manifest, parsed.options);
  if (problems.length) {
    console.error(problems.join("\n"));
    process.exitCode = 1;
  } else {
    const count = manifest.reduce((total, entry) => total + entry.diagnostics.length, 0);
    console.log(`Historical harnesses OK (${manifest.length} unchanged files, ${count} frozen diagnostics).`);
  }
}
