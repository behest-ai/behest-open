# @behest/client-ts

TypeScript/Node.js client for the [Behest](https://behest.ai) inference platform. Extends the [OpenAI SDK](https://github.com/openai/openai-node) with Behest authentication — use any OpenAI-compatible method with your Behest project.

## Installation

```bash
npm install @behest/client-ts openai
```

## Quick Start

```typescript
import { BehestClient } from '@behest/client-ts';

const client = new BehestClient({
  apiKey: 'your-behest-api-key',
});

const completion = await client.chat.completions.create({
  model: 'gpt-4o',
  messages: [{ role: 'user', content: 'Hello!' }],
});

console.log(completion.choices[0].message.content);
```

## Configuration

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `apiKey` | `string` | `process.env.BEHEST_API_KEY` | Behest API key for authentication |
| `baseURL` | `string` | `process.env.BEHEST_BASE_URL` or `https://api.behest.ai/v1` | Behest API base URL |
| `endUserId` | `string` | — | End-user identifier for per-user usage tracking |

All other [OpenAI client options](https://github.com/openai/openai-node#usage) are supported and passed through.

## Environment Variables

Set these to avoid passing options explicitly:

```bash
export BEHEST_API_KEY=your-api-key
export BEHEST_BASE_URL=https://api.behest.ai/v1  # optional
```

```typescript
// apiKey and baseURL are read from env automatically
const client = new BehestClient({});
```

## End-User Tracking

Pass `endUserId` to track usage per end-user in your application:

```typescript
const client = new BehestClient({
  apiKey: 'your-behest-api-key',
  endUserId: 'user-123',
});
```

This injects an `X-End-User-Id` header on every request, enabling per-user analytics and rate limiting in the Behest platform.

## OpenAI Compatibility

`BehestClient` extends `OpenAI` — all OpenAI SDK methods work as expected:

```typescript
import { BehestClient, OpenAI } from '@behest/client-ts';

const client = new BehestClient({ apiKey: 'your-key' });

// Streaming
const stream = await client.chat.completions.create({
  model: 'gpt-4o',
  messages: [{ role: 'user', content: 'Hello!' }],
  stream: true,
});

for await (const chunk of stream) {
  process.stdout.write(chunk.choices[0]?.delta?.content || '');
}
```

## License

MIT
