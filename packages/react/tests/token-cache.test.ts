import { describe, it, expect, vi } from 'vitest';
import { createTokenCache } from '../src/token-cache';
import type { BehestTokenBundle } from '../src/types';

const FIXED_NOW = 1_700_000_000 * 1000;
const fixedNow = () => FIXED_NOW;

function bundle(overrides: Partial<BehestTokenBundle> = {}): BehestTokenBundle {
  return {
    token: 'tok_' + Math.random().toString(36).slice(2, 8),
    sessionId: 'sess_abc',
    ttl: 900,
    expiresAt: Math.floor(FIXED_NOW / 1000) + 900,
    ...overrides,
  };
}

describe('createTokenCache', () => {
  it('fetches on first get() and caches subsequent calls', async () => {
    const fetchToken = vi.fn().mockResolvedValue(bundle());
    const cache = createTokenCache({ fetchToken, now: fixedNow });

    const a = await cache.get();
    const b = await cache.get();

    expect(a).toBe(b);
    expect(fetchToken).toHaveBeenCalledTimes(1);
  });

  it('refetches when token is within the skew window', async () => {
    const expiresAt = Math.floor(FIXED_NOW / 1000) + 30; // 30s left
    const first = bundle({ expiresAt, token: 'old' });
    const second = bundle({ token: 'new' });

    const fetchToken = vi
      .fn<[], Promise<BehestTokenBundle>>()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);
    const cache = createTokenCache({
      fetchToken,
      refetchSkewSeconds: 60,
      now: fixedNow,
    });

    const a = await cache.get();
    const b = await cache.get();

    expect(a.token).toBe('old');
    expect(b.token).toBe('new');
    expect(fetchToken).toHaveBeenCalledTimes(2);
  });

  it('dedupes concurrent fetches', async () => {
    let resolve: (b: BehestTokenBundle) => void = () => {};
    const pending = new Promise<BehestTokenBundle>((r) => (resolve = r));
    const fetchToken = vi.fn().mockReturnValue(pending);

    const cache = createTokenCache({ fetchToken, now: fixedNow });

    const p1 = cache.get();
    const p2 = cache.get();
    const p3 = cache.get();

    resolve(bundle({ token: 'once' }));
    const [a, b, c] = await Promise.all([p1, p2, p3]);

    expect(a).toBe(b);
    expect(b).toBe(c);
    expect(fetchToken).toHaveBeenCalledTimes(1);
  });

  it('invalidate() forces a refetch on next get()', async () => {
    const fetchToken = vi
      .fn<[], Promise<BehestTokenBundle>>()
      .mockResolvedValueOnce(bundle({ token: 'first' }))
      .mockResolvedValueOnce(bundle({ token: 'second' }));
    const cache = createTokenCache({ fetchToken, now: fixedNow });

    await cache.get();
    cache.invalidate();
    const b = await cache.get();

    expect(b.token).toBe('second');
    expect(fetchToken).toHaveBeenCalledTimes(2);
  });

  it('peek() returns the cached bundle without fetching', async () => {
    const fetchToken = vi.fn().mockResolvedValue(bundle());
    const cache = createTokenCache({ fetchToken, now: fixedNow });

    expect(cache.peek()).toBeNull();
    await cache.get();
    expect(cache.peek()).not.toBeNull();
    expect(fetchToken).toHaveBeenCalledTimes(1);
  });

  it('rejects malformed fetch responses', async () => {
    const cache = createTokenCache({
      fetchToken: async () => ({ token: 'only' }) as unknown as BehestTokenBundle,
      now: fixedNow,
    });
    await expect(cache.get()).rejects.toThrow(/expiresAt/);
  });

  it('allows a subsequent fetch after a failed one', async () => {
    const fetchToken = vi
      .fn<[], Promise<BehestTokenBundle>>()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce(bundle({ token: 'ok' }));
    const cache = createTokenCache({ fetchToken, now: fixedNow });

    await expect(cache.get()).rejects.toThrow('network');
    const b = await cache.get();
    expect(b.token).toBe('ok');
    expect(fetchToken).toHaveBeenCalledTimes(2);
  });
});
