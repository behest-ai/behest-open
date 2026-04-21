import { describe, it, expect } from 'vitest';
import { generateSessionId, decodeToken } from '../src/helpers';

describe('generateSessionId', () => {
  it('returns a string with length > 0', () => {
    const id = generateSessionId();
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
  });

  it('returns unique values on consecutive calls', () => {
    const a = generateSessionId();
    const b = generateSessionId();
    expect(a).not.toBe(b);
  });

  it('matches UUIDv4 format', () => {
    const id = generateSessionId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });
});

describe('decodeToken', () => {
  // Sample JWT with base64url-encoded payload {"sub":"123","tid":"t1"}
  const sample =
    'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMiLCJ0aWQiOiJ0MSJ9.ignored-signature';

  it('decodes the JWT payload', () => {
    const payload = decodeToken(sample);
    expect(payload.sub).toBe('123');
    expect(payload.tid).toBe('t1');
  });

  it('throws on malformed token', () => {
    expect(() => decodeToken('not.a.jwt.token.extra')).toThrow();
    expect(() => decodeToken('onlyonepart')).toThrow();
  });

  it('handles base64url padding', () => {
    // {"a":"b"} → eyJhIjoiYiJ9 (no padding needed)
    const token = 'header.' + Buffer.from('{"a":"b"}', 'utf8').toString('base64url') + '.sig';
    expect(decodeToken(token)).toEqual({ a: 'b' });
  });
});
