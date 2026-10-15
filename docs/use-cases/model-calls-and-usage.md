# Model calls and usage

Modules: [web/gateway](../modules/web/gateway/README.md), [tui/agent](../modules/tui/agent/README.md) · Verified: 2026-10-15 @ aff1145

## Who and why
A user pairs a device but has no model API key of their own. The TUI then talks to the owner's
JARVIS server, which acts as an OpenAI-compatible gateway: the device token is the API key, and
the server swaps in the owner's upstream key, streams the answer back and records what each
request cost. The owner gets one bill and one place to set limits. Devices never hold provider
keys.

## Flow
1. **The TUI picks the hosted provider** (`tui/src/agent/hosted.ts` → `withHostedFallback`, run
   once at startup and on config reload). If the device is paired and the config has no chat
   model, it adds a provider `jarvis` with models `jarvis-default` and `jarvis-max`. Its base URL
   is `<cloud>/api/gateway/v1` and its API key is the device token. The default model becomes
   `jarvis/jarvis-default` unless `model` is already set. It also adds `jarvis-voice` and
   `jarvis-speech` for voice. None of this is written to disk.
2. **A turn calls the model.** The AI SDK sends `POST /api/gateway/v1/chat/completions` with
   `Authorization: Bearer <device token>` and `stream: true`
   (`web/src/app/api/gateway/v1/chat/completions/route.ts` → `POST`).
3. **The gateway checks, in order:**
   - Is `GATEWAY_ENABLED` on? If not, 503 `gateway_disabled`.
   - Device token valid and active? If not, 401.
   - Body at most 2 MiB (413), and the body schema (400 `invalid_request`).
   - Limits (`web/src/server/gateway/meter.ts` → `checkLimits`): 60 requests a minute per device,
     and $20 a calendar month (UTC) per user. Over either one, 429.
4. **It picks upstreams** (`web/src/server/gateway/resolve.ts` → `resolveChain`). Aliases resolve
   first: `jarvis-default` → `gpt-4.1-mini`, `jarvis-max` → `claude-opus-5-5`. Then enabled
   upstreams that list the model exactly come first, then prefix matches, then lower `priority`,
   then name. No match gives 404 `model_not_found`.
5. **It reserves a usage row** (`reserveUsage`): a `pending` `gateway_usage` row is written
   before any upstream call, so every request counts toward the rate limit even if it never
   finishes.
6. **It calls the upstream** (`web/src/server/gateway/proxy.ts` → `callUpstream`). An upstream
   with no key set is skipped. `max_tokens` is clamped to 8192, and streams ask the upstream for
   a usage frame. Headers are built from scratch, so the device token never leaves the server.
   The client's abort signal is forwarded upstream.
7. **On a retryable failure it falls back.** A timeout, upstream rate limit or upstream error
   moves to the next upstream. At most 3 upstreams are tried, inside a 240 s shared deadline. Any
   other failure stops the chain.
8. **It streams the answer back.** The bytes pass through unchanged while a sniffer reads a copy
   to find the usage frame. When the stream ends, the row is settled `ok` with the real token
   counts and cost. A non-streaming request reads the JSON usage and settles it the same way.
9. **If the client hangs up mid-stream** (Esc in the TUI), the gateway cancels the upstream read
   and settles the row `cancelled`. It uses the usage frame if one arrived. Otherwise it
   estimates prompt characters ÷ 4 for input and bytes sent ÷ 4 for output, priced normally and
   marked `estimated`. The abandoned stream still counts toward the monthly budget.
10. **The TUI records the turn locally** (`tui/src/agent/metrics.ts`, `metrics.jsonl`) and, with
    `syncSessions` on, pushes the session totals to `agent_session`. The **usage page**
    (`/app/usage`) reads those synced sessions for the last 30 days: totals, spend per day, spend
    per workstation, and the 10 most expensive sessions.

Voice uses the same gateway (`/api/gateway/v1/audio/transcriptions` and `/audio/speech`): same
auth and limits, one upstream with no fallback, a 10 MiB audio cap, a 60 s timeout, and always
an estimated cost. See [voice.md](voice.md).

## Business rules
- **The gateway is off by default.** `GATEWAY_ENABLED` must be `"true"`. Upstream keys are
  `GATEWAY_KEY_A` (openai), `GATEWAY_KEY_B` (anthropic), `GATEWAY_KEY_C` (openrouter) and
  `GATEWAY_KEY_D` (Groq audio), in `web/src/env.js`. All three chat upstreams ship with
  `enabled: false` in `web/src/server/gateway/upstreams.ts`, so the owner edits code to route
  traffic.
- **Limits** (`LIMITS` in `web/src/server/gateway/upstreams.ts`): `rpmPerDevice` 60,
  `monthlyCostMicrosPerUser` 20,000,000 ($20), `maxOutputTokens` 8192, `maxAttempts` 3,
  `totalDeadlineMs` 240,000. Each upstream has a 120 s `timeoutMs`.
- **Request shape:** `messages` 1–2000, `tools` ≤ 256, `n` must be 1, `max_tokens` ≤ 200k before
  clamping. Unknown OpenAI parameters pass through.
- **Pricing:** cost = input tokens × input price + output tokens × output price, in micro-dollars,
  with one price per upstream (openai $1.25/$10, anthropic $4/$20 per million tokens). A request
  with no usage frame, or an upstream with no price (openrouter), is stored at cost 0 and marked
  `estimated`.
- **Limits are read, then written.** Requests running at the same time can each pass the check
  and overshoot the limit by a few requests. This was accepted to avoid needing Redis.
- **Row states:** `pending` → `ok`, `cancelled`, `upstream_error`, `upstream_timeout` or
  `rejected` (no upstream had a key). Prompts and completions are never stored.
- **The usage page does not read the gateway.** It sums the cost the TUI reports per session.
  Hosted model ids are not in the models.dev catalog, so the TUI prices hosted turns at $0, and
  gateway spend shows up only in `gateway_usage`, which no page displays yet.

## When it fails
Gateway errors are OpenAI-shaped (`{ error: { message, type, code } }`) plus an
`x-gateway-error` header and, where it applies, `retry-after`. The TUI shows the message as a
turn error.
- **503 `gateway_disabled`:** the owner has not turned the gateway on. Configure a provider with
  `/provider` instead.
- **401:** the device was revoked or unpaired. Pair again ([pair-a-device.md](pair-a-device.md)).
- **429 `rate_limited`:** over 60 requests a minute from this device, or the upstream is
  throttling (when no fallback upstream is left). Wait `retry-after` seconds.
- **429 `quota_exceeded`:** this month's $20 is spent. `retry-after` points to the start of next
  month.
- **404 `model_not_found`:** no enabled upstream serves the model or alias.
- **502 `gateway_misconfigured`:** an upstream matched, but none has its key set.
- **502 `upstream_error`:** the upstream failed, or rejected the owner's key (a 401/403 upstream
  becomes 502, so the TUI never thinks its own token is bad).
- **504 `upstream_timeout`:** no answer within the upstream's timeout.
- **Failure mid-stream:** the 200 has already been sent, so the error arrives as a final SSE
  frame followed by `[DONE]`. It is never retried against another upstream.
- **Hosted model stops working after the setup wizard:** saving the "JARVIS (hosted)" preset
  writes a `jarvis` provider with no URL or key. Because a chat model is now configured, the
  startup fallback no longer adds the real entry. Remove the saved `jarvis` provider to get the
  fallback back.

## Related
- [Agent turn and permissions](agent-turn-and-permissions.md): the turn that makes these calls.
- [Pair a device](pair-a-device.md): where the device token comes from.
- [Remote approval and steering](remote-approval-and-steering.md): session sync, which feeds the
  usage page.
- [Voice](voice.md): the audio half of the gateway.
- Module docs: [web/gateway](../modules/web/gateway/README.md), [tui/agent](../modules/tui/agent/README.md).
