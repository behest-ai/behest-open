/**
 * Server-Side Behest Client
 *
 * Enhanced client for backend usage with integrated JWT minting capabilities.
 * Supports both HTTP-based minting (API key flow) and local JWT signing
 * (tenant signing key flow).
 */

import { BehestClient } from './client';
import { BehestAuthClient, type MintTokenOptions, type MintTokenResponse } from './auth';
import { signBehestJWT, type SigningKeyConfig } from './signing';
import type { BehestClientOptions } from './types';
import type { RetryOptions } from './retry';

/**
 * Extended options for server client with auth configuration
 */
export interface BehestServerClientOptions extends BehestClientOptions {
  /**
   * Optional retry configuration for API calls
   */
  retry?: RetryOptions;

  /**
   * Tenant signing key for local JWT signing.
   * When provided, mintToken() signs locally (~1ms) instead of making
   * an HTTP call to /mint (50-200ms).
   *
   * The private key never leaves the process.
   *
   * @example
   * ```typescript
   * const client = new BehestServerClient({
   *   signingKey: {
   *     privateKeyPem: process.env.BEHEST_SIGNING_KEY_PEM!,
   *     keyId: 'sk_a1b2c3d4...',
   *     tenantId: 'tenant-uuid',
   *     projectId: 'project-uuid',
   *   },
   * });
   * ```
   */
  signingKey?: SigningKeyConfig;
}

/**
 * Server-side Behest client with integrated JWT minting
 *
 * This client combines the standard Behest API client with auth utilities
 * for minting JWTs, making it easy to mint tokens for users and call the API.
 *
 * Supports two authentication flows:
 * 1. **API key flow** (default): Calls the /mint endpoint to exchange an API key for a JWT
 * 2. **Signing key flow**: Signs JWTs locally using a tenant RSA private key (~1ms, no network call)
 *
 * @example
 * // API key flow (existing behavior)
 * const client = new BehestServerClient({
 *   apiKey: process.env.BEHEST_API_KEY,
 * });
 *
 * @example
 * // Signing key flow (local, no mint round-trip)
 * const client = new BehestServerClient({
 *   signingKey: {
 *     privateKeyPem: process.env.BEHEST_SIGNING_KEY_PEM!,
 *     keyId: 'sk_a1b2c3d4...',
 *     tenantId: 'tenant-uuid',
 *     projectId: 'project-uuid',
 *   },
 * });
 *
 * const token = await client.mintToken('user-123');
 */
export class BehestServerClient extends BehestClient {
  /**
   * Authentication utilities for minting tokens via HTTP
   */
  public auth: BehestAuthClient;

  private signingKeyConfig?: SigningKeyConfig;
  private retryOptions?: RetryOptions;

  constructor(options: BehestServerClientOptions) {
    const { retry, signingKey, ...rest } = options;

    super(rest);

    this.signingKeyConfig = signingKey;
    this.retryOptions = retry;

    // Initialize auth client with same API key and retry options
    // Still available even when signing key is configured, in case
    // the caller needs the HTTP mint flow for a specific use case
    this.auth = new BehestAuthClient({
      apiKey: rest.apiKey || process.env.BEHEST_API_KEY || '',
      baseUrl: rest.baseURL || undefined,
      retry,
    });
  }

  /**
   * Mint a token for an end user.
   *
   * If `signingKey` was provided at construction, signs locally (~1ms).
   * Otherwise, falls back to the HTTP mint endpoint (50-200ms).
   *
   * Note: When using signing keys, the `role` parameter is ignored.
   * Kong forces `role=user` for all `sk_*` tokens regardless of any
   * role claim in the JWT.
   *
   * @param userId - End-user identifier
   * @param role - User role (ignored when using signing keys)
   * @param expiresIn - Token lifetime in seconds (default: 3600)
   *
   * @example
   * const token = await client.mintToken('user-123', 'regular', 3600);
   */
  async mintToken(
    userId: string,
    role: 'regular' | 'admin' | 'service' = 'regular',
    expiresIn: number = 3600
  ): Promise<MintTokenResponse> {
    if (this.signingKeyConfig) {
      // Local signing path — role is intentionally ignored because
      // Kong forces role to "user" for all sk_* tokens.
      return signBehestJWT(this.signingKeyConfig, { userId, expiresIn });
    }
    return this.auth.mint(userId, role, expiresIn);
  }

  /**
   * Check if a token is expiring soon
   *
   * @param token The token to check
   * @param thresholdSeconds How many seconds before expiry to consider "expiring soon"
   * @returns True if the token expires within the threshold
   */
  isTokenExpiringSoon(token: MintTokenResponse, thresholdSeconds: number = 300): boolean {
    return this.auth.isExpiringSoon(token, thresholdSeconds);
  }
}
