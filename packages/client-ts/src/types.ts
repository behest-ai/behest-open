import type { ClientOptions } from 'openai';

/**
 * Supported Behest models
 * Extend this list as new models become available
 */
export type BehestModel =
  | 'gpt-4o'
  | 'gpt-4-turbo'
  | 'gpt-4'
  | 'gpt-3.5-turbo'
  | 'claude-opus-4.6'
  | 'claude-sonnet-4.6'
  | 'claude-haiku-4.5-20251001'
  | 'gemini-2.5-flash'
  | 'gemini-2.0-flash'
  | string; // Allow other model strings for forward compatibility

/**
 * Configuration options for BehestClient
 *
 * This is the base client options interface. For server-side usage with
 * JWT signing capabilities, use {@link BehestServerClientOptions} from ./server.
 */
export interface BehestClientOptions extends ClientOptions {
  /**
   * @deprecated No longer needed — Kong injects X-Tenant-Id from JWT claims.
   */
  tenantId?: string;

  /**
   * @deprecated No longer needed — Kong injects X-Project-Id from JWT claims.
   */
  projectId?: string;

  /**
   * Optional End User ID for tracking usage per user.
   * Sent as X-End-User-Id header.
   */
  endUserId?: string;

  /**
   * Optional API Key for authentication.
   * Defaults to process.env.BEHEST_API_KEY.
   *
   * Keep this server-side only in production.
   */
  apiKey?: string;
}
