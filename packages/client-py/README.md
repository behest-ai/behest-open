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

Sign JWTs locally with an RSA private key scoped to your tenant — **zero HTTP round-trips per mint**. Ideal for high-QPS backends, FastAPI services, and any "no outbound secrets traffic" policy.

### 1. Generate a signing key

Dashboard → **Settings → Signing Keys → Generate**. You receive (shown only once):

- A PKCS#8 PEM private key — keep server-side.
- A `kid` (key id) — short string like `kid_7h4m2p`. Public by design.

The public half is published at `https://<slug>.behest.app/.well-known/jwks.json`; Kong picks it up within minutes.

### 2. Encode + set env vars

```bash
PEM_B64=$(base64 < ./tenant-private-key.pem | tr -d '\n')

export BEHEST_KEY="behest_pk_${PEM_B64}"
export BEHEST_BASE_URL="https://amber-fox-042.behest.app"
export BEHEST_KID="kid_7h4m2p"
export BEHEST_TENANT_ID="tnt_..."
export BEHEST_PROJECT_ID="proj_..."
```

### 3. Use it — no code change

```python
from behest import Behest

behest = Behest()  # SDK sees behest_pk_ prefix → sign mode

# Identical API — no HTTP call; signs locally with PyJWT + cryptography.
result = await behest.auth.mint(user_id="u_42")

await behest.chat.completions.create(
    messages=[{"role": "user", "content": "Hi!"}],
    user_id="u_42",
)
```

### Advanced: pass the key programmatically

Fetch from a secrets manager at startup instead of env:

```python
import os
from behest import Behest

pem = fetch_from_vault("tenant-jwt-key")   # your secrets-manager call
behest = Behest(
    key=pem,                                # raw PEM; no prefix needed
    base_url="https://amber-fox-042.behest.app",
    kid="kid_7h4m2p",
    tenant_id="tnt_...",
    project_id="proj_...",
)
```

### Rotation

Deploy new `BEHEST_KID` + `BEHEST_KEY` → revoke the old `kid` in the dashboard. Kong drops the old key from its JWKS cache within ~5 min; all JWTs signed with the revoked `kid` stop working immediately. **Only local-signing mode gives you real revocation for already-issued JWTs.**

### Server-side only

Never put a private key in a browser, React Native app, or any untrusted client. The SDK doesn't enforce this in Python (unlike TypeScript, where `typeof window` is checkable) — it's your responsibility. Browsers must receive pre-minted JWTs from a backend instead.

## Full guides

- **Python FastAPI quickstart**: https://docs.behest.ai/developer/quickstarts/python-fastapi
- **Auth modes** (API-key vs local signing): https://docs.behest.ai/developer/guides/auth-modes
- **Multi-conversation chat**: https://docs.behest.ai/developer/guides/multi-conversation-chat
- **Error handling**: https://docs.behest.ai/developer/guides/error-handling

## Legacy classes

Pre-v1.5 `BehestClient` / `BehestSigningClient` (thin OpenAI wrappers, no mint) are still exported for backward compatibility. New code should use `Behest`.

## License

MIT
