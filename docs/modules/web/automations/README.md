# Automations

Code: `web/src/server/automations/`, `web/src/app/api/automations/`, `web/src/app/api/device/automation/`, `web/src/app/api/workstation/automation/`, `web/src/components/automations/`, `web/src/lib/automations/`, `web/src/lib/api/automations.ts`, `web/src/app/(protected)/app/automations/` · Verified: 2026-10-14 @ c9135de

## Purpose
A small node-graph workflow engine scoped to one workstation. A user draws a graph in a
ReactFlow canvas, publishes it, and runs it by hand, by webhook or on a cron schedule. Inline
nodes (`set`, `log`, ...) run inside the web request. `agent` nodes are handed to the paired
workstation, which runs them with `jarvis work` and posts the result back.

## How it works

### 1. Definition format and node registry
- `web/src/lib/automations/node-registry.ts` → `nodeRegistry` is the only list of node types.
  Each entry has `label`, `category` (`triggers` | `core` | `utility`), `defaultParams`, a zod
  `paramsSchema` and `ui.fields` (which drives the config form). There are exactly seven types:

  | Type | Category | Params | Runtime behaviour (`web/src/server/automations/runner.ts` → `executeInline`) |
  |---|---|---|---|
  | `manualTrigger` | triggers | none | returns `$json` (the trigger payload) |
  | `webhookTrigger` | triggers | `path`, `method` (display only) | returns `$json` |
  | `set` | core | `field`, `value` | returns `{ [field]: value }` |
  | `if` | core | `left`, `op`, `right` | **pass-through**, does not branch |
  | `merge` | core | `mode` (`passThrough` \| `combine`) | **pass-through** |
  | `agent` | core | `prompt`, `cwd`, `model`, `timeoutSec` (30–7200) | suspends the run, queues a job |
  | `log` | utility | `message` | returns `{ message }` |

- `web/src/lib/automations/definition.ts` → `editorGraphToDefinition` compiles the ReactFlow
  graph (`{ nodes, edges }`) into a `WorkflowDefinition`: `{ version: 1, nodes, connections, meta }`.
  Each node becomes `{ id, type, name, params }`. Each edge becomes `{ from, to, fromHandle }`.
  `fromHandle` is carried so an `if` false branch could be expressed later. The runner ignores it today.
- The compile step also validates. It returns `errors` (and publish refuses) when:
  - a node type is unknown (`Object.hasOwn(nodeRegistry, type)`, so `toString` is unknown too),
    or its params fail the registry schema;
  - the graph has a cycle (`topoSort`, Kahn's algorithm);
  - in a graph with more than one node, a non-trigger node has no incoming edge. A lone
    `agent` node is allowed, because "Run now" can drive it.
- `topoSort` breaks ties on the original node index, so the same graph always compiles to the
  same array. The runner walks `definition.nodes` by index, so this sort, done once at publish,
  is the execution order.

### 2. Save, versions, publish
- **Save** (`web/src/server/automations/save.ts` → `saveAutomationGraph`) upserts the
  `automation` row and appends a new `automation_version` row with `editorGraph` and
  `definition: null` on every save. It also writes the graph into the legacy
  `automation.metadata` text column, because the edit page still loads from there.
- **Publish** (`web/src/server/automations/publish.ts` → `publishAutomation`) takes the newest
  version, compiles its `editorGraph`, writes `definition` (and `compiledPlan`, a passthrough
  from the request body, never computed), then sets `automation.status = "active"` and
  `publishedVersion`. If no version rows exist yet, it bootstraps version 1 from
  `automation.metadata`. If that JSON does not parse, publish fails rather than publishing an
  empty graph.
- **Why a version per save:** "newest" and "published" are different things. Triggers run
  `publishedVersionOf(automationId, automation.publishedVersion)` in
  `web/src/server/automations/runner.ts`, so editing a draft never changes what a webhook runs.
- The edit page's Publish button saves first, then publishes, so it publishes what is on screen.

### 3. Triggers
`web/src/server/automations/triggers.ts` → `createTrigger` validates and inserts an
`automation_trigger` row. `triggerInputSchema` is a discriminated union: `{ type: "webhook" }`
or `{ type: "cron", config: { expression, tz } }`. Cron is validated at creation (`parseCron`,
`isTimeZone`), so a typo is a 400 and not a schedule that silently never fires. Every trigger
gets a `key` (`nanoid(24)`). Only webhooks use it, as the URL path segment.

- **Manual:** `POST /api/workstation/automation/run/...` → `startRun` with `triggerId: null`.
- **Webhook:** `POST /api/automations/webhook/[triggerKey]` checks the shared secret
  `AUTOMATION_WEBHOOK_SECRET`, read only from the `x-automation-secret` or `x-webhook-secret`
  header and compared in constant time (`secretMatches`, `crypto.timingSafeEqual`). It then looks the trigger up by `type = "webhook"` and `key`, requires the
  automation to be `active` with a compiled published version, and calls `startRun` with the
  JSON body as `input`. It replies with `runId` and status, not the run's result. The run may
  be suspended on an agent node.
- **Cron:** there is no scheduler process. `web/src/server/automations/schedule.ts` →
  `sweepCron(workstationId)` is called from the device claim poll. For every cron trigger on
  that workstation, `isDue` checks that the automation is active and published, that
  `lastFiredAt` is before the current minute, and that the expression `matches` the wall-clock
  time in the trigger's own `tz` (`web/src/lib/automations/cron.ts` → `partsIn`, using `Intl`).
  A conditional `UPDATE ... SET last_fired_at = <minute> WHERE last_fired_at IS NULL OR < <minute>`
  decides which poller wins, so several workstations polling at once still start one run.
  Input is `{ trigger: "cron", firedAt }`.
- Cron syntax (`web/src/lib/automations/cron.ts`): 5 numeric fields. Each field takes `*`, `n`, `a-b`, `/step` and
  comma lists. Weekday 7 means Sunday. When both day-of-month and day-of-week are restricted
  they are ORed (classic cron rule). Names like `MON` are rejected.

### 4. Runner
`web/src/server/automations/runner.ts` is a resumable step loop. The run's state is just its
`automation_run_step` rows: the next node index is the step count, and template context is the
previous rows' `output`. Nothing is held in memory, so a server restart mid-run loses nothing.

1. `startRun` inserts `automation_run` (`status: "running"`) and calls `advance(runId)`.
2. `advance` loads the version's `definition` and the steps so far. `nextAction` returns
   `wait` if any step is still `queued`/`running`, so re-entering never runs a step twice.
3. For each remaining node, in array order:
   - Inline node: `executeInline`, insert a `succeeded` step with `input: { nodeId, params }`
     and the output, then update `ctx.$prev` and `ctx.$node[id]`. A throw inserts a `failed`
     step and fails the run.
   - `agent` node: insert a `running` step and an `automation_job` (`status: "pending"`) with
     payload `{ stepId, nodeId, prompt, cwd, model, timeoutSec }`. The prompt is resolved from
     templates. Then **return** `{ status: "running", suspended: true }`.
4. When no nodes remain, the run becomes `succeeded` with `stepCount`.

Templates (`resolve`): `{{$json.x}}` (trigger input), `{{$prev.text}}` (previous step output),
`{{$node.<nodeId>.text}}`. This is plain path lookup, not an expression language. A string that
is one whole template resolves to the raw value (so `{{$json}}` can carry an object). Inside a
longer string, objects are JSON-stringified. `asText` turns a value into a string without
producing `[object Object]`.

### 5. How agent jobs reach `jarvis work`
The workstation is usually behind NAT, so the web app never calls it. The workstation polls.

```
web (advance) ── insert automation_job(pending) ──┐
                                                  ▼
jarvis work ── POST /api/device/automation/claim ──► sweep timeouts → sweepCron → claim 1 job
            ◄── { job: { id, prompt, cwd, model, timeoutSec } } (or { job: null })
            runs runHeadless(...) inside --root; "ask" tool calls refused unless -y
            ── POST /api/device/automation/result { jobId, ok, text, error, usage } ──►
                  job → succeeded/failed, step → output { text, usage }, advance(runId)
```

- **Claim** (`web/src/app/api/device/automation/claim/route.ts` → `POST`) does three things,
  scoped to the device's workstation:
  1. Fails `running` jobs whose `locked_at + payload.timeoutSec` (default 900) has passed, then
     `failRun` on their runs.
  2. Runs `sweepCron`.
  3. Claims the oldest `pending` job with `FOR UPDATE SKIP LOCKED`, so two devices never take
     the same row. This sets `locked_by`, `locked_at` and `attempts + 1`.
- **Result** (`web/src/app/api/device/automation/result/route.ts` → `POST`) checks that
  `job.lockedBy` is this device and the run belongs to this device's workstation. It finishes
  the job with one conditional `UPDATE ... WHERE id = ? AND status = 'running' RETURNING`. Zero
  rows (a retry, or the sweep already failed it) answers 200 `{ success, ignored: true, status }`
  and changes nothing, so two deliveries can't both call `advance`. On `ok: false` it then fails
  the step and the run. On `ok: true` it stores `{ text, usage }` on the step and calls `advance`.
- The client is `tui/src/cli/work.ts` → `work`. It refuses any job whose `cwd` resolves outside
  `--root` (`within`) and reports that as a failed result. Tool calls the worker's `permission`
  rules would `ask` about are refused unless it was started with `-y` (D-11). It aborts after `timeoutSec`. Polling
  is every 3 s while busy and every 15 s after 2 min idle. See [tui/cli](../../tui/cli/README.md).

### 6. Run status and the runs UI
`web/src/lib/automations/run-status.ts` → `unfinished` (`queued`/`running`), `runBadgeVariant`
and `RUN_POLL_MS` (3 s) are shared by the runs list and the run detail page. Both pages poll with
React Query only while something is unfinished, because nothing pushes updates. The run page
shows a "run `jarvis work`" hint when an `agent` step is still waiting.

## Files
| File | Responsibility |
|---|---|
| `web/src/lib/automations/node-registry.ts` | `nodeRegistry`, `nodeRegistryList`, `getNodeRegistryItem`, `AutomationNodeType`; param schemas and form metadata |
| `web/src/lib/automations/definition.ts` | `WorkflowDefinition` types, `topoSort`, `editorGraphToDefinition` (compile + validate) |
| `web/src/lib/automations/cron.ts` | `parseField`, `parseCron`, `matches`, `partsIn`, `isTimeZone`, `minuteStart` (dependency-free cron) |
| `web/src/lib/automations/run-status.ts` | `unfinished`, `runBadgeVariant`, `RUN_POLL_MS` |
| `web/src/lib/api/automations.ts` | `automationsApi` axios client and the `Automation`, `AutomationRun`, `AutomationRunStep`, `AutomationTrigger`, `CronConfig`, `AutomationVersions` types |
| `web/src/server/automations/access.ts` | `authorizeAutomation`: session plus `ownsAutomation`, returned as a row or a 401/403/404 response; used by every per-automation workstation route |
| `web/src/server/automations/save.ts` | `saveAutomationGraph`: upsert the automation, append a draft version |
| `web/src/server/automations/publish.ts` | `publishAutomation`, `EditorGraph`, `PublishResult` |
| `web/src/server/automations/triggers.ts` | `createTrigger`, `triggerInputSchema`, `cronConfigSchema` |
| `web/src/server/automations/schedule.ts` | `isDue` (pure cron rule), `sweepCron` (never throws) |
| `web/src/server/automations/runner.ts` | `startRun`, `advance`, `nextAction`, `executeInline`, `resolve`, `asText`, `failRun`, `publishedVersionOf` |
| `web/src/app/api/automations/webhook/[triggerKey]/route.ts` | Public webhook receiver |
| `web/src/app/api/device/automation/claim/route.ts` | Device poll: timeout sweep, cron tick, job claim |
| `web/src/app/api/device/automation/result/route.ts` | Device posts an agent result; resumes the run |
| `web/src/app/api/workstation/automation/list/[workstationId]/route.ts` | List automations of a workstation |
| `web/src/app/api/workstation/automation/load/[workstationId]/[automationId]/route.ts` | Load one automation (with legacy `metadata`) |
| `web/src/app/api/workstation/automation/save/[workstationId]/[automationId]/route.ts` | Create or update, appending a draft version |
| `web/src/app/api/workstation/automation/publish/[workstationId]/[automationId]/route.ts` | Compile and publish the newest version |
| `web/src/app/api/workstation/automation/versions/[workstationId]/[automationId]/route.ts` | List versions |
| `web/src/app/api/workstation/automation/run/[workstationId]/[automationId]/route.ts` | "Run now" (manual trigger) |
| `web/src/app/api/workstation/automation/run/[workstationId]/[automationId]/[runId]/route.ts` | Read one run with its steps (both queries in parallel) |
| `web/src/app/api/workstation/automation/runs/[workstationId]/[automationId]/route.ts` | List the last 100 runs |
| `web/src/app/api/workstation/automation/triggers/[workstationId]/[automationId]/route.ts` | List and create triggers |
| `web/src/app/api/workstation/automation/triggers/[workstationId]/[automationId]/[triggerId]/route.ts` | Delete a trigger (revokes a webhook URL) |
| `web/src/components/automations/automation-canvas.tsx` | ReactFlow editor (`AutomationCanvas`, `CanvasState`, `AutomationCanvasHandle`), right-click menus, drop target |
| `web/src/components/automations/automation-palette.tsx` | Registry-driven node palette (click or drag) |
| `web/src/components/automations/node-config-panel.tsx` | Schema-driven param form with an "Expression" toggle; `EditorNodeData` type |
| `web/src/components/automations/automation-triggers.tsx` | `AutomationTriggers` card: webhook URL, untrusted-body warning, cron form, delete |
| `web/src/app/(protected)/app/automations/page.tsx` | Automations list for the active workstation; fetches in an effect with a stale-response guard, `loading` derived |
| `web/src/app/(protected)/app/automations/create/page.tsx` | New automation (palette + canvas; first save creates the row) |
| `web/src/app/(protected)/app/automations/[id]/edit/page.tsx` | Editor: Save, Publish (save then publish), Run now, Triggers, publish errors |
| `web/src/app/(protected)/app/automations/[id]/runs/page.tsx` | Runs table, polled while unfinished |
| `web/src/app/(protected)/app/automations/[id]/runs/[runId]/page.tsx` | Run detail: per-step input, output, error, duration |

## Interfaces

### Session routes (browser)
Auth: better-auth session (cookie, or `Authorization: Bearer <session token>`). Every route with
an `:id` goes through `authorizeAutomation` (`web/src/server/automations/access.ts` →
`ownsAutomation` in `web/src/server/ownership.ts`); `list` checks the workstation's `userId`
inline. Failures: 401 no session, 403 not your workstation, 404 no such automation.

| Method · path | Handler | Body | Response |
|---|---|---|---|
| `GET /api/workstation/automation/list/:workstationId` | `web/src/app/api/workstation/automation/list/[workstationId]/route.ts` → `GET` | none | `Automation[]` (full rows) |
| `GET /api/workstation/automation/load/:ws/:id` | `web/src/app/api/workstation/automation/load/[workstationId]/[automationId]/route.ts` → `GET` | none | row plus `versioning: { status, publishedVersion }` |
| `POST /api/workstation/automation/save/:ws/:id` | `web/src/app/api/workstation/automation/save/[workstationId]/[automationId]/route.ts` → `POST` | `{ name, data?: { nodes, edges } }` | `{ success, version }`; 400 `invalid_request`. Creates the automation if it is new. |
| `POST /api/workstation/automation/publish/:ws/:id` | `web/src/app/api/workstation/automation/publish/[workstationId]/[automationId]/route.ts` → `POST` | `{ compiledPlan? }` | `{ success, publishedVersion }`; 400 `{ error: "Invalid workflow", details: string[] }` |
| `GET /api/workstation/automation/versions/:ws/:id` | `web/src/app/api/workstation/automation/versions/[workstationId]/[automationId]/route.ts` → `GET` | none | `{ success, automation: { id, name, status, publishedVersion }, versions: [{ id, version, createdAt, createdBy }] }` |
| `POST /api/workstation/automation/run/:ws/:id` | `web/src/app/api/workstation/automation/run/[workstationId]/[automationId]/route.ts` → `POST` | any JSON (becomes `$json`), optional | `{ success, runId, status, suspended }`; 400 not published; 409 version missing or never compiled; 500 runner error |
| `GET /api/workstation/automation/run/:ws/:id/:runId` | `web/src/app/api/workstation/automation/run/[workstationId]/[automationId]/[runId]/route.ts` → `GET` | none | `{ run, steps[] }` |
| `GET /api/workstation/automation/runs/:ws/:id` | `web/src/app/api/workstation/automation/runs/[workstationId]/[automationId]/route.ts` → `GET` | none | `{ runs: [{ id, status, createdAt, startedAt, finishedAt, stepCount, triggerId }] }` (newest 100) |
| `GET /api/workstation/automation/triggers/:ws/:id` | `web/src/app/api/workstation/automation/triggers/[workstationId]/[automationId]/route.ts` → `GET` | none | `{ triggers: [{ id, type, key, config, lastFiredAt, createdAt }] }` |
| `POST /api/workstation/automation/triggers/:ws/:id` | `web/src/app/api/workstation/automation/triggers/[workstationId]/[automationId]/route.ts` → `POST` | `{ type: "webhook" }` or `{ type: "cron", config: { expression, tz } }` | 201 `{ success, trigger }`; 400 `invalid_request` / `invalid_cron` / `invalid_timezone` with `detail` |
| `DELETE /api/workstation/automation/triggers/:ws/:id/:triggerId` | `web/src/app/api/workstation/automation/triggers/[workstationId]/[automationId]/[triggerId]/route.ts` → `DELETE` | none | `{ success }`; 404 if not on this automation |

### Device routes (`jarvis work`)
Auth: `Authorization: Bearer jvd_...` device token via `authenticateDevice`
(`web/src/server/device-auth.ts`). No scope is checked.

| Method · path | Handler | Body | Response |
|---|---|---|---|
| `POST /api/device/automation/claim` | `web/src/app/api/device/automation/claim/route.ts` → `POST` | none | `{ job: { id, prompt, cwd, model, timeoutSec } \| null }` |
| `POST /api/device/automation/result` | `web/src/app/api/device/automation/result/route.ts` → `POST` | `{ jobId, ok, text? (≤200 000 chars), error? (≤4000), usage?: { input, output, cost } }` | `{ success, status, suspended }` after `advance`; `{ success, status: "failed" }`; `{ success, ignored: true, status }` if already settled; 400/403/404 |

### Public route
| Method · path | Handler | Auth | Body | Response |
|---|---|---|---|---|
| `POST /api/automations/webhook/:triggerKey` | `web/src/app/api/automations/webhook/[triggerKey]/route.ts` → `POST` | `AUTOMATION_WEBHOOK_SECRET` in the `x-automation-secret` or `x-webhook-secret` header (no query string) | any JSON (becomes `$json`; invalid JSON becomes `null`) | `{ success, runId, status, suspended }`; 401 bad secret; 404 unknown key; 400 not published; 409 version missing or never compiled; 500 |

### MCP
`web/src/server/mcp/tools/automations.ts` and `web/src/server/mcp/tools/authoring.ts` call
`publishAutomation`, `saveAutomationGraph`, `createTrigger`, `startRun` and
`publishedVersionOf` directly. That is why those functions live in `server/automations/` and
not in the routes. Tool list: [web/mcp](../mcp/README.md).

## Data and state
| Table (schema file) | Used for |
|---|---|
| `automation` (`web/src/server/db/schemas/automation.ts`) | name, `status` (`draft`/`active`/`paused`/`archived`), `publishedVersion`, legacy `metadata` graph JSON; index `automation_workstation_idx` |
| `automation_version` (`web/src/server/db/schemas/automation-version.ts`) | one row per save: `editorGraph`, `definition` (written by publish), `compiledPlan` |
| `automation_trigger` (`web/src/server/db/schemas/automation-trigger.ts`) | `type`, `key`, `config` `{ expression, tz }`, `lastFiredAt`; index on `(workstation_id, type)` for the per-poll sweep; unique `automation_trigger_key_unique` on `key` (webhook lookup) |
| `automation_run` (`web/src/server/db/schemas/automation-run.ts`) | one execution: `status`, `triggerId`, `input`, `stepCount`; index `automation_run_automation_created_idx` `(automation_id, created_at)` |
| `automation_run_step` (`web/src/server/db/schemas/automation-run-step.ts`) | per-node `status`, `input`, `output`, `error`, timings. This is the runner's resume state. Unique `automation_run_step_run_index_unique` `(run_id, index)`, so a duplicate step insert fails. |
| `automation_job` (`web/src/server/db/schemas/automation-job.ts`) | DB queue for `agent` steps: `status`, `payload`, `lockedAt`/`lockedBy`, `attempts`, `availableAt`, `lastError`; index `automation_job_status_available_idx` `(status, available_at)` for the claim |

Every FK on these tables is `onDelete: "cascade"` (`web/drizzle/0018_tough_thunderbolts.sql`), so
deleting a workstation, user or automation removes its versions, triggers, runs, steps and jobs.

ID prefixes: runs `arn_`, steps `ars_`, jobs `ajb_`, triggers `atr_`. Versions use UUIDs.
Automations created in the browser get a client-side UUID (the create page). Those created
over MCP get `atm_...`.

Env: `AUTOMATION_WEBHOOK_SECRET` (server, min 8 chars, validated in `web/src/env.js`).
`NEXT_PUBLIC_BASE_URL` builds the webhook URL shown in `AutomationTriggers`.

No in-memory state. Cron state is `automation_trigger.last_fired_at`.

## Depends on / used by
- **Depends on:** `web/src/server/ownership.ts` and `web/src/server/device-auth.ts`
  ([web/devices-and-pairing](../devices-and-pairing/README.md)), `web/src/lib/auth.ts`
  ([web/auth-and-accounts](../auth-and-accounts/README.md)), `web/src/lib/workstation-hooks.ts`
  (active workstation), the db client ([web/database](../database/README.md)), the UI kit and
  `web/src/lib/api/error.ts` ([web/frontend-shell](../frontend-shell/README.md)).
- **Used by:** the MCP server ([web/mcp](../mcp/README.md)), `tui/src/cli/work.ts`
  (`jarvis work`), and the Automations entry in `web/src/config/dashboard-sidebar-nav.ts`.

## Gotchas
- **`if` and `merge` do not branch.** Publish orders the nodes topologically and `fromHandle` is
  stored, but `advance` runs every node in array order. Both sides of an `if` run. The
  `ponytail:` note at the top of `web/src/server/automations/runner.ts` predates `topoSort`: ordering is now done, branching is not.
- **Cron fires only while some workstation polls.** If the minute passes with every machine
  asleep, the run is skipped, not delayed. The trigger card says so in the UI.
- **The webhook secret is one value for the whole deployment**, shared across tenants, not per
  trigger (known gap). The per-trigger part is the 24-char `key` in the URL. nginx rate-limits `/api/automations/webhook/` in the strict zone
  (`k8s/base/nginx.conf`).
- **The `webhookTrigger` node and webhook triggers are unrelated.** The node's `path`/`method`
  params are display only. What makes a URL work is an `automation_trigger` row. The receiver
  is POST only.
- **A timed-out agent step stays `running`.** The claim sweep calls `failRun(runId, null, ...)`,
  so the run is `failed` but its step row is never closed. The run page may still show the
  "waiting for a workstation" hint for that step.
- **Device routes do not check scopes.** Any active device paired to the workstation can claim
  agent jobs. `--root` on the worker is the only limit on where they run.
- **The webhook body is untrusted.** An `agent` prompt with `{{$json}}` carries text whoever
  holds the URL wrote. `jarvis work` refuses `ask` tool calls unless started with `-y` (D-11);
  `AutomationTriggers` says so under the webhook URL.
- `attempts` is incremented but nothing retries. A failed job stays failed. `canceled` exists
  as a status but nothing writes it.
- The edit page loads the graph from legacy `automation.metadata`, not from
  `automation_version`. If that JSON fails to parse, the canvas resets to empty and the next
  Save overwrites the graph. This is the same gap the rewrite plan's appendix names.
- The canvas right-click menu has no "Add Agent" entry (use the palette on the create page), and
  "Change Automation Type" does nothing. The canvas's own **Save** button only emits state to
  the page. Persisting is done by the page's Save/Publish.
- The runs table labels any run with a `triggerId` as "webhook", including cron runs.
- Pausing (`status: "paused"`) and archiving have no HTTP route. Only the MCP tool
  `automation_set_status` changes status after publish.
- `web/src/server/db/schemas/automation-run.ts` and `web/src/server/db/schemas/automation-version.ts` say "migrations are intentionally deferred".
  That is stale: all six tables are created in `web/drizzle/0003_lush_nightmare.sql`,
  `last_fired_at` plus its index were added in `web/drizzle/0011_blue_gamora.sql`, and the FK
  cascades and indexes in `web/drizzle/0018_tough_thunderbolts.sql`.

### Progress against `docs/automations-rewrite-plan.md`
| Plan item | State in code |
|---|---|
| `automation_version`, migrate legacy `metadata` to v1 | Done, lazily at first publish (`publishAutomation`) |
| Node registry with schemas; schema-driven config panel; registry-driven palette | Done (7 node types) |
| Validate and compile (schema, cycles, topological order) | Done; no "exactly one trigger" rule; `compiledPlan` never computed |
| DB-backed queue, run + step persistence | Done (`automation_job`, `SKIP LOCKED`), but only for `agent` steps |
| Separate worker process | **Different design:** runner re-enters per request; the device claim poll is the scheduler; agent work runs on the workstation via `jarvis work` |
| Webhook trigger | Done, at `/api/automations/webhook/:key` with one global secret; no idempotency |
| Cron trigger | Done, but no `nextRunAt`; fires only during device polls |
| Manual run, runs list, run/step inspector | Done |
| Expressions | Minimal `{{path}}` lookup only, no operators or JS |
| If/Switch/Loop branching, `httpRequest` node | Not done (`if`/`merge` pass through; no switch, loop or http) |
| Credentials / `connector_credential`, connectors | Not done |
| Retries/backoff, concurrency controls, cancel, re-run from failed node | Not done |
| Enable/disable/validate HTTP routes | Not done (MCP has `automation_set_status` and `automation_validate`) |
| "Run once" live outputs in the editor | Not done |
| Route shape `/api/workstation/automation/:ws/:id/<verb>` | Different: verb comes first (`/automation/<verb>/:ws/:id`) |

## Tests
Run with `pnpm --filter web test` (all suites), or `pnpm --filter web test -- automations` for this module.

| File | Covers |
|---|---|
| `web/src/__tests__/automations-cron.test.ts` | `parseField`, `parseCron`, `matches` (day-of-month/weekday OR rule), `partsIn` (zones, DST, midnight), `isTimeZone`, `minuteStart` |
| `web/src/__tests__/automations-schedule.test.ts` | `isDue`: once per minute, timezone, inactive or unpublished, malformed config, unknown zone |
| `web/src/__tests__/automations-runner.test.ts` | `resolve`, `nextAction` (suspend, wait, resume, done), `executeInline` (incl. `if`/`merge` pass-through) |
| `web/src/__tests__/automations-run-status.test.ts` | `unfinished`, `runBadgeVariant` |
| `web/src/__tests__/mcp-authoring.test.ts` | `editorGraphToDefinition` and `topoSort` (listed under MCP; it exercises this module's compiler) |

Not covered: the routes, `advance`/`startRun` against a database, `sweepCron`'s conditional
update, and the UI.
