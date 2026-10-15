# Gateway

Code: `web/src/server/gateway/`, `web/src/app/api/gateway/`, `web/src/app/(protected)/app/usage/`, `web/src/lib/usage.ts` · Verified: 2026-10-14 @ c9135de

## Purpose
An OpenAI-compatible proxy so a paired device can use the owner's model keys without holding them.
The device's `jvd_` token is the API key; the server picks an upstream, swaps in the owner's key,
streams the answer back and writes one `gateway_usage` row per request (the bill and the rate-limit
counter). Also proxies speech-to-text and text-to-speech for TUI voice. Off unless `GATEWAY_ENABLED`.
The `/app/usage` page in this module shows spend from synced sessions, not from the gateway.

## How it works

**Chat** (`web/src/app/api/gateway/v1/chat/completions/route.ts` → `POST`), in order:
1. `keys.ts` → `gatewayEnabled()` false → 503 `gateway_disabled`.
2. `authenticateDevice` (device token) → 401 as every device route does.
3. Body cap 2 MiB (`content-length`, then the read text) → 413. Parse with a deliberately loose
   schema (unknown OpenAI params pass through); only cost/safety fields are constrained, and `n` must be 1.
4. `meter.ts` → `checkLimits(userId, deviceId)`: one query over this month's `gateway_usage` rows
   for the user gives both the per-device requests in the last minute (`LIMITS.rpmPerDevice`, 60) and
   the month's spend (`LIMITS.monthlyCostMicrosPerUser`, $20) → 429 `rate_limited` / `quota_exceeded`.
5. `resolve.ts` → `resolveChain(model)`: follow `ALIASES` (max 4 hops, cycle → no match), keep
   enabled upstreams whose `models` contain the id (exact) or whose `prefixes` match, sort exact
   first, then `priority`, then name. Empty → 404 `model_not_found`.
6. `meter.ts` → `reserveUsage` inserts a `pending` row **before** the call, so every request is
   counted for the rate limit even if it never settles.
7. Try up to `LIMITS.maxAttempts` (3) targets within `LIMITS.totalDeadlineMs` (240 s). An upstream
   with no key (`keyFor` → undefined) is skipped, not fatal. `proxy.ts` → `callUpstream` clamps
   `max_tokens` to `LIMITS.maxOutputTokens` (8192), forces `stream_options.include_usage` on streams,
   builds headers from scratch (`headers.ts` → `upstreamHeaders`), forwards the client's abort signal,
   and applies the upstream's `timeoutMs`. Failures go through `errors.ts` → `classifyUpstream`;
   only `isRetryable` ones (timeout, rate limit, upstream error) move to the next target.
8. Success, non-streaming: read the JSON, `usageFromJson`, `settleUsage`, return the body with
   `clientHeaders`. Streaming (`streamBack`): pass bytes through one `TransformStream` whose
   `makeUsageSniffer` reads a copy (client first, metering never in the token path) and settles
   `ok` in `flush`. The client stream is pull-based (`pull` reads one chunk per client read), so the
   upstream is read only as fast as the client takes it. A mid-stream error is delivered in-band as
   `sseErrorFrames` (error + `[DONE]`) and is never retried, since partial content is already on the
   wire. If the client disconnects, `cancel()` cancels the upstream reader and settles the row
   `cancelled` with the sniffed usage, or an estimate (`promptChars / 4` input, `sentBytes / 4`
   output tokens) priced with `costMicros`, so the row is `estimated` and still counts against the
   monthly budget.
9. All attempts failed: `settleUsage` with `upstream_timeout` / `upstream_error` / `rejected`, and
   answer the last failure OpenAI-shaped (`openAiErrorBody`) with `x-gateway-error` and `retry-after`.

**Audio** (`audio.ts` → `audioGateway`, shared by both audio routes): enabled → device auth → 10 MiB
cap (`AUDIO.maxAudioBytes`) → the route's own parse → key present (else 503 `gateway_misconfigured`)
→ `checkLimits` → `reserveUsage` → one upstream call (no fallback chain; `AUDIO.timeoutMs` 60 s) →
`settleUsage` with the cost the route computed up front → the upstream body streamed back untouched.
- Transcriptions: multipart `file` + `model` (one of `AUDIO.transcribe.models`); cost from
  `transcribeCostMicros(bytes)` assuming 16 kHz mono 16-bit wav.
- Speech: JSON `{ model, input (≤4096), voice?, instructions?, speed? }`; a voice not in
  `AUDIO.speech.voices` becomes `defaultVoice`, `response_format` is forced to `wav`; cost from
  `speechCostMicros(chars)`.

**Models** (`web/src/app/api/gateway/v1/models/route.ts` → `GET`): `catalog()` over upstreams that are enabled *and* have
a key set; aliases appear as ids when they resolve to a listed model. `owned_by` is the upstream
slug, never its URL or key name. `created` is a fixed constant so the response is stable.

**Usage page** (`web/src/app/(protected)/app/usage/page.tsx`): one query for the user's
`agent_session` rows started in the last 30 days, folded by `web/src/lib/usage.ts` → `foldUsage`
into totals, one bucket per day (empty days included, `dayKey` = `YYYY-MM-DD`), per-workstation
spend, and the 10 costliest sessions.

**TUI side.** `tui/src/agent/hosted.ts` → `withHostedFallback` adds a `jarvis` provider
(`jarvis-default`, `jarvis-max`) at `<cloud>/api/gateway/v1` with the device token as the API key
when no chat model is configured, plus `jarvis-voice` / `jarvis-speech` for audio. See
[tui/agent](../../tui/agent/README.md).

## Files
| File | Responsibility |
|---|---|
| `web/src/server/gateway/upstreams.ts` | The routing table: `UPSTREAMS`, `ALIASES`, `LIMITS`, `AUDIO`, types `Upstream`, `GatewayKeyName` |
| `web/src/server/gateway/resolve.ts` | `resolveAlias`, `resolveChain`, `catalog` (pure, defaults injectable for tests) |
| `web/src/server/gateway/keys.ts` | `keyFor` (explicit switch over `env`), `gatewayEnabled`; the only gateway file importing `~/env` |
| `web/src/server/gateway/proxy.ts` | `callUpstream`: one chat call, clamp, timeout, classify |
| `web/src/server/gateway/headers.ts` | `upstreamHeaders`, `clientHeaders` (allowlists both ways) |
| `web/src/server/gateway/errors.ts` | `GatewayCode`, `GatewayFailure`, `classifyUpstream`, `isRetryable`, `redactSecrets`, `openAiErrorBody`, `sseErrorFrames`, `failureHeaders` |
| `web/src/server/gateway/meter.ts` | `checkLimits`, `reserveUsage`, `settleUsage` |
| `web/src/server/gateway/usage.ts` | `usageFromJson`, `usageFromSseEvent`, `costMicros`, `makeUsageSniffer`, `transcribeCostMicros`, `speechCostMicros` |
| `web/src/server/gateway/audio.ts` | `audioGateway`, `audioFail`, `AudioCall` |
| `web/src/app/api/gateway/v1/chat/completions/route.ts` | Chat proxy with fallback chain and stream metering (`streamBack`, `jsonBack`) |
| `web/src/app/api/gateway/v1/models/route.ts` | Model catalog |
| `web/src/app/api/gateway/v1/audio/transcriptions/route.ts` | Speech-to-text via `audioGateway` |
| `web/src/app/api/gateway/v1/audio/speech/route.ts` | Text-to-speech via `audioGateway` |
| `web/src/app/(protected)/app/usage/page.tsx` | Usage page from synced sessions |
| `web/src/lib/usage.ts` | `foldUsage`, `dayKey`, types `UsageRow`, `Usage` |

## Interfaces

| Method · path | Auth | Body | Response | Handler |
|---|---|---|---|---|
| `POST /api/gateway/v1/chat/completions` | device token | OpenAI chat body: `model`, `messages` (1–2000), `stream?`, `max_tokens?`/`max_completion_tokens?` (≤200k, clamped to 8192), `temperature?`, `top_p?`, `n?: 1`, `tools?` (≤256), others pass through | upstream body (JSON or SSE), header `x-gateway-upstream`; errors OpenAI-shaped with `x-gateway-error` | `web/src/app/api/gateway/v1/chat/completions/route.ts` → `POST` |
| `GET /api/gateway/v1/models` | device token | — | `{ object: "list", data: [{ id, object: "model", created, owned_by }] }` | `web/src/app/api/gateway/v1/models/route.ts` → `GET` |
| `POST /api/gateway/v1/audio/transcriptions` | device token | multipart `file`, `model`, other fields forwarded | upstream body | `web/src/app/api/gateway/v1/audio/transcriptions/route.ts` → `POST` |
| `POST /api/gateway/v1/audio/speech` | device token | `{ model, input, voice?, instructions?, speed? }` | wav stream | `web/src/app/api/gateway/v1/audio/speech/route.ts` → `POST` |

Status codes the gateway emits: 401 (device auth, repo-shaped `{ error: "Unauthorized" }`), 400
`invalid_request`, 404 `model_not_found`, 413, 429 `rate_limited`/`quota_exceeded`, 499 (client
closed, internal), 502 `upstream_error`/`gateway_misconfigured`, 503 `gateway_disabled`/`gateway_misconfigured`,
504 `upstream_timeout`. Route config: `runtime = "nodejs"`, `dynamic = "force-dynamic"`, `maxDuration`
300 (chat) / 120 (audio).

Page: `/app/usage`.

## Data and state
| Table | Use |
|---|---|
| `gateway_usage` (`web/src/server/db/schemas/gateway_usage.ts`) | One row per request: `user_id`, `device_id`, `workstation_id`, `requested_model`, `upstream_name`, `upstream_model`, `status` (`pending`/`ok`/`cancelled`/`upstream_error`/`upstream_timeout`/`rejected`), `streamed`, `estimated`, tokens, `cost_micros`, `upstream_status`, `latency_ms`, `attempts`. Indexed on `(device_id, created_at)` and `(user_id, created_at)`. Never stores prompts or completions |
| `agent_session` | Read by the usage page |
| `device` | Via `authenticateDevice` |

Env vars (`web/src/env.js`): `GATEWAY_ENABLED` (`"true"`/`"false"`, default off; parsed as an enum
because `z.coerce.boolean("false")` is true), `GATEWAY_KEY_A`, `GATEWAY_KEY_B`, `GATEWAY_KEY_C`,
`GATEWAY_KEY_D` (all optional). Which upstream uses which key is set in `upstreams.ts`:
openai → A, anthropic → B, openrouter → C, audio (Groq) → D.

Config lives in code (`upstreams.ts`), not env or DB: type-checked, reviewable, no round trip on the
hot path. All three chat upstreams ship `enabled: false`. The `anthropic` upstream lists
`claude-opus-5-5`, `claude-sonnet-5-5`, `claude-haiku-5-5` and the alias `jarvis-max` →
`claude-opus-5-5`.

## Depends on / used by
- Depends on: [devices-and-pairing](../devices-and-pairing/README.md) (`authenticateDevice`),
  [database](../database/README.md), `web/src/lib/session.ts` and `web/src/lib/format.ts` (usage page).
- Used by: the TUI through `tui/src/agent/hosted.ts` and its voice providers; any OpenAI client given
  a `jvd_` token.

## Gotchas
- **Upstream 401/403 becomes 502**, never 401, so clients do not tell the user their (device) key is
  bad and the TUI does not try to re-pair.
- **The client's `Authorization` header is never forwarded.** `upstreamHeaders` builds headers from
  nothing; `clientHeaders` passes back only `content-type` plus our own headers.
- **Error shape differs from the rest of the app.** Gateway routes answer `{ error: { message, type,
  code, param } }` (OpenAI), except the device-auth 401. `problem()` in `web/src/lib/api/error.ts`
  only unwraps a string `error`, so browser code must not use it on gateway responses.
- **Limits are read-then-write.** Concurrent requests can each pass `checkLimits` at the boundary;
  worst-case overshoot is about concurrency × max request cost. Accepted to avoid Redis.
- **Streaming metering needs the usage frame.** `stream_options.include_usage` is forced on; the
  sniffer buffers partial SSE events and the last usage frame wins. No usage, or an upstream with no
  `cost`, writes `estimated: true` and cost 0 (audio is always `estimated`).
- **A cancelled stream is billed on an estimate.** `ponytail:` in `streamBack` → `cancel`: ~4 chars
  per token, and SSE framing inflates the output side, so it overestimates. An exact count needs the
  usage frame a cancelled stream never sends. The schema comment lists `client_abort`, which nothing
  writes; the status written is `cancelled`.
- **One price per upstream.** `anthropic` is priced `{ input: 4, output: 20 }` (Opus 5.5's), so
  Sonnet and Haiku requests are metered high.
- `catalog()` hides upstreams with no key set, but `resolveChain` still routes to them and the chat
  route skips them, so a model whose only upstream lacks a key ends as 502 `gateway_misconfigured`.
- Each upstream's `timeoutMs` must stay below `LIMITS.totalDeadlineMs`; the deadline is checked
  between attempts, not during one.
- The usage page reads `agent_session` (TUI-reported cost), not `gateway_usage`. Nothing in the UI
  shows gateway rows today; the MCP `usage` area has no tools yet.
- Rate limiting in front of the app is nginx (`k8s/base/nginx.conf`, general `/api/` zone); the
  per-device and per-month limits here are separate.

## Tests
- `web/src/__tests__/gateway.test.ts`: `classifyUpstream`, `isRetryable`, `openAiErrorBody`,
  `redactSecrets`, `sseErrorFrames`, `upstreamHeaders`, `clientHeaders`, `resolveAlias`,
  `resolveChain`, `catalog`, `costMicros`, `makeUsageSniffer`, `usageFromSseEvent`,
  `transcribeCostMicros`, `speechCostMicros`.
- `web/src/__tests__/usage.test.ts`: `foldUsage`, `dayKey`.
- TUI side: `tui/test/provider-runtime.test.ts` imports `hosted.ts`.

Run: `pnpm --filter web test`. `meter.ts`, `proxy.ts`, `audio.ts` and the routes need a database or
network and are untested.
