/**
 * useBehestThreads — list/read/delete threads for the signed-in user.
 *
 * Thread operations require server-side privileges (to list another
 * user's thread would be an escalation), so this hook talks to routes
 * the app owns, not directly to Behest. The app's backend uses
 * @behest/client-ts to talk to Behest and returns plain JSON.
 *
 * Default routes (overridable):
 *   GET    `/api/behest/threads`                → Thread[]
 *   GET    `/api/behest/threads/:id/messages`   → ThreadMessage[]
 *   DELETE `/api/behest/threads/:id`            → 204
 */

import { useCallback, useEffect, useState } from 'react';

export interface ThreadSummary {
  id: string;
  title?: string;
  last_message_at?: string;
  [k: string]: unknown;
}

export interface ThreadMessage {
  role: string;
  content: string;
  [k: string]: unknown;
}

export interface UseBehestThreadsOptions {
  /** Base path for server routes. Defaults to `/api/behest/threads`. */
  threadsPath?: string;
  /** Auto-load on mount. Defaults to true. */
  autoLoad?: boolean;
  /** Override fetch (for testing). */
  fetchFn?: typeof fetch;
}

export interface UseBehestThreadsReturn {
  threads: ThreadSummary[];
  loading: boolean;
  error: unknown | null;
  refresh: () => Promise<void>;
  getMessages: (threadId: string) => Promise<ThreadMessage[]>;
  remove: (threadId: string) => Promise<void>;
}

export function useBehestThreads(
  options: UseBehestThreadsOptions = {}
): UseBehestThreadsReturn {
  const {
    threadsPath = '/api/behest/threads',
    autoLoad = true,
    fetchFn = globalThis.fetch,
  } = options;

  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [loading, setLoading] = useState(autoLoad);
  const [error, setError] = useState<unknown | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetchFn(threadsPath, { credentials: 'include' });
      if (!r.ok) throw new Error(`threads list failed: ${r.status}`);
      const data = (await r.json()) as ThreadSummary[];
      setThreads(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [threadsPath, fetchFn]);

  const getMessages = useCallback(
    async (threadId: string): Promise<ThreadMessage[]> => {
      const r = await fetchFn(
        `${threadsPath}/${encodeURIComponent(threadId)}/messages`,
        { credentials: 'include' }
      );
      if (!r.ok) throw new Error(`thread messages failed: ${r.status}`);
      const data = (await r.json()) as ThreadMessage[];
      return Array.isArray(data) ? data : [];
    },
    [threadsPath, fetchFn]
  );

  const remove = useCallback(
    async (threadId: string): Promise<void> => {
      // Optimistic update — restore on failure.
      const snapshot = threads;
      setThreads((t) => t.filter((x) => x.id !== threadId));
      try {
        const r = await fetchFn(
          `${threadsPath}/${encodeURIComponent(threadId)}`,
          { method: 'DELETE', credentials: 'include' }
        );
        if (!r.ok && r.status !== 204) {
          throw new Error(`thread delete failed: ${r.status}`);
        }
      } catch (err) {
        setThreads(snapshot);
        throw err;
      }
    },
    [threads, threadsPath, fetchFn]
  );

  useEffect(() => {
    if (autoLoad) void refresh();
  }, [autoLoad, refresh]);

  return { threads, loading, error, refresh, getMessages, remove };
}
