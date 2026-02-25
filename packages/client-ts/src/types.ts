import type { ClientOptions } from 'openai';

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
   */
  endUserId?: string;
  /**
   * Optional API Key for authentication.
   * Defaults to process.env.BEHEST_API_KEY.
   */
  apiKey?: string;
}
