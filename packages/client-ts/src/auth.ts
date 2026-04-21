/**
 * Auth module (v1.5). See SDK_SPEC.md §3.2.
 *
 * Responsibilities:
 *  - apiKey mode: POST /v1/auth/mint
 *  - sign mode: local RS256 JWT signing via jose; claim order mirrors
 *    services/behest-auth/src/mint.ts:58-71 exactly.
 *  - Browser safety: refuse sign mode when `window` is defined.
 */

import { SignJWT, importPKCS8, type CryptoKey as JoseCryptoKey } from 'jose';
import { randomUUID } from 'node:crypto';
import type { ResolvedConfig } from './config';
import {
  BehestConfigError,
  BehestServerError,
  classifyHttpError,
} from './errors';
import { generateSessionId } from './helpers';

export interface MintOptions {
  user_id?: string;
  session_id?: string;
  tier?: number;
  ttl?: number;
  role?: 'user' | 'admin';
}

export interface MintResult {
  token: string;
  sessionId: string;
  ttl: number;
  expiresAt: number;
}

function isBrowser(): boolean {
  return typeof (globalThis as { window?: unknown }).window !== 'undefined';
}

export class AuthModule {
  private readonly cfg: ResolvedConfig;
  private readonly fetchFn: typeof fetch;
  /** Most recent session id used by mint(); consumed by chat/threads auto-header. */
  public lastSessionId?: string;
  private cachedKey?: Promise<JoseCryptoKey | Uint8Array>;

  constructor(cfg: ResolvedConfig) {
    if (cfg.mode === 'sign' && isBrowser()) {
      throw new BehestConfigError(
        'Local signing keys must never be used in the browser. ' +
          'Use the API-key mint flow from your backend, or use @behest/react.'
      );
    }
    this.cfg = cfg;
    this.fetchFn = cfg.fetch ?? globalThis.fetch;
  }

  async mint(opts: MintOptions = {}): Promise<MintResult> {
    const user_id = opts.user_id ?? this.cfg.defaultUserId;
    const role = opts.role ?? 'user';
    const ttl = opts.ttl ?? this.cfg.ttl;
    const tier = opts.tier ?? this.cfg.tier;
    const session_id = opts.session_id ?? generateSessionId();

    let result: MintResult;
    if (this.cfg.mode === 'apiKey') {
      result = await this.mintViaHttp({ user_id, role, ttl, tier, session_id });
    } else {
      result = await this.signLocally({ user_id, role, ttl, tier, session_id });
    }
    this.lastSessionId = result.sessionId;
    return result;
  }

  private async mintViaHttp(params: {
    user_id: string;
    role: string;
    ttl: number;
    tier?: number;
    session_id: string;
  }): Promise<MintResult> {
    const url = `${this.cfg.baseUrl.replace(/\/$/, '')}/v1/auth/mint`;
    const body: Record<string, unknown> = {
      user_id: params.user_id,
      role: params.role,
      ttl: params.ttl,
      session_id: params.session_id,
    };
    if (params.tier !== undefined) body.tier = params.tier;

    let resp: Response;
    try {
      resp = await this.fetchFn(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.cfg.key}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw new BehestServerError(
        `Network error while calling ${url}: ${err instanceof Error ? err.message : String(err)}`,
        { code: 'network_error', raw: err }
      );
    }

    if (!resp.ok) {
      const parsed = await safeJson(resp);
      throw classifyHttpError({ status: resp.status, headers: resp.headers, body: parsed });
    }

    const json = (await safeJson(resp)) as {
      jwt?: string;
      access_token?: string;
      ttl?: number;
      session_id?: string;
    };
    const token = json.jwt ?? json.access_token;
    if (!token) {
      throw new BehestServerError('Mint response missing jwt/access_token', {
        raw: json,
      });
    }
    const resolvedTtl = typeof json.ttl === 'number' ? json.ttl : params.ttl;
    const sessionId = json.session_id ?? params.session_id;
    return {
      token,
      sessionId,
      ttl: resolvedTtl,
      expiresAt: Math.floor(Date.now() / 1000) + resolvedTtl,
    };
  }

  private async signLocally(params: {
    user_id: string;
    role: string;
    ttl: number;
    tier?: number;
    session_id: string;
  }): Promise<MintResult> {
    if (!this.cfg.kid || !this.cfg.tenantId || !this.cfg.projectId) {
      throw new BehestConfigError(
        'Sign mode requires kid, tenantId, and projectId — internal config error'
      );
    }
    const key = await this.loadKey();
    const now = Math.floor(Date.now() / 1000);
    const exp = now + params.ttl;

    // Claim order MUST match services/behest-auth/src/mint.ts:58-71:
    // tid, pid, uid, role, scp, iss, aud, iat, nbf, exp, jti, (sid), (tier)
    // sid is additive (not present server-side today); tier is optional last.
    const payload: Record<string, unknown> = {
      tid: this.cfg.tenantId,
      pid: this.cfg.projectId,
      uid: params.user_id,
      role: params.role,
      scp: [] as string[],
      iss: this.cfg.issuer,
      aud: this.cfg.audience,
      iat: now,
      nbf: now,
      exp,
      jti: randomUUID(),
      sid: params.session_id,
    };
    if (params.tier !== undefined) payload.tier = params.tier;

    const token = await new SignJWT(payload)
      .setProtectedHeader({ alg: 'RS256', typ: 'JWT', kid: this.cfg.kid })
      .sign(key);

    return {
      token,
      sessionId: params.session_id,
      ttl: params.ttl,
      expiresAt: exp,
    };
  }

  private loadKey(): Promise<JoseCryptoKey | Uint8Array> {
    if (!this.cachedKey) {
      this.cachedKey = importPKCS8(this.cfg.key, 'RS256').catch((err) => {
        // Reset cache so subsequent calls don't return a rejected promise.
        this.cachedKey = undefined;
        throw new BehestConfigError(
          `Invalid RSA private key (expected PKCS#8 PEM). ${err instanceof Error ? err.message : String(err)}`
        );
      });
    }
    return this.cachedKey;
  }
}

async function safeJson(resp: Response): Promise<unknown> {
  try {
    const text = await resp.text();
    if (!text) return undefined;
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  } catch {
    return undefined;
  }
}
