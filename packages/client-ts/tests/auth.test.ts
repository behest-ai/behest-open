import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { generateKeyPairSync } from 'node:crypto';
import { decodeJwt, decodeProtectedHeader, jwtVerify, importSPKI } from 'jose';
import { AuthModule } from '../src/auth';
import type { ResolvedConfig } from '../src/config';
import { BehestAuthError, BehestConfigError } from '../src/errors';

function genKeyPair() {
  return generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
}

const { privateKey: TEST_PRIVATE_PEM, publicKey: TEST_PUBLIC_PEM } = genKeyPair();

const baseCfg: ResolvedConfig = {
  mode: 'apiKey',
  key: 'behest_sk_live_xxx',
  baseUrl: 'https://api.example',
  defaultUserId: 'default',
  ttl: 3600,
  issuer: 'https://api.behest.ai',
  audience: 'behest',
};

describe('AuthModule - apiKey mode', () => {
  it('POSTs /v1/auth/mint with Bearer key and returns server JWT', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          jwt: 'server.jwt.token',
          ttl: 3600,
          session_id: 's_123',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    );
    const auth = new AuthModule({ ...baseCfg, fetch: fetchMock });
    const result = await auth.mint({ user_id: 'u_1', session_id: 's_123', tier: 2 });
    expect(result.token).toBe('server.jwt.token');
    expect(result.sessionId).toBe('s_123');
    expect(result.ttl).toBe(3600);
    expect(result.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.example/v1/auth/mint');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer behest_sk_live_xxx');
    const body = JSON.parse(init.body);
    expect(body).toEqual({
      user_id: 'u_1',
      role: 'user',
      tier: 2,
      ttl: 3600,
      session_id: 's_123',
    });
  });

  it('auto-generates session_id when caller omits it', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ jwt: 't', ttl: 60 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    );
    const auth = new AuthModule({ ...baseCfg, fetch: fetchMock });
    const result = await auth.mint({ user_id: 'u_1' });
    expect(result.sessionId).toMatch(/^[0-9a-f]{8}-/i);
    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.session_id).toBe(result.sessionId);
  });

  it('401 response → BehestAuthError', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { code: 'invalid_token', message: 'bad key' } }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      })
    );
    const auth = new AuthModule({ ...baseCfg, fetch: fetchMock });
    await expect(auth.mint({ user_id: 'u_1' })).rejects.toBeInstanceOf(BehestAuthError);
  });

  it('network error → BehestServerError with code=network_error', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('ECONNREFUSED'));
    const auth = new AuthModule({ ...baseCfg, fetch: fetchMock });
    await expect(auth.mint({ user_id: 'u_1' })).rejects.toMatchObject({
      name: 'BehestServerError',
      code: 'network_error',
    });
  });

  it('defaults user_id to config.defaultUserId', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ jwt: 'x', ttl: 10 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    );
    const auth = new AuthModule({ ...baseCfg, defaultUserId: 'alice', fetch: fetchMock });
    await auth.mint();
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body).user_id).toBe('alice');
  });
});

describe('AuthModule - sign mode', () => {
  const signCfg: ResolvedConfig = {
    mode: 'sign',
    key: TEST_PRIVATE_PEM,
    baseUrl: 'https://api.example',
    defaultUserId: 'default',
    ttl: 900,
    issuer: 'https://api.behest.ai',
    audience: 'behest',
    kid: 'sk_kid_1',
    tenantId: 't_abc',
    projectId: 'p_xyz',
    tier: 2,
  };

  it('signs a valid RS256 JWT with all required claims in spec order', async () => {
    const auth = new AuthModule(signCfg);
    const result = await auth.mint({ user_id: 'u_1', session_id: 's_1' });

    expect(result.token.split('.').length).toBe(3);
    const header = decodeProtectedHeader(result.token);
    expect(header.alg).toBe('RS256');
    expect(header.kid).toBe('sk_kid_1');
    expect(header.typ).toBe('JWT');

    const claims = decodeJwt(result.token);
    expect(claims.tid).toBe('t_abc');
    expect(claims.pid).toBe('p_xyz');
    expect(claims.uid).toBe('u_1');
    expect(claims.role).toBe('user');
    expect(claims.scp).toEqual([]);
    expect(claims.iss).toBe('https://api.behest.ai');
    expect(claims.aud).toBe('behest');
    expect(claims.sid).toBe('s_1');
    expect(claims.tier).toBe(2);
    expect(claims.jti).toBeTruthy();
    expect(typeof claims.iat).toBe('number');
    expect(claims.nbf).toBe(claims.iat);
    expect(claims.exp).toBe((claims.iat as number) + 900);

    // Verify signature against public key.
    const pub = await importSPKI(TEST_PUBLIC_PEM, 'RS256');
    const verified = await jwtVerify(result.token, pub, {
      issuer: 'https://api.behest.ai',
      audience: 'behest',
    });
    expect(verified.payload.uid).toBe('u_1');
  });

  it('claim field order matches services/behest-auth/src/mint.ts:58-71', async () => {
    const auth = new AuthModule(signCfg);
    const result = await auth.mint({ user_id: 'u_1', session_id: 's_1' });
    const parts = result.token.split('.');
    const payloadJson = Buffer.from(parts[1], 'base64url').toString('utf8');
    const keys = Object.keys(JSON.parse(payloadJson));
    // Exact order per mint.ts; `sid` lives where session data lives; `tier` is appended last if set.
    expect(keys).toEqual([
      'tid', 'pid', 'uid', 'role', 'scp',
      'iss', 'aud', 'iat', 'nbf', 'exp', 'jti',
      'sid', 'tier',
    ]);
  });

  it('omits tier when not set', async () => {
    const auth = new AuthModule({ ...signCfg, tier: undefined });
    const result = await auth.mint({ user_id: 'u' });
    const claims = decodeJwt(result.token);
    expect('tier' in claims).toBe(false);
  });

  it('opts.user_id overrides defaultUserId; opts.tier/ttl/role override config', async () => {
    const auth = new AuthModule(signCfg);
    const result = await auth.mint({ user_id: 'u_call', tier: 4, ttl: 120, role: 'admin' });
    const claims = decodeJwt(result.token);
    expect(claims.uid).toBe('u_call');
    expect(claims.tier).toBe(4);
    expect(claims.role).toBe('admin');
    expect(claims.exp).toBe((claims.iat as number) + 120);
  });

  it('auto-generates session_id if omitted and writes to sid claim', async () => {
    const auth = new AuthModule(signCfg);
    const result = await auth.mint({ user_id: 'u' });
    const claims = decodeJwt(result.token);
    expect(claims.sid).toBe(result.sessionId);
    expect(result.sessionId).toMatch(/^[0-9a-f]{8}-/i);
  });

  it('sign mode does not call fetch', async () => {
    const fetchMock = vi.fn();
    const auth = new AuthModule({ ...signCfg, fetch: fetchMock });
    await auth.mint({ user_id: 'u' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('browser safety: construction throws when window is defined in sign mode', () => {
    const g: any = globalThis;
    const originalWindow = g.window;
    g.window = {};
    try {
      expect(() => new AuthModule(signCfg)).toThrow(BehestConfigError);
    } finally {
      if (originalWindow === undefined) delete g.window;
      else g.window = originalWindow;
    }
  });

  it('browser safety: apiKey mode works fine when window is defined', () => {
    const g: any = globalThis;
    const originalWindow = g.window;
    g.window = {};
    try {
      expect(() => new AuthModule(baseCfg)).not.toThrow();
    } finally {
      if (originalWindow === undefined) delete g.window;
      else g.window = originalWindow;
    }
  });

  it('invalid PEM in sign mode throws BehestConfigError on mint()', async () => {
    const bad: ResolvedConfig = { ...signCfg, key: 'not-a-pem' };
    const auth = new AuthModule(bad);
    await expect(auth.mint({ user_id: 'u' })).rejects.toBeInstanceOf(BehestConfigError);
  });
});
