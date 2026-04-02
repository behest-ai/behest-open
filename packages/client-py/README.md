# Behest Python SDK

The official Python SDK for [Behest AI](https://behest.ai) -- extends the OpenAI Python SDK with Behest authentication and local JWT signing.

## Installation

```bash
pip install behest
```

## Quick Start

### API Key Flow

```python
from behest import BehestClient

client = BehestClient(api_key="bh_live_YOUR_API_KEY")

response = client.chat.completions.create(
    model="gemini-2.5-flash",
    messages=[{"role": "user", "content": "Hello, Behest!"}],
)
print(response.choices[0].message.content)
```

### Local Signing Flow (Tenant Signing Keys)

For server-to-server use cases where you want to eliminate the mint round-trip (~1ms local signing vs 50-200ms mint):

```python
import os
from behest import BehestSigningClient

client = BehestSigningClient(
    signing_key_pem=os.environ["BEHEST_SIGNING_KEY_PEM"],
    key_id=os.environ["BEHEST_SIGNING_KEY_ID"],   # "sk_a1b2c3..."
    tenant_id=os.environ["BEHEST_TENANT_ID"],
    project_id=os.environ["BEHEST_PROJECT_ID"],
)

response = client.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": "Hello from Python!"}],
)
print(response.choices[0].message.content)
```

### Manual Token Signing

```python
from behest.signing import sign_behest_jwt

result = sign_behest_jwt(
    private_key_pem=os.environ["BEHEST_SIGNING_KEY_PEM"],
    key_id="sk_a1b2c3...",
    tenant_id="your-tenant-id",
    project_id="your-project-id",
    user_id="alice",
    expires_in=3600,
)
print(result["access_token"])
```

### Streaming

```python
stream = client.chat.completions.create(
    model="gemini-2.5-flash",
    messages=[{"role": "user", "content": "Write a poem about the sea."}],
    stream=True,
)
for chunk in stream:
    if chunk.choices[0].delta.content:
        print(chunk.choices[0].delta.content, end="", flush=True)
```

### Error Handling

```python
from behest import BehestClient
from behest.errors import (
    AuthenticationError,
    RateLimitError,
    BehestError,
)

client = BehestClient(api_key="bh_live_YOUR_API_KEY")

try:
    response = client.chat.completions.create(
        model="gemini-2.5-flash",
        messages=[{"role": "user", "content": "Hello"}],
    )
except AuthenticationError:
    print("Check your API key.")
except RateLimitError as e:
    print(f"Rate limited. Retry after {e.retry_after_ms}ms")
except BehestError as e:
    print(f"Behest error {e.status}: {e}")
```

## License

MIT
