/**
 * Threads module (v1.5). See SDK_SPEC.md §3.4.
 */

import type { AuthModule } from './auth';
import type { ResolvedConfig } from './config';
import { jsonRequest, type CallOptions } from './http';

export interface Thread {
  id: string;
  [k: string]: unknown;
}

export interface ThreadMessage {
  role: string;
  content: string;
  [k: string]: unknown;
}

export class ThreadsModule {
  constructor(private cfg: ResolvedConfig, private auth: AuthModule) {}

  list(opts: CallOptions = {}): Promise<Thread[]> {
    return jsonRequest<Thread[]>(this.cfg, this.auth, 'GET', '/v1/threads', opts);
  }

  get(id: string, opts: CallOptions = {}): Promise<Thread> {
    return jsonRequest<Thread>(
      this.cfg,
      this.auth,
      'GET',
      `/v1/threads/${encodeURIComponent(id)}`,
      opts
    );
  }

  async delete(id: string, opts: CallOptions = {}): Promise<void> {
    await jsonRequest<void>(
      this.cfg,
      this.auth,
      'DELETE',
      `/v1/threads/${encodeURIComponent(id)}`,
      opts
    );
  }

  messages(id: string, opts: CallOptions = {}): Promise<ThreadMessage[]> {
    return jsonRequest<ThreadMessage[]>(
      this.cfg,
      this.auth,
      'GET',
      `/v1/threads/${encodeURIComponent(id)}/messages`,
      opts
    );
  }
}
