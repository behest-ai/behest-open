# behest-ai

Python SDK for the [Behest](https://behest.ai) inference gateway — parallel surface to [`@behest/client-ts`](https://www.npmjs.com/package/@behest/client-ts).

**v1.5 (beta)** adds per-end-user JWT minting, persistent threads, session memory, usage reporting, and typed errors — alongside the OpenAI-compatible chat surface. Works with API-key mode (one HTTP round-trip per mint) or local RSA signing mode (zero outbound calls).

> **On the name.** The PyPI package is `behest-ai` because `behest` has been held since 2017 by an unrelated, abandoned project. The Python module inside stays `behest/` — so your imports are **`from behest import Behest`** exactly like you'd expect.

## Install

```bash
pip install "behest-ai>=1.5"
```

Requires Python 3.10+.

## Environment

The SDK reads these on `Behest()`:

| Var | Required | Notes |
|---|---|---|
| `BEHEST_KEY` | ✅ | `behest_sk_live_...` (apiKey mode) **or** `behest_pk_<base64-PEM>` (sign mode). Auto-detected by prefix. |
| `BEHEST_BASE_URL` | ✅ | Your project slug host — `https://<slug>.behest.app`. |
| `BEHEST_KID` | sign mode only | Key id from dashboard → Signing Keys. |
| `BEHEST_TENANT_ID` | sign mode only | |
| `BEHEST_PROJECT_ID` | sign mode only | |

## Quick start

```python
from behest import Behest

behest = Behest()  # reads env; also accepts explicit kwargs

# Mint a per-user JWT (apiKey mode: POST /v1/auth/mint; sign mode: local PyJWT/cryptography sign).
result = await behest.auth.mint(user_id="u_42")
# result.token, result.session_id, result.ttl, result.expires_at

# Chat completion — SDK auto-attaches the JWT + X-Session-Id.
resp = await behest.chat.completions.create(
    messages=[{"role": "user", "content": "Hi!"}],
)
print(resp.choices[0].message.content)
```

Or pass `user_id` per call and let the SDK auto-mint:

```python
await behest.chat.completions.create(
    messages=[{"role": "user", "content": "Hi!"}],
    user_id="u_42",
)
```

## Streaming

```python
stream = await behest.chat.completions.create(
    messages=[{"role": "user", "content": "Write a haiku"}],
    stream=True,
    user_id="u_42",
)
async for chunk in stream:
    print(chunk.choices[0].delta.content or "", end="", flush=True)
```

## Threads (persistent conversations)

```python
await behest.threads.list()            # list[Thread]
await behest.threads.get(thread_id)    # Thread
await behest.threads.messages(thread_id)  # list[ThreadMessage]
await behest.threads.delete(thread_id) # None (204)
```

Scope is automatic — the JWT's `uid` filters rows server-side.

## Usage

```python
from datetime import datetime, timedelta, timezone

report = await behest.usage.get(
    from_=datetime.now(timezone.utc) - timedelta(days=1),
    to=datetime.now(timezone.utc),
    granularity="hour",
)
# report.totals.tokens, report.breakdown[i].timestamp, ...
```

## Typed errors

```python
from behest import (
    BehestAuthError,       # 401 / 403
    BehestQuotaError,      # 402
    BehestRateLimitError,  # 429 (exposes .retry_after in seconds)
    BehestBadRequestError, # 400 / 422
    BehestServerError,     # 5xx
    BehestConfigError,     # local config problem
)

try:
    await behest.chat.completions.create(messages=msgs, user_id=uid)
except BehestRateLimitError as err:
    await asyncio.sleep(err.retry_after or 1)
except BehestQuotaError as err:
    show_upgrade(err)
```

Every error exposes `.status`, `.code`, `.trace_id` (matches `X-Trace-Id` response header — use in support tickets), and `.raw` (parsed body).

## Local-signing mode

Prefix `BEHEST_KEY` with `behest_pk_` (or set a base64-encoded PKCS#8 PEM) and add `BEHEST_KID` / `BEHEST_TENANT_ID` / `BEHEST_PROJECT_ID`. The SDK auto-detects the prefix; **no code change**. Zero HTTP round-trips for minting.

## Full guides

- **Python FastAPI quickstart**: https://docs.behest.ai/developer/quickstarts/python-fastapi
- **Auth modes** (API-key vs local signing): https://docs.behest.ai/developer/guides/auth-modes
- **Multi-conversation chat**: https://docs.behest.ai/developer/guides/multi-conversation-chat
- **Error handling**: https://docs.behest.ai/developer/guides/error-handling

## Legacy classes

Pre-v1.5 `BehestClient` / `BehestSigningClient` (thin OpenAI wrappers, no mint) are still exported for backward compatibility. New code should use `Behest`.

## License

MIT
