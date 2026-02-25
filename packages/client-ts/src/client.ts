import { OpenAI } from 'openai';
import { BehestClientOptions } from './types';

/**
 * BehestClient is a wrapper around the OpenAI client that automatically configures
 * the base URL and injects Behest-specific headers for authentication and tracking.
 */
export class BehestClient extends OpenAI {
  constructor(options: BehestClientOptions) {
    const { endUserId, apiKey, ...rest } = options;

    // Kong injects X-Tenant-Id and X-Project-Id from JWT claims — do not send from client.
    const defaultHeaders: Record<string, string> = {
      ...(endUserId ? { 'X-End-User-Id': endUserId } : {}),
      ...(rest.defaultHeaders && typeof rest.defaultHeaders === 'object'
        ? (rest.defaultHeaders as Record<string, string>)
        : {}),
    };

    super({
      ...rest,
      apiKey: apiKey || process.env['BEHEST_API_KEY'],
      baseURL: rest.baseURL || process.env['BEHEST_BASE_URL'] || 'https://api.behest.ai/v1',
      defaultHeaders,
    });
  }
}
