/**
 * Server-Side Behest Client
 *
 * Enhanced client for backend usage with integrated JWT minting capabilities.
 * Currently supports local JWT signing (tenant signing key flow).
 *
 * TODO: Add HTTP-based minting via BehestAuthClient when the auth module
 * is implemented. This will enable the API key flow as a fallback path.
 */

import { BehestClient } from './client';
import { signBehestJWT, type SigningKeyConfig, type SignTokenResult } from './signing';
import type { BehestClientOptions } from './types';

/**
 * Response from minting a token.
 *
 * Matches the shape of SignTokenResult so local signing results
 * can be returned directly.
 */
export interface MintTokenResponse {
  /** The signed JWT string */
  accessToken: string;
  /** Expiration timestamp (Unix seconds) */
  expiresAt: number;
  /** Remaining lifetime in seconds */
  expiresIn: number;
}

/**
 * Extended options for server client with auth configuration
 */
export interface BehestServerClientOptions extends BehestClientOptions {
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
 * This client combines the standard Behest API client with local JWT signing,
 * making it easy to mint tokens for users and call the API without a round-trip.
 *
 * Currently supports:
 * - **Signing key flow**: Signs JWTs locally using a tenant RSA private key (~1ms, no network call)
 *
 * Future support (when auth module is added):
 * - **API key flow**: Calls the /mint endpoint to exchange an API key for a JWT
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
  private signingKeyConfig?: SigningKeyConfig;

  constructor(options: BehestServerClientOptions) {
    const { signingKey, ...rest } = options;

    super(rest);

    this.signingKeyConfig = signingKey;
  }

  /**
   * Mint a token for an end user.
   *
   * If `signingKey` was provided at construction, signs locally (~1ms).
   * Otherwise, throws an error (HTTP mint will be available when the
   * auth module is implemented).
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

    // TODO: Fall back to HTTP mint via BehestAuthClient when auth module is added.
    // For now, a signing key is required for server-side token minting.
    throw new Error(
      'No signingKey configured. BehestServerClient requires a signingKey for local JWT signing. ' +
      'HTTP-based minting via API key will be available when the auth module is implemented.'
    );
  }

  /**
   * Check if a token is expiring soon
   *
   * @param token The token to check
   * @param thresholdSeconds How many seconds before expiry to consider "expiring soon"
   * @returns True if the token expires within the threshold
   */
  isTokenExpiringSoon(token: MintTokenResponse, thresholdSeconds: number = 300): boolean {
    const now = Math.floor(Date.now() / 1000);
    return (token.expiresAt - now) < thresholdSeconds;
  }
}
