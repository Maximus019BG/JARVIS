import { asc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "~/server/db";
import { automationJob } from "~/server/db/schemas/automation-job";
import { automationRun } from "~/server/db/schemas/automation-run";
import { automationRunStep } from "~/server/db/schemas/automation-run-step";
import { automationVersion } from "~/server/db/schemas/automation-version";
import type { WorkflowDefinition, WorkflowDefinitionNode } from "~/lib/automations/definition";

/**
 * A resumable step loop.
 *
 * An agent turn takes minutes, and no web request can wait that long, so the runner has to
 * be re-enterable: once by whatever triggered the run, and again each time a workstation
 * posts a result. The trick that keeps it small is that **the run's state is its
 * `automation_run_step` rows** — the next index is the row count, and the context for
 * template resolution is the prior rows' `output`. Nothing is serialized, nothing is held
 * in memory, and a server restart mid-run costs nothing.
 *
 * ponytail: steps run in definition-array order, exactly as the code it replaces did. Real
 * topological order and `if` branching need the definition format to start carrying
 * ReactFlow's `sourceHandle` — see the note in `editorGraphToDefinition`.
 */

/** What a resolved template can see: `{{$json.x}}`, `{{$prev.text}}`, `{{$node.abc.text}}`. */
export type Context = {
  $json: unknown;
  $prev: unknown;
  $node: Record<string, unknown>;
};

const now = () => new Date();

function get(source: unknown, path: string): unknown {
  let current: unknown = source;
  for (const key of path.split(/[.[\]]+/).filter(Boolean)) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

/**
 * `{{$prev.text}}` → the value. Plain string interpolation, no sandbox and no expression
 * language: this is how one node's output reaches the next, and that is all it needs to do.
 * A whole-string template resolves to the value itself so `{{$json}}` can carry an object.
 */
export function resolve(template: unknown, ctx: Context): unknown {
  if (typeof template !== "string") return template;
  const whole = /^\{\{\s*([$\w.[\]]+)\s*\}\}$/.exec(template);
  if (whole) return get(ctx, whole[1]!);
  return template.replace(/\{\{\s*([$\w.[\]]+)\s*\}\}/g, (_, path: string) => {
    const value = get(ctx, path);
    if (value === undefined || value === null) return "";
    return typeof value === "string" ? value : JSON.stringify(value);
  });
}

/**
 * A resolved template as text. Not `String(value)`: a template that resolves to an object
 * would stringify to "[object Object]", which is never what anybody meant to send an agent.
 */
export const asText = (value: unknown): string =>
  value === undefined || value === null ? "" : typeof value === "string" ? value : JSON.stringify(value);

/**
 * Nodes that finish inside the request. `if` and `merge` pass through rather than branch —
 * they are decorative until the definition carries handle ids.
 */
export function executeInline(node: WorkflowDefinitionNode, ctx: Context): unknown {
  switch (node.type) {
    case "set": {
      const field = asText(resolve(node.params.field, ctx)) || "value";
      return { [field]: resolve(node.params.value, ctx) };
    }
    case "log":
      return { message: resolve(node.params.message, ctx) };
    case "manualTrigger":
    case "webhookTrigger":
      return ctx.$json;
    default:
      // `if` / `merge` and anything a newer editor emits that this runner does not know.
      return ctx.$prev ?? ctx.$json;
  }
}

/**
 * What to do next, given the definition and the steps recorded so far. Pure, and the whole
 * resume rule: the next index is the step count, so re-entering after a workstation posts a
 * result picks up exactly where the run suspended.
 */
export type NextAction =
  | { kind: "done" }
  | { kind: "wait" }
  | { kind: "agent"; node: WorkflowDefinitionNode; index: number }
  | { kind: "inline"; node: WorkflowDefinitionNode; index: number };

export function nextAction(
  nodes: WorkflowDefinitionNode[],
  steps: { status: string }[],
): NextAction {
  // A step handed out and not yet answered. Re-entering must not run it twice.
  if (steps.some((step) => step.status === "running" || step.status === "queued")) return { kind: "wait" };
  const index = steps.length;
  if (index >= nodes.length) return { kind: "done" };
  const node = nodes[index]!;
  return { kind: node.type === "agent" ? "agent" : "inline", node, index };
}

async function finishRun(runId: string, status: "succeeded" | "failed", stepCount: number) {
  await db
    .update(automationRun)
    .set({ status, finishedAt: now(), stepCount })
    .where(eq(automationRun.id, runId));
}

/** Marks a step and its run failed. The run stops where it is; nothing downstream runs. */
export async function failRun(runId: string, stepId: string | null, message: string): Promise<void> {
  if (stepId) {
    await db
      .update(automationRunStep)
      .set({ status: "failed", error: message.slice(0, 2000), finishedAt: now() })
      .where(eq(automationRunStep.id, stepId));
  }
  const steps = await db.select({ id: automationRunStep.id }).from(automationRunStep).where(eq(automationRunStep.runId, runId));
  await finishRun(runId, "failed", steps.length);
}

export type AdvanceResult = { status: "succeeded" | "failed" | "running"; suspended: boolean };

/**
 * Runs from wherever the recorded steps left off. Returns `suspended` when it has handed
 * work to a workstation and is waiting to be called again.
 */
export async function advance(runId: string): Promise<AdvanceResult> {
  const run = (await db.select().from(automationRun).where(eq(automationRun.id, runId)).limit(1))[0];
  if (!run) throw new Error(`run not found: ${runId}`);
  if (run.status !== "running" && run.status !== "queued") {
    return { status: run.status === "succeeded" ? "succeeded" : "failed", suspended: false };
  }

  const version = (
    await db
      .select({ definition: automationVersion.definition })
      .from(automationVersion)
      .where(eq(automationVersion.id, run.automationVersionId))
      .limit(1)
  )[0];
  const definition = (version?.definition ?? { version: 1, nodes: [], connections: [] }) as WorkflowDefinition;
  const nodes = Array.isArray(definition.nodes) ? definition.nodes : [];

  const steps = await db
    .select()
    .from(automationRunStep)
    .where(eq(automationRunStep.runId, runId))
    .orderBy(asc(automationRunStep.index));

  if (nextAction(nodes, steps).kind === "wait") return { status: "running", suspended: true };

  const ctx: Context = {
    $json: run.input,
    $prev: steps.at(-1)?.output ?? run.input,
    $node: Object.fromEntries(
      steps.map((step) => [String((step.input as { nodeId?: string } | null)?.nodeId ?? step.index), step.output]),
    ),
  };

  for (let index = steps.length; index < nodes.length; index++) {
    const node = nodes[index]!;
    const stepId = `ars_${nanoid(16)}`;

    if (node.type === "agent") {
      const payload = {
        stepId,
        nodeId: node.id,
        prompt: asText(resolve(node.params.prompt, ctx)),
        cwd: asText(node.params.cwd),
        model: asText(node.params.model),
        timeoutSec: Number(node.params.timeoutSec ?? 900),
      };
      await db.insert(automationRunStep).values({
        id: stepId,
        runId,
        index,
        status: "running",
        type: "agent",
        name: node.name,
        input: payload,
        startedAt: now(),
        createdAt: now(),
      });
      await db.insert(automationJob).values({
        id: `ajb_${nanoid(16)}`,
        runId,
        stepIndex: index,
        status: "pending",
        payload,
        availableAt: now(),
        createdAt: now(),
      });
      // The whole point: hand off and return, so the request that triggered this does not
      // sit waiting on a machine that may be asleep.
      return { status: "running", suspended: true };
    }

    let output: unknown;
    try {
      output = executeInline(node, ctx);
    } catch (error) {
      await db.insert(automationRunStep).values({
        id: stepId,
        runId,
        index,
        status: "failed",
        type: node.type,
        name: node.name,
        input: { nodeId: node.id, params: node.params },
        error: error instanceof Error ? error.message : String(error),
        startedAt: now(),
        finishedAt: now(),
        createdAt: now(),
      });
      await finishRun(runId, "failed", index + 1);
      return { status: "failed", suspended: false };
    }

    await db.insert(automationRunStep).values({
      id: stepId,
      runId,
      index,
      status: "succeeded",
      type: node.type,
      name: node.name,
      input: { nodeId: node.id, params: node.params },
      output,
      startedAt: now(),
      finishedAt: now(),
      createdAt: now(),
    });
    ctx.$prev = output;
    ctx.$node[node.id] = output;
  }

  await finishRun(runId, "succeeded", nodes.length);
  return { status: "succeeded", suspended: false };
}

export type StartRunInput = {
  automationId: string;
  automationVersionId: string;
  workstationId: string;
  triggerId: string | null;
  input: unknown;
};

/** Creates the run row, then runs until it finishes or suspends on an agent step. */
export async function startRun(args: StartRunInput): Promise<{ runId: string } & AdvanceResult> {
  const runId = `arn_${nanoid(16)}`;
  const at = now();
  await db.insert(automationRun).values({
    id: runId,
    automationId: args.automationId,
    automationVersionId: args.automationVersionId,
    workstationId: args.workstationId,
    status: "running",
    triggerId: args.triggerId,
    input: args.input,
    startedAt: at,
    createdAt: at,
  });
  return { runId, ...(await advance(runId)) };
}
