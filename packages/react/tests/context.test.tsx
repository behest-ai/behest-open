import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import {
  BehestProvider,
  useBehestContext,
  type BehestProviderProps,
} from '../src/context';
import type { BehestTokenBundle } from '../src/types';

function bundle(): BehestTokenBundle {
  return {
    token: 'jwt_abc',
    sessionId: 'sess_1',
    ttl: 900,
    expiresAt: Math.floor(Date.now() / 1000) + 900,
  };
}

function wrap(props: Omit<BehestProviderProps, 'children'>) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <BehestProvider {...props}>{children}</BehestProvider>;
  };
}

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('<BehestProvider>', () => {
  it('throws when used without a baseUrl', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() =>
      render(
        <BehestProvider baseUrl="" fetchToken={async () => bundle()}>
          <span />
        </BehestProvider>
      )
    ).toThrow(/baseUrl/);
    spy.mockRestore();
  });

  it('throws when both tokenEndpoint and fetchToken are provided', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() =>
      render(
        <BehestProvider
          baseUrl="https://s.behest.app"
          tokenEndpoint="/api/behest/token"
          fetchToken={async () => bundle()}
        >
          <span />
        </BehestProvider>
      )
    ).toThrow(/exactly one/);
    spy.mockRestore();
  });

  it('throws when neither tokenEndpoint nor fetchToken is provided', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() =>
      render(
        <BehestProvider baseUrl="https://s.behest.app">
          <span />
        </BehestProvider>
      )
    ).toThrow(/exactly one/);
    spy.mockRestore();
  });

  it('exposes baseUrl and an OpenAI factory bound to the minted JWT', async () => {
    const fetchToken = vi.fn(async () => bundle());
    const { result } = renderHook(() => useBehestContext(), {
      wrapper: wrap({
        baseUrl: 'https://amber-fox-042.behest.app',
        fetchToken,
      }),
    });

    expect(result.current.baseUrl).toBe('https://amber-fox-042.behest.app');

    const { openai, bundle: b } = await result.current.getOpenAI();
    expect(b.token).toBe('jwt_abc');
    // OpenAI SDK stores baseURL on the instance.
    expect((openai as unknown as { baseURL: string }).baseURL).toBe(
      'https://amber-fox-042.behest.app/v1'
    );
  });

  it('tokenEndpoint shortcut POSTs with credentials and parses JSON', async () => {
    const fetchSpy = vi.fn(
      async () =>
        new Response(JSON.stringify(bundle()), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
    );
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const { result } = renderHook(() => useBehestContext(), {
      wrapper: wrap({
        baseUrl: 'https://s.behest.app',
        tokenEndpoint: '/api/behest/token',
      }),
    });

    await result.current.getOpenAI();
    expect(fetchSpy).toHaveBeenCalledWith('/api/behest/token', {
      method: 'POST',
      credentials: 'include',
    });
  });

  it('throws a clear message when a hook is used outside the provider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(() => useBehestContext())).toThrow(
      /outside of <BehestProvider>/
    );
    spy.mockRestore();
  });

  it('strips a trailing slash from baseUrl', async () => {
    const fetchToken = vi.fn(async () => bundle());
    const { result } = renderHook(() => useBehestContext(), {
      wrapper: wrap({
        baseUrl: 'https://amber-fox-042.behest.app/',
        fetchToken,
      }),
    });
    const { openai } = await result.current.getOpenAI();
    expect((openai as unknown as { baseURL: string }).baseURL).toBe(
      'https://amber-fox-042.behest.app/v1'
    );
  });
});
