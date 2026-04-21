/**
 * Behest SDK typed error taxonomy (v1.5).
 *
 * All HTTP failures surface as subclasses of BehestError. See SDK_SPEC.md §3.7.
 */

export interface BehestErrorInit {
  status?: number;
  code?: string;
  traceId?: string;
  raw?: unknown;
}

export class BehestError extends Error {
  public readonly status?: number;
  public readonly code?: string;
  public readonly traceId?: string;
  public readonly raw?: unknown;

  constructor(message: string, init: BehestErrorInit = {}) {
    super(message);
    this.name = 'BehestError';
    this.status = init.status;
    this.code = init.code;
    this.traceId = init.traceId;
    this.raw = init.raw;
    // Restore prototype chain for instanceof across transpile targets.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class BehestConfigError extends BehestError {
  constructor(message: string, init: BehestErrorInit = {}) {
    super(message, { code: 'bad_key_format', ...init });
    this.name = 'BehestConfigError';
  }
}

export class BehestAuthError extends BehestError {
  constructor(message: string, init: BehestErrorInit = {}) {
    super(message, { status: 401, code: 'invalid_token', ...init });
    this.name = 'BehestAuthError';
  }
}

export class BehestQuotaError extends BehestError {
  constructor(message: string, init: BehestErrorInit = {}) {
    super(message, { status: 402, code: 'quota_exceeded', ...init });
    this.name = 'BehestQuotaError';
  }
}

export class BehestRateLimitError extends BehestError {
  public readonly retryAfter?: number;

  constructor(message: string, init: BehestErrorInit & { retryAfter?: number } = {}) {
    const { retryAfter, ...rest } = init;
    super(message, { status: 429, code: 'rate_limited', ...rest });
    this.name = 'BehestRateLimitError';
    this.retryAfter = retryAfter;
  }
}

export class BehestServerError extends BehestError {
  constructor(message: string, init: BehestErrorInit = {}) {
    super(message, { status: 500, code: 'server_error', ...init });
    this.name = 'BehestServerError';
  }
}

export class BehestBadRequestError extends BehestError {
  constructor(message: string, init: BehestErrorInit = {}) {
    super(message, { status: 400, code: 'validation_error', ...init });
    this.name = 'BehestBadRequestError';
  }
}

/** Minimal response shape accepted by classifyHttpError. */
export interface HttpErrorInput {
  status: number;
  headers: Headers;
  body?: unknown;
}

/**
 * Map an HTTP response (status + body + headers) to the appropriate typed error.
 *
 * Extracts code from body.error.code when available, message from body.error.message,
 * traceId from X-Trace-Id header, and retryAfter from Retry-After header for 429.
 */
export function classifyHttpError(resp: HttpErrorInput): BehestError {
  const body = resp.body as { error?: { code?: string; message?: string } } | undefined;
  const code = body?.error?.code;
  const messageFromBody = body?.error?.message;
  const traceId = resp.headers.get('X-Trace-Id') ?? resp.headers.get('x-trace-id') ?? undefined;
  const baseInit: BehestErrorInit = { status: resp.status, traceId, raw: resp.body };
  if (code) baseInit.code = code;
  const message = messageFromBody ?? `HTTP ${resp.status}`;

  if (resp.status === 401 || resp.status === 403) {
    const defaultCode = resp.status === 403 ? 'forbidden' : 'invalid_token';
    return new BehestAuthError(message, { ...baseInit, code: code ?? defaultCode });
  }
  if (resp.status === 402) {
    return new BehestQuotaError(message, { ...baseInit, code: code ?? 'quota_exceeded' });
  }
  if (resp.status === 429) {
    const retryAfterRaw =
      resp.headers.get('Retry-After') ?? resp.headers.get('retry-after') ?? undefined;
    const retryAfter = retryAfterRaw ? Number.parseInt(retryAfterRaw, 10) : undefined;
    return new BehestRateLimitError(message, {
      ...baseInit,
      code: code ?? 'rate_limited',
      retryAfter: Number.isFinite(retryAfter) ? retryAfter : undefined,
    });
  }
  if (resp.status >= 500) {
    return new BehestServerError(message, { ...baseInit, code: code ?? 'server_error' });
  }
  if (resp.status === 400 || resp.status === 422) {
    return new BehestBadRequestError(message, { ...baseInit, code: code ?? 'validation_error' });
  }
  return new BehestError(message, baseInit);
}
