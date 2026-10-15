# Automations

Modules: [web/automations](../modules/web/automations/README.md), [web/mcp](../modules/web/mcp/README.md), [tui/cli](../modules/tui/cli/README.md) · Verified: 2026-10-15 @ aff1145

## Who and why
A signed-in user wants a job to run without them: "every weekday at 9, have the agent check the
failing tests", or "when CI calls this URL, summarise the payload". They draw a small node graph
in the browser, publish it, and start it by hand, by webhook or on a cron schedule. Light nodes
run inside the web request. `agent` nodes run on the user's own paired machine through
`jarvis work`, which polls for work and posts the result back. Agents can author and run
automations over MCP too.

## Flow

### 1. Draw and save
1. The user opens `/app/automations` for the active workstation and creates one. The create
   page gives the automation a client-side UUID on the first save. Automations made over MCP get
   `atm_` + 16 chars instead.
2. Nodes come from the palette, which is built from the node registry
   (`web/src/lib/automations/node-registry.ts` → `nodeRegistry`). The config panel is a form
   generated from each node's fields.
3. **Save** posts `{ name, data: { nodes, edges } }` to
   `POST /api/workstation/automation/save/:workstationId/:automationId`.
   `web/src/server/automations/save.ts` → `saveAutomationGraph` creates the automation
   (`status: "draft"`) or updates its name, and **appends a new version row** holding the editor
   graph, with `definition: null`. It also copies the graph into the legacy
   `automation.metadata` column, because the edit page still loads from there.

### 2. Publish
1. **Publish** on the edit page saves first, then calls
   `POST /api/workstation/automation/publish/:workstationId/:automationId`, so it publishes what
   is on screen.
2. `web/src/server/automations/publish.ts` → `publishAutomation` takes the **newest** version and
   compiles its graph with `web/src/lib/automations/definition.ts` → `editorGraphToDefinition`.
3. On success it stores the compiled `definition` on that version, sets the automation to
   `active` and points `publishedVersion` at it. On failure it returns 400
   `{ error: "Invalid workflow", details: [...] }` and the page lists each problem.
4. An old automation with no version rows yet gets version 1 built from `automation.metadata`.
   If that JSON does not parse, publish fails ("The saved graph could not be read") instead of
   publishing an empty graph.

### 3. Add triggers
The edit page's triggers card (`web/src/components/automations/automation-triggers.tsx`) calls
`POST /api/workstation/automation/triggers/:workstationId/:automationId` with `{ type: "webhook" }`
or `{ type: "cron", config: { expression, tz } }` (`web/src/server/automations/triggers.ts` →
`createTrigger`). Every trigger gets a random 24-char `key`. A webhook uses it in its URL,
`<NEXT_PUBLIC_BASE_URL>/api/automations/webhook/<key>`. Deleting a trigger revokes that URL.

### 4. A run starts
All four entry points end in `web/src/server/automations/runner.ts` → `startRun`, against the
**published** version (`publishedVersionOf`), never the newest draft:

| Entry | Who calls it | Input the graph sees as `$json` |
|---|---|---|
| Run now | `POST /api/workstation/automation/run/:workstationId/:automationId` (session) | the request body, or `null` |
| Webhook | `POST /api/automations/webhook/:triggerKey` (public, shared secret) | the JSON body, or `null` if it is not JSON |
| Cron | the device claim poll (see step 6) | `{ trigger: "cron", firedAt }` |
| MCP | `automation_run` tool | the tool's `input`, or `null` |

`startRun` inserts an `automation_run` row (`arn_…`, `status: "running"`) and calls `advance`.
The caller gets `{ runId, status, suspended }` back, never the run's output.

### 5. The runner
`advance(runId)` is a resumable loop. A run's only state is its `automation_run_step` rows: the
next node to run is at index "number of steps so far", and earlier step outputs are the template
context. Nothing is kept in memory, so a server restart mid-run loses nothing.

1. If any step is still `queued` or `running`, return and wait. Re-entering never runs a step twice.
2. Walk the remaining nodes in `definition.nodes` order (the order publish computed):
   - **Inline node** (`set`, `log`, `if`, `merge`, triggers): run it now (`executeInline`) and
     insert a `succeeded` step with its output. If it throws, insert a `failed` step and fail the run.
   - **`agent` node**: resolve the prompt template, insert a `running` step and an
     `automation_job` (`ajb_…`, `status: "pending"`) with payload
     `{ stepId, nodeId, prompt, cwd, model, timeoutSec }`. Then **return**: the run is suspended.
3. When no nodes are left, the run becomes `succeeded` with its `stepCount`.

### 6. The workstation picks up the agent job
The workstation is usually behind NAT, so the web never calls it. It polls.

1. The user runs `jarvis work [--root <dir>] [-y]` on a paired machine (`tui/src/cli/work.ts` →
   `work`). `--root` defaults to the current directory.
2. Each poll is `POST /api/device/automation/claim` with the device token. In one request, scoped
   to the device's workstation, the server:
   1. fails every `running` job whose `locked_at + timeoutSec` has passed, and fails its run;
   2. runs `web/src/server/automations/schedule.ts` → `sweepCron` and starts any cron run that is due;
   3. claims the oldest `pending` job with `FOR UPDATE SKIP LOCKED`, setting `locked_by`,
      `locked_at` and `attempts + 1`. It answers `{ job: { id, prompt, cwd, model, timeoutSec } }`
      or `{ job: null }`.
3. The worker resolves `cwd` against `--root`. A path outside the root is refused and reported
   as a failed result. Otherwise it runs a headless agent turn there, with the job's model (or
   the local default) and an abort after `timeoutSec`.
4. It posts `POST /api/device/automation/result` with `{ jobId, ok, text, error, usage }`.

### 7. The result comes back, race-free
`web/src/app/api/device/automation/result/route.ts` → `POST`:

1. The job must be locked by this device (403), and its run must belong to this device's
   workstation (403).
2. It finishes the job with one conditional `UPDATE … WHERE id = ? AND status = 'running'
   RETURNING`. If no row changed (a retried delivery, or the timeout sweep got there first),
   it answers 200 `{ success: true, ignored: true, status }` and does nothing else. So two
   deliveries can never both resume the run.
3. On `ok: false` the step and the run are failed with the error.
4. On `ok: true` the step stores `{ text, usage }` and `advance` runs again. That may finish the
   run, or suspend it on the next `agent` node.

### 8. Watching runs
`/app/automations/[id]/runs` lists the newest 100 runs. `/app/automations/[id]/runs/[runId]`
shows each step's input, output, error and duration. Both pages poll every 3 s
(`web/src/lib/automations/run-status.ts` → `RUN_POLL_MS`), but only while something is `queued`
or `running`, because nothing pushes updates. While an `agent` step waits, the run page says to
run `jarvis work` on the paired machine.

## Business rules

**Node registry.** Exactly seven node types. Params are checked against each type's zod schema at publish.

| Type | Params | What it does at run time |
|---|---|---|
| `manualTrigger` | none | returns `$json` |
| `webhookTrigger` | `path`, `method` | returns `$json`. The params are display only; a webhook URL comes from a trigger row. |
| `set` | `field`, `value` | returns `{ [field]: value }` (field defaults to `value` if it resolves empty) |
| `if` | `left`, `op`, `right` | passes the previous output through. **It does not branch.** |
| `merge` | `mode` (`passThrough` or `combine`) | passes through |
| `agent` | `prompt` (required), `cwd`, `model`, `timeoutSec` (integer, 30–7200, default 900) | queues a job for `jarvis work` |
| `log` | `message` | returns `{ message }` |

**Definition format.** `{ version: 1, nodes: [{ id, type, name, params }], connections: [{ from,
to, fromHandle }], meta: { generatedAt } }`. `fromHandle` is stored but the runner ignores it.

**Publish refuses a graph when** a node type is unknown, a node's params fail its schema, the
graph has a cycle, or (in a graph with more than one node) a non-trigger node has no incoming
edge. A single `agent` node on its own is allowed. There is no "exactly one trigger" rule.

**Execution order.** Publish sorts the nodes topologically (Kahn's algorithm, ties broken by the
original node order), so the same graph always compiles to the same order. The runner then runs
every node in that order. Both sides of an `if` run.

**Templates** (`resolve`): `{{$json.x}}` is the trigger input, `{{$prev.x}}` the previous step's
output, `{{$node.<nodeId>.x}}` a named step's output. It is a plain path lookup, not an
expression language. A param that is exactly one template gets the raw value (so `{{$json}}` can
carry an object). Inside longer text, objects become JSON. An agent step's output is
`{ text, usage }`, so the next node reads `{{$prev.text}}`. Only an agent's `prompt` is
resolved. `cwd` and `model` are used as written.

**Versions and status.**
- Every save appends a version. "Newest" and "published" are different things, so editing a
  draft never changes what a trigger runs.
- `automation.status` is `draft` until the first publish, then `active`. Publishing again sets
  `active` again.
- Run now, webhooks, cron and MCP runs all need `status = "active"` and a published version.
  Only the MCP tool `automation_set_status` can set `paused` or `archived`. There is no browser
  route for it, and a paused automation is skipped by every trigger.
- Version numbers are "highest + 1" with no unique index on `(automation_id, version)`, so two
  saves at the same instant could write the same number.

**Run and step statuses.** Runs and steps use `queued`, `running`, `succeeded`, `failed`. Jobs
use `pending`, `running`, `succeeded`, `failed`. The badge code knows `canceled`, but nothing
writes it.

**Webhook rules** (`web/src/app/api/automations/webhook/[triggerKey]/route.ts`):
- POST only. The secret `AUTOMATION_WEBHOOK_SECRET` (at least 8 chars, `web/src/env.js`) must be
  in the `x-automation-secret` or `x-webhook-secret` header. It is compared in constant time.
  A query-string secret is not accepted.
- It is one secret for the whole deployment, not one per trigger. The per-trigger part is the
  24-char key in the URL.
- nginx rate-limits `/api/automations/webhook/` per IP: 30 requests a minute, burst 15
  (`k8s/base/nginx.conf`).
- The body is untrusted. Whoever holds the URL writes `$json`, and an `agent` prompt with
  `{{$json}}` carries their text. The triggers card says so.

**Cron rules** (`web/src/lib/automations/cron.ts`, `web/src/server/automations/schedule.ts`):
- Five numeric fields: minute, hour, day of month, month, day of week. Each takes `*`, `n`,
  `a-b`, `/step` and comma lists. Weekday 7 is Sunday. Names like `MON` are rejected.
  If both day fields are restricted, a day matching either one fires (classic cron).
- The time zone is a required IANA name. Both are checked when the trigger is created (400
  `invalid_cron` / `invalid_timezone`), not when it fires.
- **There is no scheduler process.** Cron is checked on each `jarvis work` claim poll for that
  workstation. A trigger fires when its automation is active and published, it has not fired
  this minute, and the expression matches the wall-clock time in its own zone.
- A conditional update of `last_fired_at` to the current minute decides the winner, so several
  machines polling at once start one run.
- If no workstation polls during the minute, that run is skipped, not delayed.

**Agent jobs.**
- A job runs on any active device paired to the automation's workstation. Device routes check
  the token only, not MCP scopes. `--root` is the only limit on where jobs run.
- Without `-y`, any tool call the worker's `permission` config would ask about is refused. With
  `-y`, every tool call is approved, bash included.
- Timeout: the worker aborts after `timeoutSec`. The server fails a `running` job once
  `locked_at + timeoutSec` has passed (900 s if unset), but only when some device of that
  workstation polls.
- Limits on the result: `text` up to 200 000 chars, `error` up to 4000 (stored cut to 2000).
  A longer `text` is rejected with 400, and the worker then reports the step as failed.
- `attempts` is counted, but nothing retries. A failed job stays failed.
- The worker polls every 3 s, and every 15 s once 2 minutes pass with no job.

**Access.**
- Browser routes need a session. Per-automation routes go through
  `web/src/server/automations/access.ts` → `authorizeAutomation`, which looks the automation up
  by workstation as well as by id: 401 with no session, 403 if the workstation is not yours,
  404 if there is no such automation on it. Save checks only workstation ownership, because it
  also creates.
- **MCP** ([MCP access](mcp-access.md)): reads need `automations:read`; create, save, publish,
  delete, run, set status and creating or deleting a trigger need `automations:write` (write
  implies read).
  Every tool is limited to the token's own workstation. `automation_save_graph` validates the
  graph before saving. `automation_delete` only deletes an automation that was never published.
  The tools call the same `saveAutomationGraph`, `publishAutomation`, `createTrigger` and
  `startRun` as the browser.

**Data rules** (`web/drizzle/0018_tough_thunderbolts.sql`):
- Every foreign key on `automation`, `automation_version`, `automation_trigger`,
  `automation_run`, `automation_run_step` and `automation_job` cascades on delete. Deleting a
  user, a workstation or an automation removes its versions, triggers, runs, steps and jobs.
- `automation_run.trigger_id` is not a foreign key. Deleting a trigger keeps its runs, and they
  still name the trigger.
- Unique `automation_trigger_key_unique` on `key`: one webhook URL is one trigger.
- Unique `automation_run_step_run_index_unique` on `(run_id, index)`: a duplicate step insert
  fails instead of running a node twice.

## When it fails
| What happens | What the user sees | How to recover |
|---|---|---|
| Graph has a loop, a loose node or bad params | Publish 400; the edit page lists each message | Fix the graph and publish again. |
| Run now, webhook or MCP run on an unpublished or paused automation | 400 "Automation not published" | Publish it (or set it `active` over MCP). |
| Published version missing, or never compiled | 409 | Publish again. |
| Wrong or missing webhook secret | 401 | Send the right header. |
| Unknown or deleted webhook key | 404 | Create a new webhook trigger and use its URL. |
| Bad cron expression or zone | 400 `invalid_cron` / `invalid_timezone` with `detail` | Fix it; names like `MON` are not accepted. |
| No `jarvis work` running | Run stays `running`; the run page says to start `jarvis work` | Start the worker on a paired machine. |
| Agent job outside `--root` | Step and run `failed`: "cwd is outside the worker's --root" | Fix the node's `cwd` or start the worker with a wider `--root`. |
| Agent turn errors or times out | Step and run `failed` with the error | Fix the cause and run again; nothing retries. |
| Workstation never answers | Run `failed`: "the workstation did not answer in time". The step row stays `running`, so the run page may still show the waiting hint. | Start a new run. |
| Cron minute passed with every machine asleep | No run at all | Keep a worker polling. |
| Result posted twice | Second post gets 200 `ignored: true` | Nothing to do. |
| Edit page graph JSON unreadable | The canvas opens empty; the next Save overwrites the graph | Don't save. Over MCP, `automation_get_graph` reads the newest version's graph and `automation_save_graph` writes it back, legacy column included. |

Known UI gaps: the runs table labels every run that has a trigger as "webhook", cron included.
The canvas right-click menu has no "Add Agent" entry; use the palette.

## Related
- [Pair a device](pair-a-device.md): `jarvis work` needs a paired device.
- [MCP access](mcp-access.md): tokens and scopes for the automation tools.
- [Agent turn and permissions](agent-turn-and-permissions.md): what a headless turn may do without `-y`.
- [Model calls and usage](model-calls-and-usage.md): the `usage` an agent step reports.
- Module docs: [web/automations](../modules/web/automations/README.md),
  [web/mcp](../modules/web/mcp/README.md), [tui/cli](../modules/tui/cli/README.md).
