import { desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { Edge, Node } from "reactflow";
import { z } from "zod";
import { toJSONSchema } from "zod";

import { editorGraphToDefinition } from "~/lib/automations/definition";
import { nodeRegistry, nodeRegistryList, type AutomationNodeType } from "~/lib/automations/node-registry";
import type { EditorNodeData } from "~/components/automations/node-config-panel";
import { db } from "~/server/db";
import { automation } from "~/server/db/schemas/automation";
import { automationVersion } from "~/server/db/schemas/automation-version";
import { publishAutomation, type EditorGraph } from "~/server/automations/publish";
import { saveAutomationGraph } from "~/server/automations/save";
import { toolError } from "~/server/mcp/result";
import { requireAutomation } from "~/server/mcp/tools/shared";
import type { McpModule } from "~/server/mcp/types";
import { tool } from "~/server/mcp/types";

/**
 * Authoring automations from an agent.
 *
 * The editor stores ReactFlow's own graph shape, which is full of rendering detail a model
 * has no business typing. These tools take a flat `{ id, type, name, params, position }` and
 * translate — so the model writes what a workflow *is*, and the editor still opens it.
 */

const nodeTypes = Object.keys(nodeRegistry) as [AutomationNodeType, ...AutomationNodeType[]];

const simpleNode = z.object({
  id: z.string().min(1).describe("Stable id you choose; connections reference it."),
  type: z.enum(nodeTypes),
  name: z.string().min(1).describe("Label shown in the editor."),
  params: z.record(z.string(), z.unknown()).describe("Per-type; see automation_node_types."),
  x: z.number().default(0),
  y: z.number().default(0),
});

const simpleConnection = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  fromHandle: z.string().nullable().default(null).describe("Only for multi-output nodes such as `if`."),
});

const simpleGraph = z.object({
  nodes: z.array(simpleNode),
  connections: z.array(simpleConnection).default([]),
});

type SimpleGraph = z.infer<typeof simpleGraph>;

/** Flat graph → what the editor and the compiler both expect. */
function toEditorGraph(graph: SimpleGraph): EditorGraph {
  const nodes: Node<EditorNodeData>[] = graph.nodes.map((node) => ({
    id: node.id,
    type: "automationNode",
    position: { x: node.x, y: node.y },
    data: { nodeType: node.type, label: node.name, params: node.params },
  }));

  const edges: Edge[] = graph.connections.map((connection, index) => ({
    id: `e${index}_${connection.from}_${connection.to}`,
    source: connection.from,
    target: connection.to,
    sourceHandle: connection.fromHandle,
  }));

  return { nodes, edges };
}

/** And back, so `automation_get_graph` hands the model the same shape it writes. */
function toSimpleGraph(graph: EditorGraph | null): SimpleGraph {
  if (!graph) return { nodes: [], connections: [] };
  return {
    nodes: (graph.nodes ?? []).map((node) => ({
      id: node.id,
      type: node.data.nodeType,
      name: node.data.label,
      params: node.data.params ?? {},
      x: node.position?.x ?? 0,
      y: node.position?.y ?? 0,
    })),
    connections: (graph.edges ?? []).map((edge) => ({
      from: edge.source,
      to: edge.target,
      fromHandle: edge.sourceHandle ?? null,
    })),
  };
}

const validate = (graph: SimpleGraph) => {
  const { definition, errors } = editorGraphToDefinition(toEditorGraph(graph));
  return { valid: errors.length === 0, errors, executionOrder: definition.nodes.map((node) => node.name) };
};

const automationId = z.string().min(1).describe("Automation id, from automation_list.");

export const authoringModule: McpModule = {
  area: "automations",
  tools: [
    tool({
      name: "automation_node_types",
      title: "List node types",
      description:
        "Every node type you can put in a graph, with a JSON Schema for its params. Read this before writing a graph — param names are not guessable, and automation_save_graph rejects a node whose params do not match.",
      scope: "automations:read",
      input: z.object({}),
      handler: async () =>
        nodeRegistryList.map((item) => ({
          type: item.type,
          label: item.label,
          category: item.category,
          defaultParams: item.defaultParams,
          paramsSchema: toJSONSchema(item.paramsSchema, { io: "input" }),
        })),
    }),

    tool({
      name: "automation_get_graph",
      title: "Get an automation's graph",
      description:
        "The latest saved graph in the flat form automation_save_graph accepts. Use this to edit an existing automation rather than rewriting it from scratch.",
      scope: "automations:read",
      input: z.object({ automationId }),
      handler: async (args, ctx) => {
        const found = await requireAutomation(ctx, args.automationId);
        const latest = (
          await db
            .select({ version: automationVersion.version, editorGraph: automationVersion.editorGraph })
            .from(automationVersion)
            .where(eq(automationVersion.automationId, found.id))
            // Newest, not oldest: `automation_create` writes an empty version 1, so an
            // ascending sort hands back a blank graph for every automation ever edited.
            .orderBy(desc(automationVersion.version))
            .limit(1)
        )[0];
        return {
          version: latest?.version ?? null,
          graph: toSimpleGraph((latest?.editorGraph as EditorGraph | null) ?? null),
        };
      },
    }),

    tool({
      name: "automation_validate",
      title: "Validate a graph",
      description:
        "Checks a graph without saving it: node params against their schemas, loops, and nodes nothing connects to. Cheap — use it to iterate before automation_save_graph. Returns the order the runner would execute nodes in.",
      scope: "automations:read",
      input: z.object({ graph: simpleGraph }),
      handler: async (args) => validate(args.graph),
    }),

    tool({
      name: "automation_create",
      title: "Create an automation",
      description:
        "Creates an empty draft automation and returns its id. Follow with automation_save_graph and automation_publish — a draft never runs.",
      scope: "automations:write",
      input: z.object({ name: z.string().trim().min(1).max(120) }),
      handler: async (args, ctx) => {
        const id = `atm_${nanoid(16)}`;
        await saveAutomationGraph({
          automationId: id,
          workstationId: ctx.workstationId,
          userId: ctx.userId,
          name: args.name,
          graph: null,
        });
        return { id, name: args.name, status: "draft" };
      },
    }),

    tool({
      name: "automation_save_graph",
      title: "Save a graph",
      description:
        "Replaces the automation's graph with this one and saves it as a new draft version. Validates first and refuses to save an invalid graph. Saving does not change what runs — call automation_publish for that.",
      scope: "automations:write",
      input: z.object({
        automationId,
        graph: simpleGraph,
        name: z.string().trim().min(1).max(120).optional().describe("Rename while saving."),
      }),
      handler: async (args, ctx) => {
        const found = await requireAutomation(ctx, args.automationId);

        // Refusing here rather than at publish is the point of the tool: a saved-but-broken
        // graph is a draft the editor will open and a human will have to fix by hand.
        const checked = validate(args.graph);
        if (!checked.valid) toolError(`Invalid graph:\n- ${checked.errors.join("\n- ")}`);

        const { version } = await saveAutomationGraph({
          automationId: found.id,
          workstationId: ctx.workstationId,
          userId: ctx.userId,
          name: args.name ?? found.name,
          graph: toEditorGraph(args.graph),
        });

        return { id: found.id, version, executionOrder: checked.executionOrder };
      },
    }),

    tool({
      name: "automation_publish",
      title: "Publish an automation",
      description:
        "Compiles the latest saved graph and makes it the version triggers and automation_run execute. Also sets the automation active.",
      scope: "automations:write",
      input: z.object({ automationId }),
      handler: async (args, ctx) => {
        const found = await requireAutomation(ctx, args.automationId);
        const result = await publishAutomation(found, ctx.userId);
        if (!result.ok) toolError(`Cannot publish:\n- ${result.errors.join("\n- ")}`);
        return { id: found.id, publishedVersion: result.publishedVersion, status: "active" };
      },
    }),

    tool({
      name: "automation_delete",
      title: "Delete an automation",
      description:
        "Permanently deletes a draft automation. Refuses if it has ever been published — pause it with automation_set_status instead, so its run history stays readable.",
      scope: "automations:write",
      input: z.object({ automationId }),
      handler: async (args, ctx) => {
        const found = await requireAutomation(ctx, args.automationId);
        // A published automation has runs pointing at its versions, and history that stops
        // explaining itself is worse than a paused row nobody looks at.
        if (found.publishedVersion !== null) {
          toolError(
            `"${found.name}" has been published and may have run history. Use automation_set_status with "archived" instead.`,
          );
        }
        await db.delete(automationVersion).where(eq(automationVersion.automationId, found.id));
        await db.delete(automation).where(eq(automation.id, found.id));
        return { deleted: found.id };
      },
    }),
  ],
};
