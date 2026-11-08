import { test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../../src/runtime/bun/sqlite";

// Another process holds an exclusive lock while this one opens the file. The
// open must wait for the lock instead of failing with SQLITE_BUSY.
test("openDatabase waits for a lock that another process holds", async () => {
  const directory = mkdtempSync(join(tmpdir(), "titen-open-busy-"));
  const dbPath = join(directory, "titen.db");
  const holderPath = join(directory, "holder.ts");
  writeFileSync(holderPath, `
import { Database } from "bun:sqlite";
const db = new Database(process.argv[2], { create: true });
db.run("BEGIN EXCLUSIVE");
db.run("CREATE TABLE held (id INTEGER)");
process.stdout.write("locked\\n");
Bun.sleepSync(400);
db.run("COMMIT");
db.close();
`);
  const holder = Bun.spawn({
    cmd: [process.execPath, "run", holderPath, dbPath],
    stdout: "pipe",
    stderr: "pipe",
  });
  try {
    const reader = holder.stdout.getReader();
    const first = await reader.read();
    reader.releaseLock();
    assert.equal(new TextDecoder().decode(first.value), "locked\n");

    const database = openDatabase(dbPath);
    try {
      const mode = database.query("PRAGMA journal_mode").get() as { journal_mode: string };
      assert.equal(mode.journal_mode, "wal");
    } finally {
      database.close();
    }
    assert.equal(await holder.exited, 0, await new Response(holder.stderr).text());
  } finally {
    holder.kill();
    rmSync(directory, { recursive: true, force: true });
  }
});
