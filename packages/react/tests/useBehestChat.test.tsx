import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { BehestProvider } from '../src/context';
import { useBehestChat } from '../src/useBehestChat';
import type { BehestTokenBundle } from '../src/types';

// Mock the `openai` module to avoid real network calls.
const mockCreate = vi.fn();
vi.mock('openai', () => {
  const APIError = class extends Error {
    status: number;
    constructor(status: number, message = 'api error') {
      super(message);
      this.status = status;
    }
  };

  class OpenAI {
    baseURL: string;
    apiKey: string;
    defaultHeaders?: Record<string, string>;
    chat = {
      completions: {
        create: (...args: unknown[]) => mockCreate(...args),
      },
    };
    constructor(opts: {
      apiKey: string;
      baseURL: string;
      defaultHeaders?: Record<string, string>;
    }) {
      this.apiKey = opts.apiKey;
      this.baseURL = opts.baseURL;
      this.defaultHeaders = opts.defaultHeaders;
    }
  }

  return { default: OpenAI, OpenAI, APIError };
});

function bundle(overrides: Partial<BehestTokenBundle> = {}): BehestTokenBundle {
  return {
    token: 'jwt_1',
    sessionId: 'sess_1',
    ttl: 900,
    expiresAt: Math.floor(Date.now() / 1000) + 900,
    ...overrides,
  };
}

async function* streamOf(chunks: string[]) {
  for (const c of chunks) {
    yield { choices: [{ delta: { content: c } }] };
  }
}

function wrap(fetchToken: () => Promise<BehestTokenBundle>) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <BehestProvider baseUrl="https://s.behest.app" fetchToken={fetchToken}>
        {children}
      </BehestProvider>
    );
  };
}

beforeEach(() => {
  mockCreate.mockReset();
});

describe('useBehestChat', () => {
  it('streams deltas into the last assistant message', async () => {
    mockCreate.mockResolvedValueOnce(streamOf(['Hel', 'lo ', 'world']));
    const fetchToken = vi.fn(async () => bundle());

    const { result } = renderHook(() => useBehestChat(), {
      wrapper: wrap(fetchToken),
    });

    act(() => result.current.setInput('hi'));
    await act(async () => {
      await result.current.send();
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages[0].role).toBe('user');
    expect(result.current.messages[0].content).toBe('hi');
    expect(result.current.messages[1].role).toBe('assistant');
    expect(result.current.messages[1].content).toBe('Hello world');
    expect(result.current.input).toBe('');
  });

  it('send(override) uses the override text and leaves input untouched', async () => {
    mockCreate.mockResolvedValueOnce(streamOf(['ok']));
    const fetchToken = vi.fn(async () => bundle());

    const { result } = renderHook(() => useBehestChat(), {
      wrapper: wrap(fetchToken),
    });

    act(() => result.current.setInput('stale'));
    await act(async () => {
      await result.current.send('fresh');
    });

    expect(result.current.messages[0].content).toBe('fresh');
  });

  it('attaches X-Thread-Id header when threadId is configured', async () => {
    mockCreate.mockResolvedValueOnce(streamOf(['hi']));
    const fetchToken = vi.fn(async () => bundle());

    const { result } = renderHook(
      () => useBehestChat({ threadId: 'th_abc' }),
      { wrapper: wrap(fetchToken) }
    );

    await act(async () => {
      await result.current.send('go');
    });

    const [, opts] = mockCreate.mock.calls[0];
    expect(opts.headers).toEqual({ 'X-Thread-Id': 'th_abc' });
  });

  it('retries once after a 401 with a fresh token', async () => {
    const { APIError } = await import('openai');
    mockCreate
      .mockRejectedValueOnce(new (APIError as unknown as new (s: number) => Error)(401))
      .mockResolvedValueOnce(streamOf(['ok']));
    const fetchToken = vi
      .fn<[], Promise<BehestTokenBundle>>()
      .mockResolvedValueOnce(bundle({ token: 'stale' }))
      .mockResolvedValueOnce(bundle({ token: 'fresh' }));

    const { result } = renderHook(() => useBehestChat(), {
      wrapper: wrap(fetchToken),
    });

    await act(async () => {
      await result.current.send('hi');
    });

    expect(fetchToken).toHaveBeenCalledTimes(2);
    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(result.current.error).toBeNull();
    expect(result.current.messages[1].content).toBe('ok');
  });

  it('stop() aborts the stream silently (no error set)', async () => {
    // Simulate a stream that throws an AbortError when the signal fires.
    mockCreate.mockImplementation(async (_params: unknown, opts: { signal: AbortSignal }) => {
      return {
        [Symbol.asyncIterator]() {
          return {
            async next(): Promise<IteratorResult<unknown>> {
              await new Promise<void>((resolve, reject) => {
                opts.signal.addEventListener('abort', () => {
                  const err = new Error('aborted');
                  (err as Error).name = 'AbortError';
                  reject(err);
                });
              });
              return { value: undefined, done: true };
            },
          };
        },
      };
    });

    const fetchToken = vi.fn(async () => bundle());
    const { result } = renderHook(() => useBehestChat(), {
      wrapper: wrap(fetchToken),
    });

    const sendPromise = act(async () => {
      await result.current.send('hi');
    });
    // Let send() register its AbortController.
    await new Promise((r) => setTimeout(r, 0));
    act(() => result.current.stop());
    await sendPromise;

    expect(result.current.error).toBeNull();
    expect(result.current.isLoading).toBe(false);
  });

  it('surfaces non-abort errors on state + onError callback', async () => {
    mockCreate.mockRejectedValueOnce(new Error('boom'));
    const onError = vi.fn();
    const fetchToken = vi.fn(async () => bundle());

    const { result } = renderHook(() => useBehestChat({ onError }), {
      wrapper: wrap(fetchToken),
    });

    await act(async () => {
      await result.current.send('hi');
    });

    expect(result.current.error).toBeInstanceOf(Error);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(result.current.isLoading).toBe(false);
  });

  it('does nothing when called with empty input', async () => {
    const fetchToken = vi.fn(async () => bundle());
    const { result } = renderHook(() => useBehestChat(), {
      wrapper: wrap(fetchToken),
    });

    await act(async () => {
      await result.current.send('   ');
    });

    expect(mockCreate).not.toHaveBeenCalled();
    expect(result.current.messages).toEqual([]);
  });
});
