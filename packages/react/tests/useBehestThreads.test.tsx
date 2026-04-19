import { describe, it, expect, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useBehestThreads } from '../src/useBehestThreads';

function mockJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('useBehestThreads', () => {
  it('auto-loads threads on mount from the default path', async () => {
    const threads = [{ id: 't1', title: 'Hello' }];
    const fetchFn = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>(
      async () => mockJson(threads)
    ) as unknown as typeof fetch;

    const { result } = renderHook(() => useBehestThreads({ fetchFn }));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.threads).toEqual(threads);
    expect((fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe(
      '/api/behest/threads'
    );
  });

  it('respects a custom threadsPath', async () => {
    const fetchFn = vi.fn(async () => mockJson([])) as unknown as typeof fetch;
    renderHook(() =>
      useBehestThreads({ fetchFn, threadsPath: '/api/my-threads' })
    );
    await waitFor(() => {
      expect((fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
    });
    expect((fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe(
      '/api/my-threads'
    );
  });

  it('skips auto-load when autoLoad is false', async () => {
    const fetchFn = vi.fn(async () => mockJson([])) as unknown as typeof fetch;
    renderHook(() => useBehestThreads({ fetchFn, autoLoad: false }));
    // Give React time; nothing should have fired.
    await new Promise((r) => setTimeout(r, 10));
    expect((fetchFn as unknown as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it('getMessages() hits the per-thread endpoint and URL-encodes the id', async () => {
    const fetchFn = vi
      .fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
      .mockResolvedValueOnce(mockJson([]))
      .mockResolvedValueOnce(
        mockJson([{ role: 'assistant', content: 'hi' }])
      ) as unknown as typeof fetch;

    const { result } = renderHook(() => useBehestThreads({ fetchFn }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const msgs = await result.current.getMessages('thread with spaces');
    expect(msgs).toEqual([{ role: 'assistant', content: 'hi' }]);
    const spyCalls = (fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls;
    expect(spyCalls[1][0]).toBe(
      '/api/behest/threads/thread%20with%20spaces/messages'
    );
  });

  it('remove() optimistically updates and restores on failure', async () => {
    const fetchFn = vi
      .fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
      .mockResolvedValueOnce(mockJson([{ id: 't1' }, { id: 't2' }]))
      .mockResolvedValueOnce(mockJson({ error: 'no' }, 500)) as unknown as typeof fetch;

    const { result } = renderHook(() => useBehestThreads({ fetchFn }));
    await waitFor(() => expect(result.current.threads.length).toBe(2));

    await expect(
      act(async () => {
        await result.current.remove('t1');
      })
    ).rejects.toThrow();

    expect(result.current.threads.map((t) => t.id)).toEqual(['t1', 't2']);
  });

  it('remove() keeps the optimistic update on success', async () => {
    const fetchFn = vi
      .fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
      .mockResolvedValueOnce(mockJson([{ id: 't1' }, { id: 't2' }]))
      .mockResolvedValueOnce(new Response(null, { status: 204 })) as unknown as typeof fetch;

    const { result } = renderHook(() => useBehestThreads({ fetchFn }));
    await waitFor(() => expect(result.current.threads.length).toBe(2));

    await act(async () => {
      await result.current.remove('t1');
    });
    expect(result.current.threads.map((t) => t.id)).toEqual(['t2']);
  });

  it('refresh() exposes errors on state', async () => {
    const fetchFn = vi.fn(async () => mockJson({}, 500)) as unknown as typeof fetch;
    const { result } = renderHook(() => useBehestThreads({ fetchFn }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeInstanceOf(Error);
  });
});
