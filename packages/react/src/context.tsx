/**
 * <BehestProvider> — holds baseUrl + token-fetch strategy in context so
 * every hook under the tree shares one token cache and one OpenAI client
 * factory.
 *
 * The provider never sees a BEHEST_KEY. It only knows how to fetch a
 * minted JWT from the app's own backend (either via a URL shortcut or a
 * caller-supplied async function).
 */

import {
  createContext,
  useContext,
  useMemo,
  type PropsWithChildren,
} from 'react';
import OpenAI from 'openai';
import { createTokenCache, type TokenCache } from './token-cache';
import type { BehestTokenBundle, FetchBehestToken } from './types';

export interface BehestProviderProps {
  /** Base URL of your Behest project, e.g. `https://amber-fox-042.behest.app`. The `/v1` suffix is added automatically. */
  baseUrl: string;

  /**
   * Either a URL string (POSTed with credentials to fetch a token) or a
   * callback that returns a fresh token bundle. Exactly one is required.
   */
  tokenEndpoint?: string;
  fetchToken?: FetchBehestToken;

  /** Seconds before expiry at which the cache proactively refetches. Default 60. */
  refetchSkewSeconds?: number;
}

export interface BehestContextValue {
  baseUrl: string;
  tokenCache: TokenCache;
  /** Returns an OpenAI instance bound to the current (fresh) JWT. Caller must not cache across awaits. */
  getOpenAI: () => Promise<{ openai: OpenAI; bundle: BehestTokenBundle }>;
}

const BehestContext = createContext<BehestContextValue | null>(null);

export function BehestProvider(
  props: PropsWithChildren<BehestProviderProps>
): JSX.Element {
  const { baseUrl, tokenEndpoint, fetchToken, refetchSkewSeconds, children } =
    props;

  const value = useMemo<BehestContextValue>(() => {
    if (!baseUrl) {
      throw new Error(
        '[behest/react] <BehestProvider> requires a `baseUrl` prop (e.g. https://amber-fox-042.behest.app)'
      );
    }
    if (!!tokenEndpoint === !!fetchToken) {
      throw new Error(
        '[behest/react] <BehestProvider> requires exactly one of `tokenEndpoint` or `fetchToken`'
      );
    }

    const effectiveFetchToken: FetchBehestToken =
      fetchToken ?? (() => defaultFetch(tokenEndpoint as string));

    const tokenCache = createTokenCache({
      fetchToken: effectiveFetchToken,
      refetchSkewSeconds,
    });

    const apiBase = baseUrl.replace(/\/+$/, '') + '/v1';

    async function getOpenAI(): Promise<{
      openai: OpenAI;
      bundle: BehestTokenBundle;
    }> {
      const bundle = await tokenCache.get();
      const openai = new OpenAI({
        apiKey: bundle.token,
        baseURL: apiBase,
        dangerouslyAllowBrowser: true,
        defaultHeaders: { 'X-Session-Id': bundle.sessionId },
      });
      return { openai, bundle };
    }

    return { baseUrl, tokenCache, getOpenAI };
  }, [baseUrl, tokenEndpoint, fetchToken, refetchSkewSeconds]);

  return (
    <BehestContext.Provider value={value}>{children}</BehestContext.Provider>
  );
}

export function useBehestContext(): BehestContextValue {
  const ctx = useContext(BehestContext);
  if (!ctx) {
    throw new Error(
      '[behest/react] hook used outside of <BehestProvider>. Wrap your app in <BehestProvider baseUrl=... tokenEndpoint=.../>'
    );
  }
  return ctx;
}

async function defaultFetch(url: string): Promise<BehestTokenBundle> {
  const r = await fetch(url, { method: 'POST', credentials: 'include' });
  if (!r.ok) {
    throw new Error(
      `[behest/react] token fetch failed: ${r.status} ${r.statusText}`
    );
  }
  return (await r.json()) as BehestTokenBundle;
}
