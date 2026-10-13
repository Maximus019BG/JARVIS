# Agent

Code: `tui/src/agent/` · Verified: 2026-10-13 @ c292f2f

## Purpose
The agent loop and everything around a turn: resolving agents and models, building the system
prompt, streaming one turn through the AI SDK with retries, persisting sessions as JSONL,
compaction, per-turn metrics, and the paired-cloud side channels (hosted model fallback, remote
approval, remote prompts, session sync). Used by the TUI, `jarvis run` and `jarvis work`.
Usage of agents, providers and sessions is in [tui/README.md](../../../../tui/README.md#agents).

## How it works

**One turn** (`agent.ts` → `run`):
1. `agent-def.ts` → `loadAgents` merges three sources, later wins: built-ins (`build`, `plan`),
   markdown agents found by `resourceFiles(cwd, "agents", ".md")` (frontmatter is config, body is
   prompt), then `config.agent`. Each is parsed by `AgentConfigSchema`; `enabled: false` drops it.
2. Model is `options.model ?? agent.model ?? defaultModelID(config)`, resolved by
   `provider.ts` → `resolveModel`.
3. The gate is narrowed with `gate.withRules(agent.permission)` and a plugin override that fires
   the `permission.ask` hook.
4. Tools: `builtinTools` + `skill` (if any skills) + custom tools + `extraTools` (MCP). Then
   `filterTools` (agent policy) → `gateTools` (generic gate for anything not self-gated) →
   `portableSchemas` → plugin `wrapTools`.
5. If `config.lazyTools`, a `createLoadout` decides which schemas go on the wire each step, and
   `tool_search` is added when anything is deferred (see [tools](../tools/README.md)).
6. `streamText` runs with `stopWhen: stepCountIs(config.maxSteps)`, `prepareStep` returning the
   loadout's active set, and `repairToolCall: toolCallRepair(...)` (`repair.ts`).
7. The `fullStream` is mapped to `AgentEvent`s (`text`, `reasoning`, `tool-start`, `tool-end`,
   `usage`, `error`, and `sub` for subagent events). Errors go through `explainAuth` first.
8. Retry (max 2) when the attempt produced no tool call and either: finish reason was
   `failed_generation`, the text starts with Groq's "Failed to call a function", or the provider
   rejected an unknown tool name (`UNKNOWN_TOOL` regex). A user-role hint is appended and the
   failed output is discarded. On the last unknown-tool retry the loadout calls `loadAll()`.
9. Returns `RunResult`: new messages, text, summed `usage`, `contextTokens` (last step's prompt
   tokens, i.e. window occupancy), `contextLimit`, model id, and `error` if already reported.

**Subagents**: `spawn` exists only when `depth < MAX_DEPTH` (1). It reruns `run` with the target
agent, fresh messages, the shared `read` map, and no continuity; it writes its own metric record
because the parent's usage never sees the child's tokens.

**System prompt** (`prompt.ts` → `systemPrompt`), in order: `BASE_PROMPT`, persona
(`resolvePersona`: `jarvis`, `plain`, or a file path), the agent prompt, `<operator>`,
`<continuity>` (previous session title), `<environment>`, `<tools>` (closed list of tool names,
sorted so it is cache-stable), then `<instructions>` from `~/.config/jarvis/JARVIS.md`, every
`JARVIS.md`/`AGENTS.md` from project root down to cwd, and `config.instructions` globs.

**Providers** (`provider.ts`): a provider entry names an npm package. `importPackage` uses the
`BUNDLED` static imports (`@ai-sdk/openai-compatible`, `anthropic`, `openai`, `google`), else
imports it, else `bun add <pkg> zod` into `<dataDir>/packages`. `pickFactory` takes
`provider.export` or the first `create*` export. Factories are cached per provider id;
`forgetProvider` drops them. `@ai-sdk/openai-compatible` models are wrapped to strip reasoning
parts from outgoing assistant messages (Groq rejects them). Missing `contextLimit`/`cost` are
filled from models.dev via `catalog.ts` → `modelInfo`.

**Hosted fallback** (`hosted.ts` → `withHostedFallback`), applied once at the CLI boundary: when
paired, adds `jarvis-voice`/`jarvis-speech` audio providers, and if no chat model is configured,
adds provider `jarvis` (`jarvis-default`, `jarvis-max`) pointing at `<cloud>/api/gateway/v1`
with the device token as the API key. Never persisted.

**Sessions** (`session.ts`): one JSONL file per session: a `header` line, `message` lines, and
`compact` lines. `loadSession` folds compact lines in order so each replaces everything before it
with a summary user/assistant pair plus the kept turn. `compact.ts` → `compactSession` summarises
everything before `lastTurnStart` with `smallModel` and appends a compact line; the full history
stays on disk for `exportMarkdown`. The UI compacts automatically at 85% of `contextLimit`, and
`jarvis run` compacts once and retries on `isOverflow`.

**Remote side channels** (all no-ops unless paired):
- `remote-approval.ts` → `remoteAnswer`: posts the permission request, polls until answered,
  deadline or abort, then always deletes it. Returns only `once`/`reject`, never decides itself.
- `remote-prompt.ts` → `claimPrompt`: claims one queued web prompt for the session.
- `session-sync.ts` → `pushSession`/`pushSessions`: upserts transcripts plus metric totals.

## Files
| File | Responsibility |
|---|---|
| `tui/src/agent/agent.ts` | `run` (the turn loop, retries, subagent spawn), `AgentEvent`, `errorMessage`, `effectiveModel` |
| `tui/src/agent/agent-def.ts` | Built-in agents, markdown/config agent loading: `loadAgents`, `resolveAgent`, `spawnableAgents`, `agentPrompt`, `DEFAULT_AGENT` |
| `tui/src/agent/attach.ts` | `attach`: turns `@image.png` mentions into base64 file parts (5 MB cap, workspace only) |
| `tui/src/agent/catalog.ts` | models.dev cache: `modelInfo`, `catalogModels`, `catalogKey` |
| `tui/src/agent/compact.ts` | `compactSession`, `generateTitle`, `isOverflow`, `render`, `NothingToCompact` |
| `tui/src/agent/hosted.ts` | Hosted gateway as a provider: `withHostedFallback`, `hostedEntry`, `hostedVoiceEntry`, `hostedBaseURL`, `hostedToken`, `hostedGuidance` |
| `tui/src/agent/metrics.ts` | Per-turn `metrics.jsonl`: `record`, `readRecords`, `rollup`, `groupBy`, `bar`, `providerOf` |
| `tui/src/agent/model-discovery.ts` | Model lists for setup: `discoverModels`, `parseOpenAIModels`, `parseAnthropicModels`, `mergeDiscovered`, `discoveryArgs`, `impliedBaseURL` |
| `tui/src/agent/prompt.ts` | `systemPrompt`, `BASE_PROMPT`, `PERSONAS`, `resolvePersona`, `instructionFiles`, `operatorBlock`, `continuityBlock`, `toolsBlock` |
| `tui/src/agent/provider-test.ts` | One-token round trip for a draft provider: `testProvider`, `classifyFailure`, `scrub`, `probeEntry`, `testWillInstall` |
| `tui/src/agent/provider.ts` | Provider loading/caching: `resolveModel`, `listModels`, `defaultModelID`, `parseModelID`, `resolveTranscription`, `resolveSpeech`, `needsInstall`, `forgetProvider`, `ProviderError` |
| `tui/src/agent/remote-approval.ts` | `remoteAnswer`: mirror a permission prompt to the cloud and poll |
| `tui/src/agent/remote-prompt.ts` | `claimPrompt`: take one web-queued prompt for a session |
| `tui/src/agent/repair.ts` | Hallucinated tool-name repair: `toolCallRepair`, `resolveToolName`, `normalize` |
| `tui/src/agent/session-sync.ts` | `pushSession`, `pushSessions`, `metricsFor`, `lineCount` |
| `tui/src/agent/session.ts` | JSONL sessions: `createSession`, `appendMessages`, `appendCompact`, `loadSession`, `openSession`, `listSessions`, `latestSession`, `deleteSession`, `exportMarkdown`, `setTitle`, `deriveTitle`, `textOf`, `lastTurnStart` |

## Interfaces

**Agent definition keys** (`AgentConfigSchema`, in `config.agent.<name>` or `.jarvis/agents/<name>.md`
frontmatter): `description`, `model`, `prompt`, `promptFile`, `temperature`, `tools`,
`defaultTools`, `permission`, `spawnable`, `enabled`. Built-ins: `build` (default), `plan`
(`write`/`edit`/`bash` off).

**Config keys read here**: `model`, `smallModel`, `provider`, `agent`, `persona`, `operator`,
`instructions`, `maxSteps`, `lazyTools`, `syncSessions`, `voice.model`/`voice.speakModel`
(hosted defaults), `check` and `vision` (passed into the tool context).

**Web API endpoints called** (all `Authorization: Bearer <device token>`):

| Method · path | Caller | Body / result |
|---|---|---|
| `POST /api/approval` | `remoteAnswer` | `{tool, title, detail (≤4000 chars), detailKind, subject}` → `{id, interval?, expiresIn?}` |
| `GET /api/approval/<id>` | `remoteAnswer` | → `{answer?, expired?}` |
| `DELETE /api/approval/<id>` | `remoteAnswer` (finally) | — |
| `POST /api/device/prompt/claim` | `claimPrompt` | `{sessionId}` → `{prompt: {prompt}}` or `{prompt: null}` |
| `GET /api/session/list` | `pushSessions` | → `{sessions: [{id, lines}]}` |
| `POST /api/session/push` | `pushSession` | `{id, title, cwd, startedAt, lines, transcript, turns, inputTokens, outputTokens, costMicros}` |
| `* /api/gateway/v1/...` | AI SDK via `hostedEntry` | OpenAI-compatible chat/audio |

External: `GET https://models.dev/api.json` (`catalog.ts`), `GET <baseURL>/models` (`model-discovery.ts`).

## Data and state
| What | Where |
|---|---|
| Sessions | `~/.local/share/jarvis/sessions/<ses_…>.jsonl` (`sessionDir`) |
| Turn metrics | `~/.local/share/jarvis/metrics.jsonl`, append-only, one `MetricRecord` per turn and per subagent run |
| models.dev cache | `~/.local/share/jarvis/models.dev.json`, 7-day TTL, stale copy used offline |
| On-demand provider packages | `~/.local/share/jarvis/packages/` |
| Device credentials (read only) | `~/.local/share/jarvis/credentials.json`, via `blueprint/credentials.ts` |
| Global instructions | `~/.config/jarvis/JARVIS.md` |
| In memory | provider factory cache (`loaded` in `provider.ts`), catalog promise, the per-session `read` map passed in by the caller |

Env vars: `JARVIS_NO_CATALOG` (skip models.dev), `NODE_ENV=test` (skips catalog and metric
writes), `XDG_CONFIG_HOME`/`XDG_DATA_HOME` (via `config/paths.ts`).

## Depends on / used by
- Depends on: [config](../config/README.md) (schema, paths, `discover`, `provider-status`),
  [tools](../tools/README.md) (built-ins, loadout, gate), [extensions](../extensions/README.md)
  (plugins, custom tools, skills, `MCP_PREFIX`), `blueprint/credentials.ts`, `blueprint/store.ts`,
  `ui/provider-presets.ts`.
- Used by: [cli](../cli/README.md) (`headless.ts`, `index.tsx`), the [UI](../ui/README.md)
  (`use-turn.ts`, `app.tsx`, `start.tsx`, stats/provider commands), [voice](../voice/README.md)
  (`resolveTranscription`, `resolveSpeech`), `tools/loadout.ts` (uses `repair.ts`).

## Gotchas
- Tool-name defence is three layers: the `<tools>` block in the prompt, `repair.ts` (aliases like
  `browse` → `webfetch`, `blueprint_place` → `blueprint_symbol` + `action: "place"`, plus
  case/separator drift; no fuzzy matching on purpose), then the retry loop for gateways that
  reject server-side. A repair to a known-but-unloaded tool becomes a `tool_search` call.
- Retries are only safe when nothing ran: all three retry triggers require `!sawToolCall`.
- `usage.input` sums every step (right for cost); `contextTokens` is the last step only (right
  for compaction). Do not swap them.
- `plan` only disables `write`, `edit` and `bash`. Other mutating tools (`code_project`,
  `blueprint_edit`, MCP) still follow `defaultTools: true` and their own permission rules.
- The compiled binary cannot load packages installed at runtime; only `BUNDLED` providers work
  there (`ProviderError` says so).
- `resolvePersona` throws on an unknown persona file, unlike missing instruction files.
- Compaction cuts at the last user message so tool calls keep their results; an orphaned call is
  a hard provider error.
- `provider-test.ts` must run `probeEntry` on a draft, because only `readConfigFile` expands
  `{env:…}`/`{secret:…}`; it also calls `forgetProvider` before and after.
- `ponytail:` `metrics.jsonl` has no rotation (`metrics.ts`).
- `syncSessions` is off by default: transcripts contain file contents and command output.
- The hosted token lives only in memory; `withHostedFallback` is not in `loadConfig` so tests and
  persisted config stay device-agnostic.

## Tests
Run from `tui/`: `bun test` (preload `tui/test/setup.ts` sandboxes XDG dirs).

| Test | Covers |
|---|---|
| `tui/test/agent.test.ts` | `run`, events, retries |
| `tui/test/compact.test.ts` | `compact.ts`, `attach.ts`, session folding |
| `tui/test/session.test.ts` | `session.ts` |
| `tui/test/prompt.test.ts` | `prompt.ts` |
| `tui/test/repair.test.ts` | `repair.ts` with a loadout |
| `tui/test/metrics.test.ts` | `metrics.ts` |
| `tui/test/provider-runtime.test.ts` | `hosted.ts`, `model-discovery.ts`, `provider-test.ts`, `provider.ts` |
| `tui/test/remote-approval.test.ts` | `remote-approval.ts` |
| `tui/test/remote-prompt.test.ts` | `remote-prompt.ts` |
| `tui/test/session-sync.test.ts` | `session-sync.ts` |
| `tui/test/discover.test.ts` | markdown agents via `loadAgents` |
| `tui/test/config.test.ts` | `parseModelID`, `catalogKey`, `listModels` |
