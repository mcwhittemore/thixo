/** Throw one from a handler to answer with that status. Every error body is `{ error: { code, message } }`. */
export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(status: number, message: string, options: { code?: string; details?: Record<string, unknown> } = {}) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = options.code ?? defaultCode(status);
    this.details = options.details;
  }
}

function defaultCode(status: number): string {
  switch (status) {
    case 400: return "bad_request";
    case 401: return "unauthorized";
    case 403: return "forbidden";
    case 404: return "not_found";
    case 409: return "conflict";
    default: return status >= 500 ? "internal" : "error";
  }
}

export function isHttpError(value: unknown): value is HttpError {
  return value instanceof HttpError || (value instanceof Error && value.name === "HttpError" && typeof (value as HttpError).status === "number");
}
