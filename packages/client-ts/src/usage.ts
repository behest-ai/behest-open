/**
 * Usage module (v1.5). See SDK_SPEC.md §3.5.
 *
 * Server endpoint is gated behind a capability probe (PLAN §9.2 — not yet
 * shipped). 404 responses are translated to `BehestError({ code: "not_supported" })`
 * so callers can detect and fall back gracefully.
 */

import type { AuthModule } from './auth';
import type { ResolvedConfig } from './config';
import { BehestError } from './errors';
import { jsonRequest, type CallOptions } from './http';

export interface UsageQuery {
  from?: Date | string;
  to?: Date | string;
  user_id?: string;
  granularity?: 'minute' | 'hour' | 'day';
}

export interface UsageBreakdownEntry {
  timestamp?: string;
  tokens?: number;
  cost_usd?: number;
  [k: string]: unknown;
}

export interface UsageReport {
  totals: { tokens?: number; cost_usd?: number; [k: string]: unknown };
  breakdown: UsageBreakdownEntry[];
}

function serialize(v: Date | string | undefined): string | undefined {
  if (v === undefined) return undefined;
  return v instanceof Date ? v.toISOString() : v;
}

export class UsageModule {
  constructor(private cfg: ResolvedConfig, private auth: AuthModule) {}

  async get(query: UsageQuery = {}, opts: CallOptions = {}): Promise<UsageReport> {
    try {
      return await jsonRequest<UsageReport>(
        this.cfg,
        this.auth,
        'GET',
        '/v1/usage',
        {
          ...opts,
          query: {
            from: serialize(query.from),
            to: serialize(query.to),
            user_id: query.user_id,
            granularity: query.granularity ?? 'day',
          },
        }
      );
    } catch (err) {
      if (err instanceof BehestError && err.status === 404) {
        throw new BehestError('Usage endpoint not available on this environment', {
          status: 404,
          code: 'not_supported',
          traceId: err.traceId,
          raw: err.raw,
        });
      }
      throw err;
    }
  }
}
