import { describe, it, expect, beforeAll, vi } from 'vitest';
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

      // Verify it is a locally-signed JWT with correct claims
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
      // Role should NOT be in the JWT — Kong forces role=user for sk_* tokens
      expect(payload).not.toHaveProperty('role');
    });
  });

  describe('backward compatibility (no signingKey)', () => {
    it('mintToken falls back to HTTP mint when no signingKey is configured', async () => {
      // Mock global fetch to verify it tries HTTP mint
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          access_token: 'mock-jwt-from-mint',
          expires_in: 3600,
          expires_at: Math.floor(Date.now() / 1000) + 3600,
        }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const client = new BehestServerClient({
        apiKey: 'test-api-key',
        // No signingKey — should use HTTP mint
      });

      const token = await client.mintToken('user-123');

      expect(token.accessToken).toBe('mock-jwt-from-mint');
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Verify the HTTP request was made to the mint endpoint
      const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toContain('/auth/v1/auth/mint');
      expect(options.method).toBe('POST');
      expect(options.headers).toHaveProperty('Authorization', 'Bearer test-api-key');

      vi.unstubAllGlobals();
    });
  });

  describe('isTokenExpiringSoon', () => {
    it('works with locally signed tokens', async () => {
      const client = new BehestServerClient({
        apiKey: 'placeholder',
        signingKey: makeSigningConfig(),
      });

      const token = await client.mintToken('user-123', 'regular', 3600);

      // Token expires in 3600s, threshold is 300s by default — should not be expiring soon
      expect(client.isTokenExpiringSoon(token)).toBe(false);

      // With a huge threshold, it should be expiring soon
      expect(client.isTokenExpiringSoon(token, 4000)).toBe(true);
    });
  });
});
