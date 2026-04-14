import { describe, it, expect, vi } from 'vitest';
import { ThreadsModule } from '../src/threads';
import { AuthModule } from '../src/auth';
import type { ResolvedConfig } from '../src/config';

const cfg: ResolvedConfig = {
  mode: 'apiKey',
  key: 'behest_sk_live_x',
  baseUrl: 'https://api.example',
  defaultUserId: 'default',
  ttl: 3600,
  issuer: 'i',
  audience: 'a',
};

function mockFetch(
  responses: Array<{ status: number; body?: any; headers?: Record<string, string> }>
) {
  let i = 0;
  return vi.fn().mockImplementation(async () => {
    const r = responses[Math.min(i++, responses.length - 1)];
    const body = r.body !== undefined ? JSON.stringify(r.body) : null;
    return new Response(body, {
      status: r.status,
      headers: { 'content-type': 'application/json', ...(r.headers ?? {}) },
    });
  });
}

describe('ThreadsModule', () => {
  it('list() GETs /v1/threads with auto-mint + X-Session-Id', async () => {
    const fetchFn = mockFetch([
      { status: 200, body: { jwt: 'tk', ttl: 60, session_id: 's_mint' } }, // mint
      { status: 200, body: [{ id: 't1' }, { id: 't2' }] }, // threads
    ]);
    const auth = new AuthModule({ ...cfg, fetch: fetchFn });
    const threads = new ThreadsModule({ ...cfg, fetch: fetchFn }, auth);
    const result = await threads.list();
    expect(result).toEqual([{ id: 't1' }, { id: 't2' }]);
    const call = fetchFn.mock.calls[1];
    expect(call[0]).toBe('https://api.example/v1/threads');
    expect(call[1].method).toBe('GET');
    expect(call[1].headers.Authorization).toBe('Bearer tk');
    expect(call[1].headers['X-Session-Id']).toBe('s_mint');
  });

  it('get(id) GETs /v1/threads/:id', async () => {
    const fetchFn = mockFetch([
      { status: 200, body: { jwt: 'tk', ttl: 60 } },
      { status: 200, body: { id: 't1', messages_count: 3 } },
    ]);
    const auth = new AuthModule({ ...cfg, fetch: fetchFn });
    const threads = new ThreadsModule({ ...cfg, fetch: fetchFn }, auth);
    const t = await threads.get('t1');
    expect(t.id).toBe('t1');
    expect(fetchFn.mock.calls[1][0]).toBe('https://api.example/v1/threads/t1');
  });

  it('delete(id) DELETEs /v1/threads/:id and returns void', async () => {
    const fetchFn = mockFetch([
      { status: 200, body: { jwt: 'tk', ttl: 60 } },
      { status: 204 },
    ]);
    const auth = new AuthModule({ ...cfg, fetch: fetchFn });
    const threads = new ThreadsModule({ ...cfg, fetch: fetchFn }, auth);
    await threads.delete('t1');
    expect(fetchFn.mock.calls[1][1].method).toBe('DELETE');
  });

  it('messages(id) GETs /v1/threads/:id/messages', async () => {
    const fetchFn = mockFetch([
      { status: 200, body: { jwt: 'tk', ttl: 60 } },
      { status: 200, body: [{ role: 'user', content: 'hi' }] },
    ]);
    const auth = new AuthModule({ ...cfg, fetch: fetchFn });
    const threads = new ThreadsModule({ ...cfg, fetch: fetchFn }, auth);
    const msgs = await threads.messages('t1');
    expect(msgs[0].content).toBe('hi');
    expect(fetchFn.mock.calls[1][0]).toBe('https://api.example/v1/threads/t1/messages');
  });

  it('honors BYO token (skips auto-mint)', async () => {
    const fetchFn = mockFetch([{ status: 200, body: [] }]);
    const auth = new AuthModule({ ...cfg, fetch: fetchFn });
    const threads = new ThreadsModule({ ...cfg, fetch: fetchFn }, auth);
    await threads.list({ token: 'byot' });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn.mock.calls[0][1].headers.Authorization).toBe('Bearer byot');
  });
});
