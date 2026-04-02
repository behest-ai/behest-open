import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { generateKeyPair, exportPKCS8, exportSPKI, importSPKI, jwtVerify, decodeJwt, decodeProtectedHeader } from 'jose';

import { signBehestJWT, clearSigningKeyCache, importSigningKey, type SigningKeyConfig, type SignTokenOptions, type SignTokenResult } from '../src/signing';

let privateKeyPem: string;
let publicKeyPem: string;

beforeAll(async () => {
  const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true });
  privateKeyPem = await exportPKCS8(privateKey);
  publicKeyPem = await exportSPKI(publicKey);
});

beforeEach(() => {
  clearSigningKeyCache();
});

const validConfig: () => SigningKeyConfig = () => ({
  privateKeyPem,
  keyId: 'sk_a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4',
  tenantId: '550e8400-e29b-41d4-a716-446655440000',
  projectId: '660e8400-e29b-41d4-a716-446655440001',
});

describe('signBehestJWT', () => {
  describe('JWT structure', () => {
    it('produces a JWT with correct header fields', async () => {
      const config = validConfig();
      const result = await signBehestJWT(config, { userId: 'alice' });
      const header = decodeProtectedHeader(result.accessToken);
      expect(header.alg).toBe('RS256');
      expect(header.kid).toBe(config.keyId);
      expect(header.typ).toBe('JWT');
    });

    it('includes all required payload claims', async () => {
      const config = validConfig();
      const result = await signBehestJWT(config, { userId: 'alice' });
      const payload = decodeJwt(result.accessToken);
      expect(payload.tid).toBe(config.tenantId);
      expect(payload.pid).toBe(config.projectId);
      expect(payload.uid).toBe('alice');
      expect(payload.iss).toBe('behest');
      expect(payload.aud).toBe('behest');
      expect(payload.iat).toBeDefined();
      expect(payload.nbf).toBeDefined();
      expect(payload.exp).toBeDefined();
    });

    it('sets iat and nbf to current time', async () => {
      const before = Math.floor(Date.now() / 1000);
      const result = await signBehestJWT(validConfig(), { userId: 'alice' });
      const after = Math.floor(Date.now() / 1000);
      const payload = decodeJwt(result.accessToken);
      expect(payload.iat).toBeGreaterThanOrEqual(before);
      expect(payload.iat).toBeLessThanOrEqual(after);
      expect(payload.nbf).toBe(payload.iat);
    });

    it('does NOT include a role claim', async () => {
      const result = await signBehestJWT(validConfig(), { userId: 'alice' });
      const payload = decodeJwt(result.accessToken);
      expect(payload).not.toHaveProperty('role');
    });
  });

  describe('token verification with public key', () => {
    it('produces a JWT verifiable with the corresponding public key', async () => {
      const result = await signBehestJWT(validConfig(), { userId: 'bob' });
      const pubKey = await importSPKI(publicKeyPem, 'RS256');
      const { payload } = await jwtVerify(result.accessToken, pubKey, {
        issuer: 'behest',
        audience: 'behest',
      });
      expect(payload.tid).toBe(validConfig().tenantId);
      expect(payload.pid).toBe(validConfig().projectId);
      expect(payload.uid).toBe('bob');
    });
  });

  describe('TTL handling', () => {
    it('defaults to 3600 seconds TTL', async () => {
      const result = await signBehestJWT(validConfig(), { userId: 'alice' });
      const payload = decodeJwt(result.accessToken);
      expect((payload.exp as number) - (payload.iat as number)).toBe(3600);
      expect(result.expiresIn).toBe(3600);
    });

    it('uses custom TTL when specified', async () => {
      const result = await signBehestJWT(validConfig(), { userId: 'alice', expiresIn: 300 });
      const payload = decodeJwt(result.accessToken);
      expect((payload.exp as number) - (payload.iat as number)).toBe(300);
      expect(result.expiresIn).toBe(300);
    });

    it('returns correct expiresAt timestamp', async () => {
      const before = Math.floor(Date.now() / 1000);
      const result = await signBehestJWT(validConfig(), { userId: 'alice', expiresIn: 600 });
      const after = Math.floor(Date.now() / 1000);
      expect(result.expiresAt).toBeGreaterThanOrEqual(before + 600);
      expect(result.expiresAt).toBeLessThanOrEqual(after + 600);
    });
  });

  describe('validation errors', () => {
    it('throws when keyId does not start with sk_', async () => {
      const config = { ...validConfig(), keyId: 'bad_key_id' };
      await expect(signBehestJWT(config, { userId: 'alice' })).rejects.toThrow(/sk_/);
    });

    it('throws when tenantId is empty', async () => {
      const config = { ...validConfig(), tenantId: '' };
      await expect(signBehestJWT(config, { userId: 'alice' })).rejects.toThrow(/tenantId/i);
    });

    it('throws when projectId is empty', async () => {
      const config = { ...validConfig(), projectId: '' };
      await expect(signBehestJWT(config, { userId: 'alice' })).rejects.toThrow(/projectId/i);
    });

    it('throws when userId is empty', async () => {
      await expect(signBehestJWT(validConfig(), { userId: '' })).rejects.toThrow(/userId/i);
    });

    it('throws when privateKeyPem is invalid', async () => {
      const config = { ...validConfig(), privateKeyPem: 'not-a-real-pem' };
      await expect(signBehestJWT(config, { userId: 'alice' })).rejects.toThrow();
    });

    it('throws for expiresIn below 60 seconds', async () => {
      await expect(signBehestJWT(validConfig(), { userId: 'alice', expiresIn: 30 })).rejects.toThrow(/expiresIn/i);
    });

    it('throws for expiresIn above 86400 seconds', async () => {
      await expect(signBehestJWT(validConfig(), { userId: 'alice', expiresIn: 100000 })).rejects.toThrow(/expiresIn/i);
    });
  });

  describe('return value shape', () => {
    it('returns accessToken, expiresAt, and expiresIn', async () => {
      const result = await signBehestJWT(validConfig(), { userId: 'alice' });
      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('expiresAt');
      expect(result).toHaveProperty('expiresIn');
      expect(typeof result.accessToken).toBe('string');
      expect(typeof result.expiresAt).toBe('number');
      expect(typeof result.expiresIn).toBe('number');
    });

    it('accessToken is a three-part JWT string', async () => {
      const result = await signBehestJWT(validConfig(), { userId: 'alice' });
      expect(result.accessToken.split('.')).toHaveLength(3);
    });
  });

  describe('projectId override', () => {
    it('uses options.projectId when provided', async () => {
      const overrideProjectId = '770e8400-e29b-41d4-a716-446655440099';
      const result = await signBehestJWT(validConfig(), { userId: 'alice', projectId: overrideProjectId });
      const payload = decodeJwt(result.accessToken);
      expect(payload.pid).toBe(overrideProjectId);
    });

    it('uses config.projectId when options.projectId is not provided', async () => {
      const result = await signBehestJWT(validConfig(), { userId: 'alice' });
      const payload = decodeJwt(result.accessToken);
      expect(payload.pid).toBe(validConfig().projectId);
    });
  });
});

describe('signing key cache', () => {
  it('clearSigningKeyCache clears the cache', async () => {
    await importSigningKey(validConfig().privateKeyPem);
    clearSigningKeyCache();
    const key = await importSigningKey(validConfig().privateKeyPem);
    expect(key).toBeDefined();
  });

  it('cache returns same key for same PEM', async () => {
    const key1 = await importSigningKey(validConfig().privateKeyPem);
    const key2 = await importSigningKey(validConfig().privateKeyPem);
    expect(key1).toBe(key2);
  });

  it('cache evicts oldest entry when max size (16) is exceeded', async () => {
    const keys: string[] = [];
    for (let i = 0; i < 17; i++) {
      const { privateKey } = await generateKeyPair('RS256', { extractable: true });
      keys.push(await exportPKCS8(privateKey));
    }

    const imported: CryptoKey[] = [];
    for (const pem of keys) {
      imported.push(await importSigningKey(pem));
    }

    const reimported = await importSigningKey(keys[0]);
    expect(reimported).not.toBe(imported[0]);

    const lastCached = await importSigningKey(keys[16]);
    expect(lastCached).toBe(imported[16]);
  });
});
