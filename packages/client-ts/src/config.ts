/**
 * BEHEST_KEY mode detection and config resolution (v1.5).
 *
 * See SDK_SPEC.md §2.1 — detection runs once at `new Behest()` time, not per-call.
 */

import { BehestConfigError } from './errors';

export type Mode = 'apiKey' | 'sign';

export interface ResolvedConfig {
  mode: Mode;
  /** API key (apiKey mode) or PEM string (sign mode) after unwrap. */
  key: string;
  baseUrl: string;
  defaultUserId: string;
  ttl: number;
  tier?: number;
  // sign mode required fields
  kid?: string;
  tenantId?: string;
  projectId?: string;
  issuer: string;
  audience: string;
  /** Optional custom fetch (undici / polyfill hook). */
  fetch?: typeof globalThis.fetch;
}

export interface BehestInit {
  /** Unified entry. Overrides env BEHEST_KEY. */
  key?: string;
  /** @deprecated Use `key`. */
  apiKey?: string;
  tenantId?: string;
  projectId?: string;
  kid?: string;
  baseUrl?: string;
  defaultUserId?: string;
  tier?: number;
  ttl?: number;
  issuer?: string;
  audience?: string;
  fetch?: typeof globalThis.fetch;
  /** Injection point for deprecation warnings (tests override). */
  warn?: (message: string) => void;
}

const DEFAULT_BASE_URL = 'https://api.behest.ai';
const DEFAULT_USER_ID = 'default';
const DEFAULT_TTL = 3600;
const DEFAULT_ISSUER = 'https://api.behest.ai';
const DEFAULT_AUDIENCE = 'behest';

function defaultWarn(message: string): void {
  // eslint-disable-next-line no-console
  console.warn(`[behest] ${message}`);
}

const warnOnceRegistry = new Set<string>();
function warnOnce(warn: (m: string) => void, tag: string, message: string): void {
  if (warnOnceRegistry.has(tag)) return;
  warnOnceRegistry.add(tag);
  warn(message);
}

/** @internal for tests */
export function __resetDeprecationWarnings(): void {
  warnOnceRegistry.clear();
}

export function detectMode(rawKey: string): { mode: Mode; key: string } {
  const key = (rawKey ?? '').trim();
  if (!key) {
    throw new BehestConfigError(
      'BEHEST_KEY must be an API key (behest_sk_live_*) or a base64-encoded RSA private key',
      { code: 'missing_env' }
    );
  }

  if (key.startsWith('behest_sk_live_')) {
    return { mode: 'apiKey', key };
  }

  if (key.startsWith('behest_pk_')) {
    return { mode: 'sign', key: key.slice('behest_pk_'.length) };
  }

  // Try base64-wrapped PEM fallback.
  try {
    const decoded = Buffer.from(key, 'base64').toString('utf8');
    if (decoded.includes('BEGIN PRIVATE KEY') || decoded.includes('BEGIN RSA PRIVATE KEY')) {
      return { mode: 'sign', key: decoded };
    }
  } catch {
    // fallthrough to error
  }

  throw new BehestConfigError(
    'BEHEST_KEY must be an API key (behest_sk_live_*) or a base64-encoded RSA private key'
  );
}

export function resolveConfig(init: BehestInit = {}): ResolvedConfig {
  const warn = init.warn ?? defaultWarn;

  // Resolve key: explicit options win, then env.
  let key = init.key ?? '';

  if (!key && init.apiKey) {
    warnOnce(
      warn,
      'opt:apiKey',
      '`apiKey` is deprecated; use `key` instead. See https://docs.behest.ai/sdk/migrate-v1.5'
    );
    key = init.apiKey;
  }

  if (!key) {
    const envKey = process.env.BEHEST_KEY;
    if (envKey) {
      key = envKey;
    } else if (process.env.BEHEST_API_KEY) {
      warnOnce(
        warn,
        'env:BEHEST_API_KEY',
        '`BEHEST_API_KEY` is deprecated; rename to `BEHEST_KEY`. Both are read in v1.5; v2.0 drops the alias.'
      );
      key = process.env.BEHEST_API_KEY;
    }
  }

  if (!key) {
    throw new BehestConfigError(
      'BEHEST_KEY is required but was not set (no BEHEST_KEY or legacy BEHEST_API_KEY in env, and no `key` option passed).',
      { code: 'missing_env' }
    );
  }

  const detected = detectMode(key);

  const baseUrl = init.baseUrl ?? process.env.BEHEST_BASE_URL ?? DEFAULT_BASE_URL;
  const defaultUserId =
    init.defaultUserId ?? process.env.BEHEST_USER_ID ?? DEFAULT_USER_ID;
  const ttl = init.ttl ?? (process.env.BEHEST_TTL ? Number(process.env.BEHEST_TTL) : DEFAULT_TTL);
  const tier =
    init.tier ?? (process.env.BEHEST_TIER ? Number(process.env.BEHEST_TIER) : undefined);
  const issuer = init.issuer ?? process.env.BEHEST_ISSUER ?? DEFAULT_ISSUER;
  const audience = init.audience ?? process.env.BEHEST_AUDIENCE ?? DEFAULT_AUDIENCE;

  const cfg: ResolvedConfig = {
    mode: detected.mode,
    key: detected.key,
    baseUrl,
    defaultUserId,
    ttl,
    tier,
    issuer,
    audience,
    fetch: init.fetch,
  };

  if (detected.mode === 'sign') {
    const kid = init.kid ?? process.env.BEHEST_KID;
    const tenantId = init.tenantId ?? process.env.BEHEST_TENANT_ID;
    const projectId = init.projectId ?? process.env.BEHEST_PROJECT_ID;
    const missing: string[] = [];
    if (!kid) missing.push('BEHEST_KID');
    if (!tenantId) missing.push('BEHEST_TENANT_ID');
    if (!projectId) missing.push('BEHEST_PROJECT_ID');
    if (missing.length) {
      throw new BehestConfigError(
        `Sign mode requires ${missing.join(', ')}. Provide them via env or constructor options.`,
        { code: 'missing_env' }
      );
    }
    cfg.kid = kid!;
    cfg.tenantId = tenantId!;
    cfg.projectId = projectId!;
  }

  return cfg;
}
