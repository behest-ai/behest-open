/**
 * Shared HTTP helpers for the v1.5 SDK modules (chat, threads, usage).
 *
 * Every call goes through authenticatedRequest(), which auto-mints a token
 * when one isn't supplied, injects X-Session-Id when available, and maps
 * failures to the typed error taxonomy.
 */

import type { AuthModule, MintResult } from './auth';
import type { ResolvedConfig } from './config';
import { BehestServerError, classifyHttpError } from './errors';

export interface CallOptions {
  /** Optional per-call session id (overrides auth.lastSessionId). */
  sessionId?: string;
  /** BYO minted token (skips auto-mint). */
  token?: string;
  /** AbortSignal forwarded to fetch. */
  signal?: AbortSignal;
  /** Extra headers. */
  headers?: Record<string, string>;
  /** user_id / tier context for the auto-mint call. */
  userId?: string;
  tier?: number;
}

export async function resolveToken(
  auth: AuthModule,
  opts: CallOptions
): Promise<string> {
  if (opts.token) return opts.token;
  const minted: MintResult = await auth.mint({
    user_id: opts.userId,
    tier: opts.tier,
    session_id: opts.sessionId,
  });
  return minted.token;
}

export function buildUrl(cfg: ResolvedConfig, path: string, query?: Record<string, unknown>): string {
  const base = cfg.baseUrl.replace(/\/$/, '');
  let full = `${base}${path.startsWith('/') ? path : `/${path}`}`;
  if (query) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null) continue;
      params.set(k, typeof v === 'string' ? v : String(v));
    }
    const qs = params.toString();
    if (qs) full += (full.includes('?') ? '&' : '?') + qs;
  }
  return full;
}

export function sessionHeaderValue(
  auth: AuthModule,
  opts: CallOptions
): string | undefined {
  return opts.sessionId ?? auth.lastSessionId;
}

export async function jsonRequest<T>(
  cfg: ResolvedConfig,
  auth: AuthModule,
  method: 'GET' | 'POST' | 'DELETE' | 'PUT' | 'PATCH',
  path: string,
  opts: CallOptions & { body?: unknown; query?: Record<string, unknown> } = {}
): Promise<T> {
  const fetchFn = cfg.fetch ?? globalThis.fetch;
  const token = await resolveToken(auth, opts);
  const url = buildUrl(cfg, path, opts.query);

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
    ...(opts.headers ?? {}),
  };
  const sid = sessionHeaderValue(auth, opts);
  if (sid) headers['X-Session-Id'] = sid;
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';

  let resp: Response;
  try {
    resp = await fetchFn(url, {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: opts.signal,
    });
  } catch (err) {
    throw new BehestServerError(
      `Network error calling ${method} ${url}: ${err instanceof Error ? err.message : String(err)}`,
      { code: 'network_error', raw: err }
    );
  }

  if (!resp.ok) {
    const parsed = await safeJson(resp);
    throw classifyHttpError({ status: resp.status, headers: resp.headers, body: parsed });
  }

  if (resp.status === 204) return undefined as unknown as T;
  return (await safeJson(resp)) as T;
}

export async function safeJson(resp: Response): Promise<unknown> {
  try {
    const text = await resp.text();
    if (!text) return undefined;
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  } catch {
    return undefined;
  }
}
