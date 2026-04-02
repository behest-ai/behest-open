import type { ClientOptions } from 'openai';
import type { RetryOptions } from './retry';
import type { SigningKeyConfig } from './signing';

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

  /**
   * Tenant signing key for local JWT signing.
   * When provided, mintToken() signs JWTs locally (~1ms) instead of making
   * an HTTP call to /mint (50-200ms).
   *
   * Mutually exclusive with apiKey for auth purposes, but apiKey may still
   * be set for backward compatibility with OpenAI SDK internals.
   *
   * The private key never leaves the process.
   */
  signingKey?: SigningKeyConfig;
}

/**
 * Configuration options for retry behavior
 * Exported from retry module but included here for convenience
 */
export type { RetryOptions } from './retry';
