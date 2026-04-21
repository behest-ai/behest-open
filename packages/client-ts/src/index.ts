// v1.x (backward-compatible exports)
export * from './client';
export * from './types';
export * from './signing';
export * from './server';

// v1.5 surface (dual-mode SDK per SDK_SPEC.md)
export { Behest } from './behest';
export type {
  LegacyMintOptions,
  LegacyMintResult,
} from './behest';
export { AuthModule } from './auth';
export type { MintOptions, MintResult } from './auth';
export { ChatModule } from './chat';
export type {
  ChatCompletionCreateParams,
  ChatCompletion,
  ChatCompletionChunk,
  ChatMessage,
  ChatCreateParams,
} from './chat';
export { ThreadsModule } from './threads';
export type { Thread, ThreadMessage } from './threads';
export { UsageModule } from './usage';
export type { UsageQuery, UsageReport, UsageBreakdownEntry } from './usage';
export { generateSessionId, decodeToken } from './helpers';
export type { BehestClaims } from './helpers';
export {
  BehestError,
  BehestAuthError,
  BehestQuotaError,
  BehestRateLimitError,
  BehestServerError,
  BehestBadRequestError,
  BehestConfigError,
  classifyHttpError,
} from './errors';
export type { BehestErrorInit, HttpErrorInput } from './errors';
export { resolveConfig, detectMode } from './config';
export type { BehestInit, ResolvedConfig, Mode } from './config';

// Re-export OpenAI for convenience
export { OpenAI } from 'openai';
