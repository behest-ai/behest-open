import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Behest } from '../src/behest';
import { BehestConfigError, BehestAuthError } from '../src/errors';

const TEST_PEM = `-----BEGIN PRIVATE KEY-----
MIIEvAIBADANBgkqhkiG9w0BAQEFAASCBKYwggSiAgEAAoIBAQDfake
-----END PRIVATE KEY-----`;

describe('Behest top-level class', () => {
  const savedEnv = { ...process.env };
  beforeEach(() => {
    for (const k of Object.keys(process.env)) {
      if (k.startsWith('BEHEST_')) delete process.env[k];
    }
  });
  afterEach(() => {
    process.env = { ...savedEnv };
  });

  it('new Behest() with no env throws BehestConfigError immediately', () => {
    expect(() => new Behest()).toThrow(BehestConfigError);
  });

  it('new Behest({ key }) constructs auth/chat/threads/usage modules', () => {
    const b = new Behest({ key: 'behest_sk_live_x' });
    expect(b.auth).toBeDefined();
    expect(b.chat).toBeDefined();
    expect(b.chat.completions).toBeDefined();
    expect(b.threads).toBeDefined();
    expect(b.usage).toBeDefined();
  });

  it('exposes mode on the instance', () => {
    const b = new Behest({ key: 'behest_sk_live_x' });
    expect(b.mode).toBe('apiKey');
  });

  it('sign-mode construction without kid/tenantId/projectId throws', () => {
    expect(() => new Behest({ key: 'behest_pk_' + TEST_PEM })).toThrow(BehestConfigError);
  });

  it('legacy apiKey option still works (with warning)', () => {
    const warnings: string[] = [];
    // @ts-expect-error - legacy alias
    const b = new Behest({ apiKey: 'behest_sk_live_leg', warn: (m: string) => warnings.push(m) });
    expect(b.mode).toBe('apiKey');
    expect(warnings.some((m) => m.toLowerCase().includes('apikey'))).toBe(true);
  });

  it('legacy mintToken({ userId }) aliases to auth.mint({ user_id })', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ jwt: 'legacy-token', ttl: 3600, session_id: 's_l' }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    );
    const warnings: string[] = [];
    const b = new Behest({
      key: 'behest_sk_live_x',
      fetch: fetchFn,
      warn: (m) => warnings.push(m),
    });
    const legacy = await b.mintToken({ userId: 'u_legacy' });
    // New shape fields should be present.
    expect(legacy.token).toBe('legacy-token');
    expect(legacy.sessionId).toBe('s_l');
    // Legacy shape fields should also be present.
    expect(legacy.access_token).toBe('legacy-token');
    expect(legacy.expires_in).toBe(3600);
    // Body should have user_id (new schema).
    const body = JSON.parse(fetchFn.mock.calls[0][1].body);
    expect(body.user_id).toBe('u_legacy');
    // Warning emitted.
    expect(warnings.some((m) => m.includes('mintToken'))).toBe(true);
  });

  it('forwards errors from auth.mint through new Behest', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { code: 'invalid_token' } }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      })
    );
    const b = new Behest({ key: 'behest_sk_live_x', fetch: fetchFn });
    await expect(b.auth.mint()).rejects.toBeInstanceOf(BehestAuthError);
  });
});

describe('Behest — explicit options merge with env', () => {
  const savedEnv = { ...process.env };
  beforeEach(() => {
    for (const k of Object.keys(process.env)) {
      if (k.startsWith('BEHEST_')) delete process.env[k];
    }
  });
  afterEach(() => {
    process.env = { ...savedEnv };
  });

  it('env provides defaults, explicit options override', () => {
    process.env.BEHEST_KEY = 'behest_sk_live_env';
    process.env.BEHEST_BASE_URL = 'https://env.example';
    const b = new Behest({ baseUrl: 'https://explicit.example' });
    expect((b as unknown as { config: { baseUrl: string } }).config.baseUrl).toBe(
      'https://explicit.example'
    );
  });
});
