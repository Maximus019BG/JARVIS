import type { Edge, Node } from "reactflow";
import { type z } from "zod";

import {
  getNodeRegistryItem,
  nodeRegistry,
  type AutomationNodeType,
} from "~/lib/automations/node-registry";
import type { EditorNodeData } from "~/components/automations/node-config-panel";

export type WorkflowDefinitionNode = {
  id: string;
  type: AutomationNodeType;
  name: string;
  params: Record<string, unknown>;
};

/**
 * One edge, as the runner sees it.
 *
 * `fromHandle` is what makes branching possible: an `if` node has two source handles, and
 * without carrying which one an edge left from, "the false branch" is not expressible in
 * the compiled artifact. Null for every node with a single output.
 */
export type WorkflowConnection = {
  from: string;
  to: string;
  fromHandle: string | null;
};

export type WorkflowDefinition = {
  version: 1;
  nodes: WorkflowDefinitionNode[];
  connections: WorkflowConnection[];
  meta?: {
    generatedAt: string;
  };
};

/**
 * Kahn's algorithm: nodes in an order where every node comes after everything feeding it.
 *
 * This is the whole reason connections mean anything at runtime. The runner walks
 * `definition.nodes` by index, so sorting here — once, at publish — is what turns a drawn
 * graph into an execution order, with no scheduling logic in the runner at all.
 *
 * Ties break on the node's original index so the same graph always compiles to the same
 * array; a definition that reshuffles between publishes would make runs impossible to
 * compare.
 *
 * `cycle` holds whatever could not be ordered. It is non-empty exactly when the graph has a
 * loop, and the caller turns that into a publish error rather than an infinite run.
 */
export function topoSort(
  nodes: WorkflowDefinitionNode[],
  connections: WorkflowConnection[],
): { ordered: WorkflowDefinitionNode[]; cycle: string[] } {
  const byId = new Map(nodes.map((n, index) => [n.id, { node: n, index }]));
  const indegree = new Map(nodes.map((n) => [n.id, 0]));
  const outgoing = new Map<string, string[]>();

  for (const edge of connections) {
    // An edge pointing at a node that is not in the graph is not an ordering constraint.
    if (!byId.has(edge.from) || !byId.has(edge.to)) continue;
    indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1);
    outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge.to]);
  }

  const ready = nodes.filter((n) => indegree.get(n.id) === 0).map((n) => n.id);
  const ordered: WorkflowDefinitionNode[] = [];

  while (ready.length > 0) {
    // Lowest original index first, so the output is deterministic.
    ready.sort((a, b) => (byId.get(a)?.index ?? 0) - (byId.get(b)?.index ?? 0));
    const id = ready.shift()!;
    ordered.push(byId.get(id)!.node);
    for (const next of outgoing.get(id) ?? []) {
      const remaining = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, remaining);
      if (remaining === 0) ready.push(next);
    }
  }

  const orderedIds = new Set(ordered.map((n) => n.id));
  return { ordered, cycle: nodes.filter((n) => !orderedIds.has(n.id)).map((n) => n.id) };
}

const isTrigger = (type: AutomationNodeType) =>
  (nodeRegistry as Record<string, { category: string }>)[type]?.category === "triggers";

export function editorGraphToDefinition(input: {
  nodes: Node<EditorNodeData>[];
  edges: Edge[];
}): { definition: WorkflowDefinition; errors: string[] } {
  const errors: string[] = [];

  const rawNodes: WorkflowDefinitionNode[] = (input.nodes ?? []).map((n) => {
    const data = n.data;
    return {
      id: n.id,
      type: data.nodeType,
      name: data.label,
      params: data.params ?? {},
    };
  });

  const connections: WorkflowConnection[] = (input.edges ?? []).map((e) => ({
    from: e.source,
    to: e.target,
    fromHandle: e.sourceHandle ?? null,
  }));

  // Validate node params against registry schemas.
  for (const n of rawNodes) {
    const registryItem = (nodeRegistry as any)[n.type]
      ? getNodeRegistryItem(n.type)
      : null;
    if (!registryItem) {
      errors.push(`Unknown node type: ${n.type}`);
      continue;
    }

    const res = (registryItem.paramsSchema as z.ZodTypeAny).safeParse(n.params);
    if (!res.success) {
      errors.push(
        `${n.name || n.id} (${n.type}): ${res.error.issues
          .map((i) => `${i.path.join(".") || "(root)"} ${i.message.toLowerCase()}`)
          .join(", ")}`,
      );
    }
  }

  const { ordered, cycle } = topoSort(rawNodes, connections);

  if (cycle.length > 0) {
    const named = cycle.map((id) => rawNodes.find((n) => n.id === id)?.name ?? id);
    errors.push(
      `These nodes form a loop and would never finish: ${named.join(" → ")}. Remove a connection.`,
    );
  }

  // A node nothing connects to never runs, because the runner starts from the trigger and
  // follows the graph. Only checked on a graph that has more than one node: a lone `agent`
  // driven by "Run now" is a legitimate automation and predates connections meaning anything.
  if (rawNodes.length > 1) {
    const hasIncoming = new Set(connections.map((c) => c.to));
    for (const n of rawNodes) {
      if (isTrigger(n.type) || hasIncoming.has(n.id)) continue;
      errors.push(`${n.name || n.id} (${n.type}) is not connected to anything and would never run.`);
    }
  }

  return {
    definition: {
      version: 1,
      // Ordered when it can be; on a cycle the publish is rejected anyway, and returning the
      // partial order would silently drop the looping nodes from the artifact.
      nodes: cycle.length > 0 ? rawNodes : ordered,
      connections,
      meta: { generatedAt: new Date().toISOString() },
    },
    errors,
  };
}
