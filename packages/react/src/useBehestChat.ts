/**
 * useBehestChat — React hook that streams chat completions from Behest
 * directly from the browser, using a short-lived JWT fetched from the
 * app's backend.
 *
 * Shape intentionally mirrors Vercel AI SDK's `useChat` so existing
 * React devs can swap it in with no cognitive tax.
 */

import { useCallback, useRef, useState } from 'react';
import type { APIError } from 'openai';
import { useBehestContext } from './context';
import type { ChatMessage } from './types';

export interface UseBehestChatOptions {
  /** Initial messages to seed the conversation. Defaults to []. */
  initialMessages?: ChatMessage[];
  /** Thread id — set to persist the conversation (X-Thread-Id). */
  threadId?: string;
  /** Model override. Omit to use the project default. */
  model?: string;
  /** Extra completion params forwarded to OpenAI SDK (temperature, max_tokens, etc.). */
  body?: Record<string, unknown>;
  /** Called when a full assistant reply finishes streaming. */
  onFinish?: (message: ChatMessage) => void;
  /** Called on any non-abort error. */
  onError?: (err: unknown) => void;
}

export interface UseBehestChatReturn {
  messages: ChatMessage[];
  input: string;
  setInput: (v: string) => void;
  /** Send the current input (or an explicit override) and stream the response. */
  send: (override?: string) => Promise<void>;
  /** Abort the in-flight stream. No-op if idle. */
  stop: () => void;
  /** Replace the message list (e.g., when hydrating a thread). */
  setMessages: (m: ChatMessage[]) => void;
  isLoading: boolean;
  error: unknown | null;
}

export function useBehestChat(
  options: UseBehestChatOptions = {}
): UseBehestChatReturn {
  const {
    initialMessages = [],
    threadId,
    model,
    body,
    onFinish,
    onError,
  } = options;

  const ctx = useBehestContext();

  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [input, setInput] = useState('');
  const [isLoading, setLoading] = useState(false);
  const [error, setError] = useState<unknown | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  const send = useCallback(
    async (override?: string) => {
      const text = (override ?? input).trim();
      if (!text) return;

      const userMsg: ChatMessage = {
        id: generateId(),
        role: 'user',
        content: text,
        createdAt: Date.now(),
      };
      const assistantMsg: ChatMessage = {
        id: generateId(),
        role: 'assistant',
        content: '',
        createdAt: Date.now(),
      };

      // Snapshot the outgoing message history BEFORE we mutate state,
      // so the server call sees the same list React will render.
      const outgoing: ChatMessage[] = [...messages, userMsg];
      setMessages([...outgoing, assistantMsg]);
      setInput('');
      setLoading(true);
      setError(null);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        let openai: Awaited<ReturnType<typeof ctx.getOpenAI>>['openai'];
        try {
          ({ openai } = await ctx.getOpenAI());
        } catch (err) {
          throw err;
        }

        const doCall = async () => {
          return openai.chat.completions.create(
            {
              model: model ?? ('' as unknown as string), // openai typings require string; server will fill default
              messages: outgoing.map((m) => ({ role: m.role, content: m.content })),
              stream: true,
              ...(body ?? {}),
            },
            {
              signal: controller.signal,
              headers: threadId ? { 'X-Thread-Id': threadId } : undefined,
            }
          );
        };

        let stream: Awaited<ReturnType<typeof doCall>>;
        try {
          stream = await doCall();
        } catch (err) {
          if (isAuthError(err)) {
            // One retry: token may have been rotated or revoked.
            ctx.tokenCache.invalidate();
            ({ openai } = await ctx.getOpenAI());
            stream = await doCall();
          } else {
            throw err;
          }
        }

        let accumulated = '';
        for await (const chunk of stream) {
          const delta = chunk.choices?.[0]?.delta?.content ?? '';
          if (!delta) continue;
          accumulated += delta;
          setMessages((prev) => {
            if (prev.length === 0) return prev;
            const copy = [...prev];
            const last = copy[copy.length - 1];
            if (last.role !== 'assistant') return prev;
            copy[copy.length - 1] = { ...last, content: last.content + delta };
            return copy;
          });
        }

        onFinish?.({ ...assistantMsg, content: accumulated });
      } catch (err) {
        if (isAbort(err)) {
          // Silent — the caller invoked stop().
        } else {
          setError(err);
          onError?.(err);
        }
      } finally {
        setLoading(false);
        abortRef.current = null;
      }
    },
    [ctx, input, messages, threadId, model, body, onFinish, onError]
  );

  return {
    messages,
    input,
    setInput,
    send,
    stop,
    setMessages,
    isLoading,
    error,
  };
}

function isAbort(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const name = (err as { name?: string }).name;
  return name === 'AbortError';
}

function isAuthError(err: unknown): err is APIError {
  if (!err || typeof err !== 'object') return false;
  const status = (err as { status?: number }).status;
  return status === 401;
}

function generateId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return 'msg_' + Math.random().toString(36).slice(2, 10);
}
