import { test } from "bun:test";
import assert from "node:assert/strict";
import { normalizeLineEndings, optionalString, requireString } from "../../src/core/validate";

test("CRLF pairs become LF; every other character is untouched", () => {
  assert.equal(normalizeLineEndings("a\r\nb\r\n"), "a\nb\n");
  assert.equal(normalizeLineEndings("a\tb\nc"), "a\tb\nc");
  assert.equal(normalizeLineEndings("lone\rcr"), "lone\rcr");
  assert.equal(normalizeLineEndings("mixed\r\n\rtail"), "mixed\n\rtail");
  assert.equal(normalizeLineEndings("\r\r\n"), "\r\n");
});

test("validated strings accept CRLF as LF and still reject a lone CR", () => {
  assert.equal(requireString({ content: "one\r\ntwo" }, "content", 100), "one\ntwo");
  assert.equal(optionalString({ note: "one\r\ntwo" }, "note", 100), "one\ntwo");
  assert.throws(
    () => requireString({ content: "over\rwrite" }, "content", 100),
    /carriage return \(U\+000D\) not followed by a line feed/,
  );
  // A CR left behind after collapsing "\r\r\n" is still a lone CR.
  assert.throws(() => requireString({ content: "x\r\r\ny" }, "content", 100), /carriage return/);
  for (const unsafe of ["nul\u0000", "esc\u001b[2J", "bidi‮", "del\u007f"])
    assert.throws(() => requireString({ content: unsafe }, "content", 100), /unsafe control character/);
  // The length limit applies to the normalized value.
  assert.equal(requireString({ content: "ab\r\n" }, "content", 3), "ab\n");
});
