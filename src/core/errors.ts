/** Errors that are safe to render into the public error envelope. */
export class ApiError extends Error {
  status: number;
  code: string;
  /** Non-sensitive detail rendered into the error envelope's meta object. */
  meta?: Record<string, unknown>;

  constructor(
    status: number,
    code: string,
    message: string,
    meta?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.meta = meta;
  }
}

export type ErrorSupportClassification = "expected" | "investigate" | "defect_candidate";

export interface ErrorSupportGuidance {
  classification: ErrorSupportClassification;
  action: string;
  docs_url: string;
}

const ERROR_GUIDE = "https://titen.dev/docs/agent-integrations#error-triage";
const PROJECT_GUIDE = "https://titen.dev/docs/agent-integrations#project-resolution";

const EXPECTED_ACTIONS: Record<string, string> = {
  VALIDATION_ERROR: "Correct the request using the documented field contract, then retry once.",
  UNAUTHENTICATED: "Configure a valid credential without printing or storing it in memory.",
  FORBIDDEN: "Verify the principal scope and target grant; do not bypass authorization.",
  NOT_FOUND: "Verify the resource identifier and authorized scope without probing foreign records.",
  METHOD_NOT_ALLOWED: "Use the documented HTTP method for this route.",
  CONFLICT: "Reload canonical state and resolve the reported conflict before retrying.",
  UNRESOLVED_REFERENCE: "Resolve the reported import reference before applying the import again.",
};

/** Returns constant, public recovery guidance without copying error input. */
export function supportGuidance(error: ApiError): ErrorSupportGuidance {
  if (error.meta?.["reason"] === "project_not_registered") {
    return {
      classification: "expected",
      action: "Retry with create=true only after an authorized operator approves project creation.",
      docs_url: PROJECT_GUIDE,
    };
  }
  const expectedAction = EXPECTED_ACTIONS[error.code];
  if (expectedAction) {
    return {
      classification: "expected",
      action: expectedAction,
      docs_url: ERROR_GUIDE,
    };
  }
  if (error.code === "UNAVAILABLE" || error.status === 503) {
    return {
      classification: "investigate",
      action: "Check readiness and dependency state; retry only when the operation is safe to repeat.",
      docs_url: ERROR_GUIDE,
    };
  }
  return {
    classification: error.status >= 500 ? "defect_candidate" : "expected",
    action: error.status >= 500
      ? "Reproduce with synthetic input, remove sensitive data, and search existing issues before reporting."
      : "Verify the documented request and authorization contract before retrying.",
    docs_url: ERROR_GUIDE,
  };
}

export const validationError = (message: string) =>
  new ApiError(400, "VALIDATION_ERROR", message);

export const unauthenticated = () =>
  new ApiError(401, "UNAUTHENTICATED", "Credential is missing or invalid.");

export const forbidden = (message = "Operation is not permitted.") =>
  new ApiError(403, "FORBIDDEN", message);

/**
 * Foreign or unauthorized records must not disclose their existence, so every
 * cross-scope denial funnels through one indistinguishable response.
 */
export const notFound = (meta?: Record<string, unknown>) =>
  new ApiError(404, "NOT_FOUND", "Resource was not found.", meta);

export const conflict = (message: string) =>
  new ApiError(409, "CONFLICT", message);

export const unresolvedReference = (meta: Record<string, unknown>) =>
  new ApiError(422, "UNRESOLVED_REFERENCE", "Import contains an unresolved reference.", meta);

export const unavailable = (message: string, meta?: Record<string, unknown>) =>
  new ApiError(503, "UNAVAILABLE", message, meta);
