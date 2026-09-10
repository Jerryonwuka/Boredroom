export type FieldErrors = Record<string, string[]>;

export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fieldErrors?: FieldErrors;
  readonly details?: Record<string, unknown>;
  constructor(status: number, code: string, message: string, extra?: { fieldErrors?: FieldErrors; details?: Record<string, unknown> }) {
    super(message);
    this.status = status;
    this.code = code;
    this.fieldErrors = extra?.fieldErrors;
    this.details = extra?.details;
  }
}

export const unauthenticated = (msg = "Sign in to continue.") => new AppError(401, "UNAUTHENTICATED", msg);
export const forbidden = (msg = "You are not allowed to do that.") => new AppError(403, "FORBIDDEN", msg);
export const notFound = (msg = "Not found.") => new AppError(404, "NOT_FOUND", msg);
export const conflict = (code: string, msg: string, details?: Record<string, unknown>) => new AppError(409, code, msg, { details });
export const invalid = (msg: string, fieldErrors?: FieldErrors) => new AppError(422, "INVALID_INPUT", msg, { fieldErrors });
export const rateLimited = (msg = "Too many attempts. Try again shortly.") => new AppError(429, "RATE_LIMITED", msg);
