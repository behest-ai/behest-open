/**
 * Behest Local JWT Signing
 *
 * Signs JWTs locally using a tenant's RSA private key via the `jose` library.
 * Eliminates the 50-200ms round-trip to the /mint endpoint.
 *
 * Produces tokens with the exact header and claims structure that
 * Kong expects for sk_* tokens (see AUTH_LIFECYCLE.md Section 3).
 */

import { SignJWT, importPKCS8 } from 'jose';

/**
 * Configuration for local JWT signing with a tenant signing key.
 */
export interface SigningKeyConfig {
  /** RSA private key in PEM format (PKCS#8 or PKCS#1) */
  privateKeyPem: string;
  /** Key ID assigned by Behest (must start with sk_ prefix) */
  keyId: string;
  /** Tenant UUID that owns this signing key */
  tenantId: string;
  /** Default project UUID for tokens signed with this key */
  projectId: string;
}

/**
 * Options for signing a single JWT.
 */
export interface SignTokenOptions {
  /** End-user identifier (required, non-empty) */
  userId: string;
  /** Token lifetime in seconds. Must be 60-86400. Default: 3600 */
  expiresIn?: number;
  /** Override the default projectId from SigningKeyConfig */
  projectId?: string;
}

/**
 * Result from signing a JWT locally.
 */
export interface SignTokenResult {
  /** The signed JWT string */
  accessToken: string;
  /** Expiration timestamp (Unix seconds) */
  expiresAt: number;
  /** Remaining lifetime in seconds */
  expiresIn: number;
}

/**
 * Maximum number of cached signing keys.
 * When exceeded, the oldest entries are evicted.
 */
const KEY_CACHE_MAX_SIZE = 16;

/**
 * Module-level cache for parsed CryptoKey objects.
 * Avoids re-parsing the PEM on every sign call (~2-5ms savings).
 * Keyed by the PEM string itself (reference equality won't work across calls).
 * Bounded to KEY_CACHE_MAX_SIZE entries; oldest entries are evicted when full.
 */
const keyCache = new Map<string, CryptoKey>();

/**
 * Clear the signing key cache.
 *
 * Useful for testing or when rotating keys. After calling this,
 * the next signBehestJWT call will re-import the PEM.
 */
export function clearSigningKeyCache(): void {
  keyCache.clear();
}

/**
 * Import and cache a PEM private key for repeated signing.
 *
 * @internal
 * @throws If the PEM is invalid or not an RSA key
 */
export async function importSigningKey(pem: string): Promise<CryptoKey> {
  const cached = keyCache.get(pem);
  if (cached) {
    return cached;
  }

  try {
    const key = await importPKCS8(pem, 'RS256');

    // Evict oldest entries if cache is at capacity.
    // Map iteration order is insertion order, so the first key is the oldest.
    if (keyCache.size >= KEY_CACHE_MAX_SIZE) {
      const oldestKey = keyCache.keys().next().value as string;
      keyCache.delete(oldestKey);
    }

    keyCache.set(pem, key as CryptoKey);
    return key as CryptoKey;
  } catch (err) {
    throw new Error(
      'Invalid signing key PEM. Expected an RSA private key in PEM format ' +
      '(-----BEGIN PRIVATE KEY----- or -----BEGIN RSA PRIVATE KEY-----). ' +
      `Original error: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

/**
 * Sign a Behest JWT locally using a tenant signing key.
 *
 * Produces a JWT with the exact header and claims structure that
 * Kong expects for sk_* tokens:
 *
 *   header: { alg: "RS256", kid: "sk_...", typ: "JWT" }
 *   payload: { tid, pid, uid, iss: "behest", aud: "behest", iat, nbf, exp }
 *
 * @param config - Signing key configuration (private key, kid, tenant/project IDs)
 * @param options - Per-token options (userId, TTL, optional project override)
 * @returns Signed JWT with expiration metadata
 *
 * @throws {Error} If config or options are invalid
 * @throws {Error} If the private key PEM is invalid or not RSA
 *
 * @example
 * ```typescript
 * const result = await signBehestJWT(
 *   {
 *     privateKeyPem: process.env.BEHEST_SIGNING_KEY_PEM!,
 *     keyId: 'sk_a1b2c3d4...',
 *     tenantId: 'tenant-uuid',
 *     projectId: 'project-uuid',
 *   },
 *   { userId: 'alice', expiresIn: 300 }
 * );
 * // result.accessToken is a signed JWT string
 * ```
 */
export async function signBehestJWT(
  config: SigningKeyConfig,
  options: SignTokenOptions,
): Promise<SignTokenResult> {
  // Validate config
  if (!config.keyId || !config.keyId.startsWith('sk_')) {
    throw new Error(
      'Invalid signingKeyId: must start with sk_ prefix. ' +
      `Received: "${config.keyId}"`
    );
  }

  if (!config.tenantId) {
    throw new Error('tenantId is required and must be non-empty');
  }

  const projectId = options.projectId ?? config.projectId;
  if (!projectId) {
    throw new Error('projectId is required and must be non-empty');
  }

  // Validate options
  if (!options.userId) {
    throw new Error('userId is required and must be non-empty');
  }

  const expiresIn = options.expiresIn ?? 3600;
  if (expiresIn < 60 || expiresIn > 86400) {
    throw new Error(
      `expiresIn must be between 60 and 86400 seconds. Received: ${expiresIn}`
    );
  }

  // Import the private key (cached after first call)
  const key = await importSigningKey(config.privateKeyPem);

  // Build and sign the JWT
  const now = Math.floor(Date.now() / 1000);
  const exp = now + expiresIn;

  const jwt = await new SignJWT({
    tid: config.tenantId,
    pid: projectId,
    uid: options.userId,
  })
    .setProtectedHeader({ alg: 'RS256', kid: config.keyId, typ: 'JWT' })
    .setIssuer('behest')
    .setAudience('behest')
    .setIssuedAt(now)
    .setNotBefore(now)
    .setExpirationTime(exp)
    .sign(key);

  return {
    accessToken: jwt,
    expiresAt: exp,
    expiresIn,
  };
}
