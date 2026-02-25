import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BehestClient, BehestClientOptions, OpenAI } from '../src/index';

describe('BehestClient', () => {
  const savedEnv = { ...process.env };

  beforeEach(() => {
    delete process.env['BEHEST_API_KEY'];
    delete process.env['BEHEST_BASE_URL'];
    delete process.env['OPENAI_API_KEY'];
  });

  afterEach(() => {
    process.env = { ...savedEnv };
  });

  it('uses default baseURL https://api.behest.ai/v1', () => {
    const client = new BehestClient({ apiKey: 'test-key' });
    expect(client.baseURL).toBe('https://api.behest.ai/v1');
  });

  it('falls back to BEHEST_API_KEY env var when apiKey not provided', () => {
    process.env['BEHEST_API_KEY'] = 'env-key';
    const client = new BehestClient({});
    expect(client.apiKey).toBe('env-key');
  });

  it('falls back to BEHEST_BASE_URL env var when baseURL not provided', () => {
    process.env['BEHEST_BASE_URL'] = 'https://custom.behest.ai/v1';
    const client = new BehestClient({ apiKey: 'test-key' });
    expect(client.baseURL).toBe('https://custom.behest.ai/v1');
  });

  it('explicit options override env vars', () => {
    process.env['BEHEST_API_KEY'] = 'env-key';
    process.env['BEHEST_BASE_URL'] = 'https://env.behest.ai/v1';
    const client = new BehestClient({
      apiKey: 'explicit-key',
      baseURL: 'https://explicit.behest.ai/v1',
    });
    expect(client.apiKey).toBe('explicit-key');
    expect(client.baseURL).toBe('https://explicit.behest.ai/v1');
  });

  it('injects X-End-User-Id header when endUserId is provided', () => {
    const client = new BehestClient({
      apiKey: 'test-key',
      endUserId: 'user-123',
    });
    const headers = client.defaultHeaders();
    expect(headers['X-End-User-Id']).toBe('user-123');
  });

  it('does not include X-End-User-Id when endUserId is omitted', () => {
    const client = new BehestClient({ apiKey: 'test-key' });
    const headers = client.defaultHeaders();
    expect(headers['X-End-User-Id']).toBeUndefined();
  });

  it('merges custom defaultHeaders with endUserId header', () => {
    const client = new BehestClient({
      apiKey: 'test-key',
      endUserId: 'user-456',
      defaultHeaders: { 'X-Custom': 'value' },
    });
    const headers = client.defaultHeaders();
    expect(headers['X-End-User-Id']).toBe('user-456');
    expect(headers['X-Custom']).toBe('value');
  });

  it('is an instance of OpenAI', () => {
    const client = new BehestClient({ apiKey: 'test-key' });
    expect(client).toBeInstanceOf(OpenAI);
  });
});

describe('package exports', () => {
  it('exports BehestClient class', () => {
    expect(BehestClient).toBeDefined();
    expect(typeof BehestClient).toBe('function');
  });

  it('re-exports OpenAI from openai package', () => {
    expect(OpenAI).toBeDefined();
    expect(typeof OpenAI).toBe('function');
  });
});
