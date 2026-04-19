/**
 * In-memory token cache shared across hooks in a single <BehestProvider>.
 *
 * - Refetches when the cached token is within `refetchSkewSeconds` of expiry.
 * - Dedupes concurrent callers: a single in-flight fetch is reused.
 * - `invalidate()` forces the next get() to refetch (used on 401 retry).
 */

import type { BehestTokenBundle, FetchBehestToken } from './types';

export interface TokenCacheOptions {
  fetchToken: FetchBehestToken;
  /** Seconds before expiresAt at which the cache considers the token stale. Default 60. */
  refetchSkewSeconds?: number;
  /** Override `Date.now()` for tests. */
  now?: () => number;
}

export interface TokenCache {
  get(): Promise<BehestTokenBundle>;
  invalidate(): void;
  /** Current cached bundle (or null) — for tests / diagnostics. Never triggers a fetch. */
  peek(): BehestTokenBundle | null;
}

export function createTokenCache(opts: TokenCacheOptions): TokenCache {
  const { fetchToken } = opts;
  const refetchSkewSeconds = opts.refetchSkewSeconds ?? 60;
  const now = opts.now ?? (() => Date.now());

  let cached: BehestTokenBundle | null = null;
  let inflight: Promise<BehestTokenBundle> | null = null;

  function fresh(bundle: BehestTokenBundle | null): bundle is BehestTokenBundle {
    if (!bundle) return false;
    const nowSec = Math.floor(now() / 1000);
    return bundle.expiresAt - nowSec > refetchSkewSeconds;
  }

  async function refetch(): Promise<BehestTokenBundle> {
    if (inflight) return inflight;
    inflight = (async () => {
      try {
        const bundle = await fetchToken();
        validateBundle(bundle);
        cached = bundle;
        return bundle;
      } finally {
        inflight = null;
      }
    })();
    return inflight;
  }

  return {
    async get(): Promise<BehestTokenBundle> {
      if (fresh(cached)) return cached;
      return refetch();
    },
    invalidate(): void {
      cached = null;
    },
    peek(): BehestTokenBundle | null {
      return cached;
    },
  };
}

function validateBundle(b: unknown): asserts b is BehestTokenBundle {
  if (!b || typeof b !== 'object') {
    throw new Error('[behest/react] fetchToken must resolve to an object with { token, sessionId, ttl, expiresAt }');
  }
  const bundle = b as Partial<BehestTokenBundle>;
  if (typeof bundle.token !== 'string' || !bundle.token) {
    throw new Error('[behest/react] fetchToken response is missing `token`');
  }
  if (typeof bundle.expiresAt !== 'number') {
    throw new Error('[behest/react] fetchToken response is missing numeric `expiresAt`');
  }
  if (typeof bundle.ttl !== 'number') {
    throw new Error('[behest/react] fetchToken response is missing numeric `ttl`');
  }
  if (typeof bundle.sessionId !== 'string') {
    throw new Error('[behest/react] fetchToken response is missing `sessionId`');
  }
}
