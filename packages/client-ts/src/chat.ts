/**
 * Chat Completions module (v1.5). See SDK_SPEC.md §3.3 & §4.
 *
 * Streaming uses a line-buffered SSE parser that yields decoded JSON chunks.
 * AbortSignal is forwarded to fetch; errors before iteration starts surface
 * synchronously to the awaiter.
 */

import type { AuthModule } from './auth';
import type { ResolvedConfig } from './config';
import {
  BehestServerError,
  classifyHttpError,
  BehestError,
} from './errors';
import { buildUrl, resolveToken, sessionHeaderValue, safeJson, type CallOptions } from './http';

// Keep types loose — we're openai-compatible but don't want to bind to an
// exact ChatCompletion shape since upstream evolves.
export type ChatMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: unknown[];
};

export interface ChatCompletionCreateParams {
  model?: string;
  messages: ChatMessage[];
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  stream?: boolean;
  tools?: unknown[];
  tool_choice?: unknown;
  response_format?: unknown;
  [extra: string]: unknown;
}

export interface ChatCompletion {
  id: string;
  object?: string;
  created?: number;
  model?: string;
  choices: Array<{
    index?: number;
    message: ChatMessage;
    finish_reason?: string | null;
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  [k: string]: unknown;
}

export interface ChatCompletionChunk {
  id?: string;
  object?: string;
  created?: number;
  model?: string;
  choices: Array<{
    index?: number;
    delta: Partial<ChatMessage> & { content?: string };
    finish_reason?: string | null;
  }>;
  [k: string]: unknown;
}

export type ChatCreateExtraOptions = {
  session_id?: string;
  token?: string;
  signal?: AbortSignal;
  user_id?: string;
  tier?: number;
};

export type ChatCreateParams = ChatCompletionCreateParams & ChatCreateExtraOptions;

class CompletionsResource {
  constructor(private cfg: ResolvedConfig, private auth: AuthModule) {}

  async create(
    params: ChatCreateParams & { stream: true }
  ): Promise<AsyncIterable<ChatCompletionChunk>>;
  async create(params: ChatCreateParams): Promise<ChatCompletion>;
  async create(
    params: ChatCreateParams
  ): Promise<ChatCompletion | AsyncIterable<ChatCompletionChunk>> {
    const { session_id, token, signal, user_id, tier, ...rest } = params;
    const opts: CallOptions = { sessionId: session_id, token, signal, userId: user_id, tier };
    const bearer = await resolveToken(this.auth, opts);
    const url = buildUrl(this.cfg, '/v1/chat/completions');

    const headers: Record<string, string> = {
      Authorization: `Bearer ${bearer}`,
      'Content-Type': 'application/json',
      Accept: rest.stream ? 'text/event-stream' : 'application/json',
    };
    const sid = sessionHeaderValue(this.auth, opts);
    if (sid) headers['X-Session-Id'] = sid;

    const fetchFn = this.cfg.fetch ?? globalThis.fetch;
    let resp: Response;
    try {
      resp = await fetchFn(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(rest),
        signal,
      });
    } catch (err) {
      throw new BehestServerError(
        `Network error calling POST ${url}: ${err instanceof Error ? err.message : String(err)}`,
        { code: 'network_error', raw: err }
      );
    }

    if (!resp.ok) {
      const parsed = await safeJson(resp);
      throw classifyHttpError({ status: resp.status, headers: resp.headers, body: parsed });
    }

    if (rest.stream) {
      if (!resp.body) {
        throw new BehestServerError('Streaming response had no body', { code: 'server_error' });
      }
      return sseIterator(resp.body);
    }

    return (await safeJson(resp)) as ChatCompletion;
  }
}

export class ChatModule {
  public readonly completions: CompletionsResource;
  constructor(cfg: ResolvedConfig, auth: AuthModule) {
    this.completions = new CompletionsResource(cfg, auth);
  }
}

/**
 * Parse an SSE response body into an AsyncIterable of JSON chunks.
 *
 * Matches OpenAI SDK behavior: each `data: <json>` line is yielded as an
 * object; `data: [DONE]` terminates; non-data lines are ignored.
 */
async function* sseIterator(
  body: ReadableStream<Uint8Array>
): AsyncGenerator<ChatCompletionChunk, void, unknown> {
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE events are separated by \n\n.
      let sepIdx: number;
      while ((sepIdx = buffer.indexOf('\n\n')) !== -1) {
        const raw = buffer.slice(0, sepIdx);
        buffer = buffer.slice(sepIdx + 2);
        const chunk = parseSseEvent(raw);
        if (chunk === '__done__') return;
        if (chunk === undefined) continue;
        try {
          yield JSON.parse(chunk) as ChatCompletionChunk;
        } catch (err) {
          // Yield a terminal error sentinel, matching OpenAI SDK semantics.
          yield {
            choices: [],
            error: new BehestError(
              `Failed to parse streaming chunk: ${err instanceof Error ? err.message : String(err)}`,
              { code: 'stream_parse_error', raw: chunk }
            ),
          } as unknown as ChatCompletionChunk;
          return;
        }
      }
    }

    // Flush any trailing event without final \n\n.
    if (buffer.trim().length) {
      const chunk = parseSseEvent(buffer);
      if (chunk && chunk !== '__done__') {
        try {
          yield JSON.parse(chunk) as ChatCompletionChunk;
        } catch {
          // ignore malformed trailing
        }
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // ignore
    }
  }
}

function parseSseEvent(raw: string): string | '__done__' | undefined {
  const lines = raw.split('\n');
  const dataLines: string[] = [];
  for (const line of lines) {
    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trimStart());
    }
  }
  if (dataLines.length === 0) return undefined;
  const data = dataLines.join('\n');
  if (data === '[DONE]') return '__done__';
  return data;
}
