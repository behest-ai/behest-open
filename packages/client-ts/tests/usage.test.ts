import { describe, it, expect, vi } from 'vitest';
import { UsageModule } from '../src/usage';
import { AuthModule } from '../src/auth';
import type { ResolvedConfig } from '../src/config';
import { BehestError } from '../src/errors';

const cfg: ResolvedConfig = {
  mode: 'apiKey',
  key: 'behest_sk_live_x',
  baseUrl: 'https://api.example',
  defaultUserId: 'default',
  ttl: 3600,
  issuer: 'i',
  audience: 'a',
};

function mkResp(status: number, body?: any) {
  const b = body !== undefined ? JSON.stringify(body) : null;
  return new Response(b, { status, headers: { 'content-type': 'application/json' } });
}

describe('UsageModule', () => {
  it('get() GETs /v1/usage with query params', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(mkResp(200, { jwt: 'tk', ttl: 60 })) // mint
      .mockResolvedValueOnce(mkResp(200, { totals: { tokens: 100 }, breakdown: [] }));
    const auth = new AuthModule({ ...cfg, fetch: fetchFn });
    const usage = new UsageModule({ ...cfg, fetch: fetchFn }, auth);
    const report = await usage.get({
      from: '2026-04-01',
      to: '2026-04-13',
      granularity: 'day',
      user_id: 'u_1',
    });
    expect(report.totals.tokens).toBe(100);
    const url = fetchFn.mock.calls[1][0];
    expect(url).toContain('/v1/usage?');
    expect(url).toContain('from=2026-04-01');
    expect(url).toContain('to=2026-04-13');
    expect(url).toContain('granularity=day');
    expect(url).toContain('user_id=u_1');
  });

  it('serializes Date objects to ISO strings', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(mkResp(200, { jwt: 'tk', ttl: 60 }))
      .mockResolvedValueOnce(mkResp(200, { totals: {}, breakdown: [] }));
    const auth = new AuthModule({ ...cfg, fetch: fetchFn });
    const usage = new UsageModule({ ...cfg, fetch: fetchFn }, auth);
    const d = new Date('2026-04-10T00:00:00Z');
    await usage.get({ from: d });
    expect(fetchFn.mock.calls[1][0]).toContain('from=2026-04-10T00%3A00%3A00.000Z');
  });

  it('404 → BehestError with code=not_supported (capability gate)', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(mkResp(200, { jwt: 'tk', ttl: 60 }))
      .mockResolvedValueOnce(mkResp(404, { error: { message: 'endpoint not shipped yet' } }));
    const auth = new AuthModule({ ...cfg, fetch: fetchFn });
    const usage = new UsageModule({ ...cfg, fetch: fetchFn }, auth);
    await expect(usage.get()).rejects.toSatisfy((e: unknown) => {
      const err = e as { name?: string; code?: string };
      return e instanceof BehestError && err.name === 'BehestError' && err.code === 'not_supported';
    });
  });
});
