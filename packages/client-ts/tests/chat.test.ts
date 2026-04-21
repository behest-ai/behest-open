import { describe, it, expect, vi } from 'vitest';
import { ChatModule } from '../src/chat';
import { AuthModule } from '../src/auth';
import type { ResolvedConfig } from '../src/config';
import { BehestAuthError, BehestError } from '../src/errors';

const cfg: ResolvedConfig = {
  mode: 'apiKey',
  key: 'behest_sk_live_x',
  baseUrl: 'https://api.example',
  defaultUserId: 'default',
  ttl: 3600,
  issuer: 'i',
  audience: 'a',
};

function jsonResponse(status: number, body: any) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function sseResponse(chunks: string[], status = 200) {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
  return new Response(stream, {
    status,
    headers: { 'content-type': 'text/event-stream' },
  });
}

describe('ChatModule.completions.create (non-streaming)', () => {
  it('POSTs /v1/chat/completions with Bearer token, body, and X-Session-Id', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { jwt: 'tk', ttl: 60, session_id: 's_m' })) // mint
      .mockResolvedValueOnce(
        jsonResponse(200, {
          id: 'cmp_1',
          choices: [{ message: { role: 'assistant', content: 'hi' } }],
        })
      );
    const auth = new AuthModule({ ...cfg, fetch: fetchFn });
    const chat = new ChatModule({ ...cfg, fetch: fetchFn }, auth);
    const result = await chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'hi' }],
      session_id: 's_call',
    });
    expect(result.choices[0].message.content).toBe('hi');
    const call = fetchFn.mock.calls[1];
    expect(call[0]).toBe('https://api.example/v1/chat/completions');
    expect(call[1].method).toBe('POST');
    expect(call[1].headers.Authorization).toBe('Bearer tk');
    expect(call[1].headers['X-Session-Id']).toBe('s_call');
    const body = JSON.parse(call[1].body);
    expect(body.model).toBe('gpt-4o-mini');
    // session_id should NOT leak into the body — it's a header-only concern.
    expect(body.session_id).toBeUndefined();
    // token should NOT leak into the body either.
    expect(body.token).toBeUndefined();
  });

  it('uses BYO token when provided (skips mint)', async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(
      jsonResponse(200, { id: 'c', choices: [{ message: { role: 'assistant', content: 'k' } }] })
    );
    const auth = new AuthModule({ ...cfg, fetch: fetchFn });
    const chat = new ChatModule({ ...cfg, fetch: fetchFn }, auth);
    await chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'q' }],
      token: 'byot',
    });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn.mock.calls[0][1].headers.Authorization).toBe('Bearer byot');
  });

  it('401 → BehestAuthError', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { jwt: 'tk', ttl: 60 }))
      .mockResolvedValueOnce(
        jsonResponse(401, { error: { code: 'invalid_token', message: 'bad' } })
      );
    const auth = new AuthModule({ ...cfg, fetch: fetchFn });
    const chat = new ChatModule({ ...cfg, fetch: fetchFn }, auth);
    await expect(
      chat.completions.create({
        model: 'm',
        messages: [{ role: 'user', content: 'x' }],
      })
    ).rejects.toBeInstanceOf(BehestAuthError);
  });
});

describe('ChatModule.completions.create (streaming)', () => {
  it('stream:true returns AsyncIterable of chunks', async () => {
    const chunks = [
      'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"!"}}]}\n\n',
      'data: [DONE]\n\n',
    ];
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { jwt: 'tk', ttl: 60 }))
      .mockResolvedValueOnce(sseResponse(chunks));
    const auth = new AuthModule({ ...cfg, fetch: fetchFn });
    const chat = new ChatModule({ ...cfg, fetch: fetchFn }, auth);
    const stream = await chat.completions.create({
      model: 'm',
      messages: [{ role: 'user', content: 'hi' }],
      stream: true,
    });
    const pieces: string[] = [];
    for await (const chunk of stream as AsyncIterable<any>) {
      const c = chunk?.choices?.[0]?.delta?.content;
      if (c) pieces.push(c);
    }
    expect(pieces.join('')).toBe('Hello!');
  });

  it('AbortSignal mid-stream aborts underlying fetch', async () => {
    // fetch receives the signal; we assert by checking signal.aborted after abort.
    const controller = new AbortController();
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { jwt: 'tk', ttl: 60 }))
      .mockImplementation(async (_url: string, init: RequestInit) => {
        // Start a stream that would yield forever unless aborted.
        const body = new ReadableStream({
          start(ctrl) {
            const encoder = new TextEncoder();
            ctrl.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"a"}}]}\n\n'));
            // Schedule abort to close the stream.
            setTimeout(() => {
              try {
                ctrl.error(new DOMException('aborted', 'AbortError'));
              } catch {
                // ignore
              }
            }, 5);
          },
        });
        // Forward the signal for realism.
        if (init?.signal) {
          (init.signal as AbortSignal).addEventListener('abort', () => {});
        }
        return new Response(body, {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        });
      });
    const auth = new AuthModule({ ...cfg, fetch: fetchFn });
    const chat = new ChatModule({ ...cfg, fetch: fetchFn }, auth);
    const stream = await chat.completions.create({
      model: 'm',
      messages: [{ role: 'user', content: 'hi' }],
      stream: true,
      signal: controller.signal,
    });
    const iter = (stream as AsyncIterable<any>)[Symbol.asyncIterator]();
    const first = await iter.next();
    expect(first.value.choices[0].delta.content).toBe('a');
    controller.abort();
    // Next call may either throw or complete with done:true — both acceptable.
    await iter.next().catch(() => undefined);
    expect(controller.signal.aborted).toBe(true);
    // Assert the underlying fetch was invoked with the signal.
    expect(fetchFn.mock.calls[1][1].signal).toBe(controller.signal);
  });

  it('streaming 401 response surfaces as BehestAuthError before iteration starts', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { jwt: 'tk', ttl: 60 }))
      .mockResolvedValueOnce(jsonResponse(401, { error: { code: 'invalid_token' } }));
    const auth = new AuthModule({ ...cfg, fetch: fetchFn });
    const chat = new ChatModule({ ...cfg, fetch: fetchFn }, auth);
    await expect(
      chat.completions.create({
        model: 'm',
        messages: [{ role: 'user', content: 'x' }],
        stream: true,
      })
    ).rejects.toBeInstanceOf(BehestAuthError);
  });

  it('handles multi-event SSE frames split across chunks', async () => {
    // Split one SSE event across two chunks.
    const stream = [
      'data: {"choices":[{"delta":{"cont',
      'ent":"hi"}}]}\n\n',
      'data: [DONE]\n\n',
    ];
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { jwt: 'tk', ttl: 60 }))
      .mockResolvedValueOnce(sseResponse(stream));
    const auth = new AuthModule({ ...cfg, fetch: fetchFn });
    const chat = new ChatModule({ ...cfg, fetch: fetchFn }, auth);
    const it = (await chat.completions.create({
      model: 'm',
      messages: [{ role: 'user', content: 'q' }],
      stream: true,
    })) as AsyncIterable<any>;
    const pieces: string[] = [];
    for await (const chunk of it) {
      const c = chunk?.choices?.[0]?.delta?.content;
      if (c) pieces.push(c);
    }
    expect(pieces.join('')).toBe('hi');
  });
});
