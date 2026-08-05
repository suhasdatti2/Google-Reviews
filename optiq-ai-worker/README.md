# Optiq AI backend

The storefront widget (`snippets/optiq-ai.liquid` + `assets/optiq-ai.js`) talks
to this Worker. The Worker holds the Anthropic API key and calls the model.

**Why a Worker at all.** A Shopify theme is public. Anything put in theme assets
is readable by every visitor, so an API key placed there would be extracted and
spent by strangers within hours. This is the smallest piece of server that keeps
the key private.

## Deploy (about five minutes)

1. **Get an API key** at <https://console.anthropic.com> → API Keys.

2. **Install the CLI and log in** (needs a free Cloudflare account):

   ```bash
   npm install -g wrangler
   wrangler login
   ```

3. **From this folder, set the key as a secret and deploy:**

   ```bash
   cd optiq-ai-worker
   wrangler secret put ANTHROPIC_API_KEY     # paste the key when prompted
   wrangler deploy
   ```

   Wrangler prints a URL like `https://optiq-ai.<your-subdomain>.workers.dev`.

4. **Point the theme at it.** In Shopify admin → Online Store → Themes →
   Customize → Theme settings → **Optiq AI**, paste that URL into
   *AI endpoint URL* and save.

That's it. The widget switches to the model automatically once the field is
filled in, and falls back to the built-in local answers if the field is empty
or the endpoint is unreachable.

## Checking it works

```bash
curl -X POST https://optiq-ai.<your-subdomain>.workers.dev \
  -H 'Content-Type: application/json' \
  -H 'Origin: https://optiq.shop' \
  -d '{"messages":[{"role":"user","content":"what is an NFC tag made of?"}],"knowledge":"{}"}'
```

A JSON `{"reply":"..."}` means it's live. `{"error":"origin not allowed"}` means
`ALLOWED_ORIGINS` in `wrangler.toml` doesn't include the domain you sent.

## How grounding is preserved

Every request carries the live store knowledge payload — the same JSON the theme
regenerates on each page load — and the system prompt pins all Optiq-specific
claims to it. General questions are answered from the model's own knowledge;
prices, policies, specs and availability may only be quoted from the payload.
Because the payload is rebuilt per page load, it can never go stale.

## Cost control

- `ALLOWED_ORIGINS` refuses requests from any other site.
- `max_tokens` is capped at 700, and conversations at 20 turns.
- The store data is sent with `cache_control: ephemeral`, so those tokens are
  billed once per visit rather than on every message.
- Cloudflare's free tier covers 100,000 Worker requests per day; the model calls
  are billed by Anthropic per token.

To pause it entirely, clear the *AI endpoint URL* theme setting — the widget
reverts to local answers with no code change.
