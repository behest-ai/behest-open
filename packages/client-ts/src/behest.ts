/**
 * Top-level Behest class (v1.5). See SDK_SPEC.md §3.1.
 *
 * Unified env-driven entry point that exposes `auth`, `chat`, `threads`,
 * `usage`, and a few back-compat aliases (`mintToken`) for v1.x callers.
 */

import { AuthModule, type MintOptions, type MintResult } from './auth';
import { ChatModule } from './chat';
import { resolveConfig, type BehestInit, type ResolvedConfig, type Mode } from './config';
import { ThreadsModule } from './threads';
import { UsageModule } from './usage';

export interface LegacyMintOptions {
  userId?: string;
  tier?: number;
  ttl?: number;
  role?: 'user' | 'admin';
  sessionId?: string;
}

export type LegacyMintResult = MintResult & {
  /** @deprecated v1.x field — use `token`. */
  access_token: string;
  /** @deprecated v1.x field — use `ttl`. */
  expires_in: number;
};

const legacyWarnOnce = new Set<string>();
function warnLegacy(warn: (m: string) => void, tag: string, msg: string): void {
  if (legacyWarnOnce.has(tag)) return;
  legacyWarnOnce.add(tag);
  warn(msg);
}

/** @internal for tests */
export function __resetLegacyWarnings(): void {
  legacyWarnOnce.clear();
}

export class Behest {
  /** Resolved configuration (read-only after construction). */
  public readonly config: ResolvedConfig;
  public readonly mode: Mode;
  public readonly auth: AuthModule;
  public readonly chat: ChatModule;
  public readonly threads: ThreadsModule;
  public readonly usage: UsageModule;
  private readonly warn: (m: string) => void;

  constructor(init: BehestInit = {}) {
    const warn = init.warn ?? ((m: string) => {
      // eslint-disable-next-line no-console
      console.warn(`[behest] ${m}`);
    });
    this.warn = warn;
    this.config = resolveConfig({ ...init, warn });
    this.mode = this.config.mode;
    this.auth = new AuthModule(this.config);
    this.chat = new ChatModule(this.config, this.auth);
    this.threads = new ThreadsModule(this.config, this.auth);
    this.usage = new UsageModule(this.config, this.auth);
  }

  /**
   * @deprecated v1.x alias for `auth.mint({ user_id, session_id, ... })`.
   * Still functional in v1.5; will be removed in v2.0.
   */
  async mintToken(opts: LegacyMintOptions = {}): Promise<LegacyMintResult> {
    warnLegacy(
      this.warn,
      'method:mintToken',
      '`behest.mintToken()` is deprecated; use `behest.auth.mint()` instead.'
    );
    const newOpts: MintOptions = {
      user_id: opts.userId,
      session_id: opts.sessionId,
      tier: opts.tier,
      ttl: opts.ttl,
      role: opts.role,
    };
    const result = await this.auth.mint(newOpts);
    return {
      ...result,
      access_token: result.token,
      expires_in: result.ttl,
    };
  }
}
