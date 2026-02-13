import type { Edge, Node } from "reactflow";
import { z } from "zod";

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

export type WorkflowDefinition = {
  version: 1;
  nodes: WorkflowDefinitionNode[];
  connections: Array<{ from: string; to: string }>;
  meta?: {
    generatedAt: string;
  };
};

export function editorGraphToDefinition(input: {
  nodes: Node<EditorNodeData>[];
  edges: Edge[];
}): { definition: WorkflowDefinition; errors: string[] } {
  const errors: string[] = [];

  const nodes: WorkflowDefinitionNode[] = input.nodes.map((n) => {
    const data = n.data as EditorNodeData;
    return {
      id: n.id,
      type: data.nodeType,
      name: data.label,
      params: data.params ?? {},
    };
  });

  const connections = input.edges.map((e) => ({ from: e.source, to: e.target }));

  // Validate node params against registry schemas.
  for (const n of nodes) {
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
        `Node ${n.id} (${n.type}) params invalid: ${res.error.issues
          .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
          .join(", ")}`,
      );
    }
  }

  return {
    definition: {
      version: 1,
      nodes,
      connections,
      meta: { generatedAt: new Date().toISOString() },
    },
    errors,
  };
}
