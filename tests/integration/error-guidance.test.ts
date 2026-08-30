import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ApiError,
  conflict,
  forbidden,
  notFound,
  supportGuidance,
  unauthenticated,
  unavailable,
  unresolvedReference,
  validationError,
} from "../../src/core/errors";
import { failure } from "../../src/core/http";

const ERROR_GUIDE = "https://titen.dev/docs/agent-integrations#error-triage";

test("public error codes map to constant support guidance without copying input", () => {
  const expected = [
    [validationError("private validation payload"), "Correct the request using the documented field contract, then retry once."],
    [unauthenticated(), "Configure a valid credential without printing or storing it in memory."],
    [forbidden("private authorization detail"), "Verify the principal scope and target grant; do not bypass authorization."],
    [notFound(), "Verify the resource identifier and authorized scope without probing foreign records."],
    [new ApiError(405, "METHOD_NOT_ALLOWED", "private route detail"), "Use the documented HTTP method for this route."],
    [conflict("private conflict detail"), "Reload canonical state and resolve the reported conflict before retrying."],
    [unresolvedReference({ field: "private field" }), "Resolve the reported import reference before applying the import again."],
  ] as const;

  for (const [error, action] of expected) {
    assert.deepEqual(supportGuidance(error), {
      classification: "expected",
      action,
      docs_url: ERROR_GUIDE,
    });
    assert.ok(!JSON.stringify(supportGuidance(error)).includes("private"));
  }

  assert.deepEqual(supportGuidance(unavailable("private provider response")), {
    classification: "investigate",
    action: "Check readiness and dependency state; retry only when the operation is safe to repeat.",
    docs_url: ERROR_GUIDE,
  });
  assert.deepEqual(supportGuidance(new ApiError(500, "INTERNAL", "private stack detail")), {
    classification: "defect_candidate",
    action: "Reproduce with synthetic input, remove sensitive data, and search existing issues before reporting.",
    docs_url: ERROR_GUIDE,
  });
});

test("unexpected exceptions return fixed defect guidance without exception detail", async () => {
  const response = failure(new Error("private memory and provider stack"), "req_public_error");
  const body = await response.json() as any;

  assert.equal(response.status, 500);
  assert.equal(body.error.code, "INTERNAL");
  assert.equal(body.error.message, "Request could not be completed.");
  assert.equal(body.meta.request_id, "req_public_error");
  assert.equal(body.meta.support.classification, "defect_candidate");
  assert.ok(!JSON.stringify(body).includes("private memory"));
  assert.ok(!JSON.stringify(body).includes("provider stack"));
});
