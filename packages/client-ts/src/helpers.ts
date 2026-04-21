/**
 * SDK helpers (v1.5). See SDK_SPEC.md §3.6.
 */

export interface BehestClaims {
  tid?: string;
  pid?: string;
  uid?: string;
  role?: string;
  scp?: string[];
  tier?: number | string;
  sid?: string;
  iss?: string;
  aud?: string;
  iat?: number;
  nbf?: number;
  exp?: number;
  jti?: string;
  [key: string]: unknown;
}

/**
 * Generate a session id (UUIDv4) suitable for the JWT `sid` claim and the
 * `X-Session-Id` request header.
 *
 * Uses `crypto.randomUUID()` when available (Node 16.14+, all modern browsers
 * and edge runtimes) and falls back to a v4 implementation backed by
 * `crypto.getRandomValues` otherwise.
 */
export function generateSessionId(): string {
  const g: { crypto?: Crypto } = (globalThis as unknown) as { crypto?: Crypto };
  if (g.crypto && typeof g.crypto.randomUUID === 'function') {
    return g.crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (g.crypto && typeof g.crypto.getRandomValues === 'function') {
    g.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex: string[] = [];
  for (let i = 0; i < 16; i++) hex.push(bytes[i].toString(16).padStart(2, '0'));
  return (
    hex.slice(0, 4).join('') +
    '-' +
    hex.slice(4, 6).join('') +
    '-' +
    hex.slice(6, 8).join('') +
    '-' +
    hex.slice(8, 10).join('') +
    '-' +
    hex.slice(10, 16).join('')
  );
}

/**
 * Decode a JWT's payload without verifying its signature.
 *
 * Use this to read claims like `sid`, `exp`, and `uid` from a minted token.
 * DO NOT rely on this for authentication — verification happens server-side.
 */
export function decodeToken(jwt: string): BehestClaims {
  const parts = jwt.split('.');
  if (parts.length !== 3) {
    throw new Error('decodeToken: expected a 3-part JWT (header.payload.signature)');
  }
  const payload = parts[1];
  const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
  const padding = normalized.length % 4 === 0 ? 0 : 4 - (normalized.length % 4);
  const padded = normalized + '='.repeat(padding);
  const json =
    typeof Buffer !== 'undefined'
      ? Buffer.from(padded, 'base64').toString('utf8')
      : atob(padded);
  return JSON.parse(json) as BehestClaims;
}
