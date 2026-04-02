import { describe, it, expect, beforeAll } from 'vitest';
import { generateKeyPair, exportPKCS8, decodeJwt, decodeProtectedHeader } from 'jose';

import { BehestServerClient } from '../src/server';
import type { SigningKeyConfig } from '../src/signing';

let privateKeyPem: string;

beforeAll(async () => {
  const { privateKey } = await generateKeyPair('RS256', { extractable: true });
  privateKeyPem = await exportPKCS8(privateKey);
});

const makeSigningConfig = (): SigningKeyConfig => ({
  privateKeyPem,
  keyId: 'sk_a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4',
  tenantId: '550e8400-e29b-41d4-a716-446655440000',
  projectId: '660e8400-e29b-41d4-a716-446655440001',
});

describe('BehestServerClient with signingKey', () => {
  describe('local signing via mintToken', () => {
    it('mintToken signs locally when signingKey is configured', async () => {
      const client = new BehestServerClient({
        apiKey: 'placeholder',
        signingKey: makeSigningConfig(),
      });

      const token = await client.mintToken('user-123');

      expect(token.accessToken).toBeDefined();
      expect(typeof token.accessToken).toBe('string');

      const payload = decodeJwt(token.accessToken);
      expect(payload.tid).toBe(makeSigningConfig().tenantId);
      expect(payload.pid).toBe(makeSigningConfig().projectId);
      expect(payload.uid).toBe('user-123');
      expect(payload.iss).toBe('behest');
      expect(payload.aud).toBe('behest');

      const header = decodeProtectedHeader(token.accessToken);
      expect(header.kid).toBe(makeSigningConfig().keyId);
      expect(header.alg).toBe('RS256');
    });

    it('mintToken uses custom expiresIn', async () => {
      const client = new BehestServerClient({
        apiKey: 'placeholder',
        signingKey: makeSigningConfig(),
      });

      const token = await client.mintToken('user-123', 'regular', 600);

      const payload = decodeJwt(token.accessToken);
      const iat = payload.iat as number;
      const exp = payload.exp as number;
      expect(exp - iat).toBe(600);
      expect(token.expiresIn).toBe(600);
    });

    it('mintToken ignores role parameter for signing key tokens (Kong forces user)', async () => {
      const client = new BehestServerClient({
        apiKey: 'placeholder',
        signingKey: makeSigningConfig(),
      });

      const token = await client.mintToken('user-123', 'admin', 3600);

      const payload = decodeJwt(token.accessToken);
      expect(payload).not.toHaveProperty('role');
    });
  });

  describe('no signingKey configured', () => {
    it('mintToken throws when no signingKey is configured', async () => {
      const client = new BehestServerClient({
        apiKey: 'test-api-key',
      });

      await expect(client.mintToken('user-123')).rejects.toThrow(/No signingKey configured/);
    });
  });

  describe('isTokenExpiringSoon', () => {
    it('works with locally signed tokens', async () => {
      const client = new BehestServerClient({
        apiKey: 'placeholder',
        signingKey: makeSigningConfig(),
      });

      const token = await client.mintToken('user-123', 'regular', 3600);

      expect(client.isTokenExpiringSoon(token)).toBe(false);
      expect(client.isTokenExpiringSoon(token, 4000)).toBe(true);
    });
  });
});
