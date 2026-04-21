/**
 * Shared types for @behest/react.
 *
 * The browser never constructs a Behest instance — it only ever receives
 * a short-lived, per-user JWT from the app's own backend. These types
 * describe that handoff and the runtime state the hooks track.
 */

/** Shape of a mint response returned by the app's token endpoint. */
export interface BehestTokenBundle {
  /** JWT (RS256) scoped to one user, signed by Behest (apiKey mode) or the tenant (sign mode). */
  token: string;
  /** Session id that Kong will inject on requests with this token. */
  sessionId: string;
  /** Lifetime in seconds. */
  ttl: number;
  /** Epoch seconds when the token becomes invalid. */
  expiresAt: number;
}

/** Function that fetches a fresh token bundle from the app's backend. */
export type FetchBehestToken = () => Promise<BehestTokenBundle>;

export interface ChatMessage {
  id?: string;
  role: 'system' | 'user' | 'assistant';
  content: string;
  createdAt?: number;
}
