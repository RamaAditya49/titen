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
export const notFound = () =>
  new ApiError(404, "NOT_FOUND", "Resource was not found.");

export const conflict = (message: string) =>
  new ApiError(409, "CONFLICT", message);

export const unavailable = (message: string, meta?: Record<string, unknown>) =>
  new ApiError(503, "UNAVAILABLE", message, meta);
