import { describe, it, expect } from 'vitest';
import {
  BehestError,
  BehestAuthError,
  BehestQuotaError,
  BehestRateLimitError,
  BehestServerError,
  BehestBadRequestError,
  BehestConfigError,
  classifyHttpError,
} from '../src/errors';

describe('BehestError taxonomy', () => {
  it('BehestError is a subclass of Error with status/code/traceId/raw', () => {
    const err = new BehestError('boom', {
      status: 500,
      code: 'server_error',
      traceId: 'abc',
      raw: { foo: 'bar' },
    });
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('BehestError');
    expect(err.status).toBe(500);
    expect(err.code).toBe('server_error');
    expect(err.traceId).toBe('abc');
    expect(err.raw).toEqual({ foo: 'bar' });
    expect(err.message).toBe('boom');
  });

  it('BehestConfigError has no status and code defaults to bad_key_format', () => {
    const err = new BehestConfigError('bad');
    expect(err).toBeInstanceOf(BehestError);
    expect(err.name).toBe('BehestConfigError');
    expect(err.status).toBeUndefined();
    expect(err.code).toBe('bad_key_format');
  });

  it('BehestAuthError defaults status=401 and code=invalid_token', () => {
    const err = new BehestAuthError('unauth');
    expect(err).toBeInstanceOf(BehestError);
    expect(err.name).toBe('BehestAuthError');
    expect(err.status).toBe(401);
    expect(err.code).toBe('invalid_token');
  });

  it('BehestQuotaError defaults status=402 and code=quota_exceeded', () => {
    const err = new BehestQuotaError('quota');
    expect(err.name).toBe('BehestQuotaError');
    expect(err.status).toBe(402);
    expect(err.code).toBe('quota_exceeded');
  });

  it('BehestRateLimitError defaults status=429, code=rate_limited, retryAfter', () => {
    const err = new BehestRateLimitError('slow down', { retryAfter: 5 });
    expect(err.name).toBe('BehestRateLimitError');
    expect(err.status).toBe(429);
    expect(err.code).toBe('rate_limited');
    expect(err.retryAfter).toBe(5);
  });

  it('BehestServerError defaults status=500, code=server_error', () => {
    const err = new BehestServerError('boom');
    expect(err.name).toBe('BehestServerError');
    expect(err.status).toBe(500);
    expect(err.code).toBe('server_error');
  });

  it('BehestBadRequestError defaults status=400, code=validation_error', () => {
    const err = new BehestBadRequestError('bad');
    expect(err.name).toBe('BehestBadRequestError');
    expect(err.status).toBe(400);
    expect(err.code).toBe('validation_error');
  });
});

describe('classifyHttpError', () => {
  const mkResponse = (status: number, body: any = {}, headers: Record<string, string> = {}) => ({
    status,
    headers: new Headers(headers),
    body,
  });

  it('401 → BehestAuthError', async () => {
    const err = classifyHttpError(mkResponse(401, { error: { code: 'invalid_token', message: 'bad' } }));
    expect(err).toBeInstanceOf(BehestAuthError);
    expect(err.status).toBe(401);
    expect(err.code).toBe('invalid_token');
  });

  it('403 → BehestAuthError with code=forbidden', () => {
    const err = classifyHttpError(mkResponse(403, { error: { code: 'forbidden' } }));
    expect(err).toBeInstanceOf(BehestAuthError);
    expect(err.status).toBe(403);
  });

  it('402 → BehestQuotaError', () => {
    const err = classifyHttpError(mkResponse(402, { error: { code: 'tier_limit' } }));
    expect(err).toBeInstanceOf(BehestQuotaError);
    expect(err.code).toBe('tier_limit');
  });

  it('429 → BehestRateLimitError with Retry-After', () => {
    const err = classifyHttpError(mkResponse(429, {}, { 'Retry-After': '7' })) as BehestRateLimitError;
    expect(err).toBeInstanceOf(BehestRateLimitError);
    expect(err.retryAfter).toBe(7);
  });

  it('500 → BehestServerError', () => {
    const err = classifyHttpError(mkResponse(500));
    expect(err).toBeInstanceOf(BehestServerError);
  });

  it('502 → BehestServerError with upstream_error', () => {
    const err = classifyHttpError(mkResponse(502, { error: { code: 'upstream_error' } }));
    expect(err).toBeInstanceOf(BehestServerError);
    expect(err.code).toBe('upstream_error');
  });

  it('400 → BehestBadRequestError', () => {
    const err = classifyHttpError(mkResponse(400, { error: { message: 'bad body' } }));
    expect(err).toBeInstanceOf(BehestBadRequestError);
  });

  it('422 → BehestBadRequestError', () => {
    const err = classifyHttpError(mkResponse(422));
    expect(err).toBeInstanceOf(BehestBadRequestError);
  });

  it('unknown status → BehestError (generic)', () => {
    const err = classifyHttpError(mkResponse(418));
    expect(err).toBeInstanceOf(BehestError);
    expect(err.status).toBe(418);
  });

  it('captures X-Trace-Id header', () => {
    const err = classifyHttpError(mkResponse(500, {}, { 'X-Trace-Id': 'trace-xyz' }));
    expect(err.traceId).toBe('trace-xyz');
  });
});
