import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolveConfig, detectMode } from '../src/config';
import { BehestConfigError } from '../src/errors';

const TEST_PEM = `-----BEGIN PRIVATE KEY-----
MIIEvAIBADANBgkqhkiG9w0BAQEFAASCBKYwggSiAgEAAoIBAQDfake
-----END PRIVATE KEY-----`;

const TEST_PEM_B64 = Buffer.from(TEST_PEM, 'utf8').toString('base64');

describe('detectMode', () => {
  it('behest_sk_live_ prefix → apiKey mode', () => {
    expect(detectMode('behest_sk_live_abc123')).toEqual({ mode: 'apiKey', key: 'behest_sk_live_abc123' });
  });

  it('behest_pk_ prefix → sign mode with raw PEM unwrapped', () => {
    const key = 'behest_pk_' + TEST_PEM;
    const got = detectMode(key);
    expect(got.mode).toBe('sign');
    expect(got.key).toBe(TEST_PEM);
  });

  it('base64-wrapped PEM (no prefix) → sign mode', () => {
    const got = detectMode(TEST_PEM_B64);
    expect(got.mode).toBe('sign');
    expect(got.key).toContain('BEGIN PRIVATE KEY');
  });

  it('strips leading/trailing whitespace before detection', () => {
    const got = detectMode('  behest_sk_live_xyz  \n');
    expect(got.mode).toBe('apiKey');
    expect(got.key).toBe('behest_sk_live_xyz');
  });

  it('raw PEM (no prefix, not base64) → BehestConfigError', () => {
    expect(() => detectMode('not-a-valid-key')).toThrow(BehestConfigError);
  });

  it('empty string → BehestConfigError', () => {
    expect(() => detectMode('')).toThrow(BehestConfigError);
  });

  it('garbage base64 that does not contain PEM markers → BehestConfigError', () => {
    const notPem = Buffer.from('hello world', 'utf8').toString('base64');
    expect(() => detectMode(notPem)).toThrow(BehestConfigError);
  });
});

describe('resolveConfig', () => {
  const savedEnv = { ...process.env };

  beforeEach(() => {
    for (const k of Object.keys(process.env)) {
      if (k.startsWith('BEHEST_')) delete process.env[k];
    }
  });

  afterEach(() => {
    process.env = { ...savedEnv };
  });

  it('reads BEHEST_KEY from env for apiKey mode', () => {
    process.env.BEHEST_KEY = 'behest_sk_live_test';
    const cfg = resolveConfig();
    expect(cfg.mode).toBe('apiKey');
    expect(cfg.key).toBe('behest_sk_live_test');
    expect(cfg.baseUrl).toBe('https://api.behest.ai');
    expect(cfg.defaultUserId).toBe('default');
    expect(cfg.ttl).toBe(3600);
  });

  it('falls back to BEHEST_API_KEY with deprecation warning', () => {
    const warnings: string[] = [];
    process.env.BEHEST_API_KEY = 'behest_sk_live_legacy';
    const cfg = resolveConfig({ warn: (msg) => warnings.push(msg) });
    expect(cfg.mode).toBe('apiKey');
    expect(cfg.key).toBe('behest_sk_live_legacy');
    expect(warnings.some((m) => m.includes('BEHEST_API_KEY'))).toBe(true);
  });

  it('explicit options override env', () => {
    process.env.BEHEST_KEY = 'behest_sk_live_env';
    const cfg = resolveConfig({ key: 'behest_sk_live_explicit' });
    expect(cfg.key).toBe('behest_sk_live_explicit');
  });

  it('apiKey option aliases to key with deprecation warning', () => {
    const warnings: string[] = [];
    const cfg = resolveConfig({ apiKey: 'behest_sk_live_alias', warn: (m) => warnings.push(m) });
    expect(cfg.mode).toBe('apiKey');
    expect(cfg.key).toBe('behest_sk_live_alias');
    expect(warnings.some((m) => m.toLowerCase().includes('apikey'))).toBe(true);
  });

  it('sign mode requires kid, tenantId, projectId (throws BehestConfigError otherwise)', () => {
    process.env.BEHEST_KEY = 'behest_pk_' + TEST_PEM;
    expect(() => resolveConfig()).toThrow(BehestConfigError);
  });

  it('sign mode with full env resolves correctly', () => {
    process.env.BEHEST_KEY = 'behest_pk_' + TEST_PEM;
    process.env.BEHEST_KID = 'sk_abc';
    process.env.BEHEST_TENANT_ID = 't1';
    process.env.BEHEST_PROJECT_ID = 'p1';
    const cfg = resolveConfig();
    expect(cfg.mode).toBe('sign');
    expect(cfg.kid).toBe('sk_abc');
    expect(cfg.tenantId).toBe('t1');
    expect(cfg.projectId).toBe('p1');
    expect(cfg.issuer).toBe('https://api.behest.ai');
    expect(cfg.audience).toBe('behest');
  });

  it('missing BEHEST_KEY throws BehestConfigError', () => {
    expect(() => resolveConfig()).toThrow(BehestConfigError);
  });

  it('BEHEST_BASE_URL, BEHEST_USER_ID, BEHEST_TTL, BEHEST_TIER, BEHEST_ISSUER, BEHEST_AUDIENCE respected', () => {
    process.env.BEHEST_KEY = 'behest_sk_live_test';
    process.env.BEHEST_BASE_URL = 'https://custom.example';
    process.env.BEHEST_USER_ID = 'alice';
    process.env.BEHEST_TTL = '900';
    process.env.BEHEST_TIER = '3';
    process.env.BEHEST_ISSUER = 'custom-iss';
    process.env.BEHEST_AUDIENCE = 'custom-aud';
    const cfg = resolveConfig();
    expect(cfg.baseUrl).toBe('https://custom.example');
    expect(cfg.defaultUserId).toBe('alice');
    expect(cfg.ttl).toBe(900);
    expect(cfg.tier).toBe(3);
    expect(cfg.issuer).toBe('custom-iss');
    expect(cfg.audience).toBe('custom-aud');
  });
});
