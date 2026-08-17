import type { Edge, Node } from "reactflow";
import { editorGraphToDefinition, topoSort } from "~/lib/automations/definition";
import type { EditorNodeData } from "~/components/automations/node-config-panel";

/**
 * What `automation_save_graph` relies on: a graph an agent writes must compile, and one
 * that would never finish must be refused rather than saved.
 *
 * Written against `editorGraphToDefinition` directly — the MCP tool is a translation layer
 * over it, and it is the compiler that decides what is valid.
 */

const node = (
  id: string,
  nodeType: EditorNodeData["nodeType"],
  params: Record<string, unknown>,
): Node<EditorNodeData> => ({
  id,
  type: "automationNode",
  position: { x: 0, y: 0 },
  data: { nodeType, label: id, params } as EditorNodeData,
});

const edge = (from: string, to: string): Edge => ({ id: `${from}-${to}`, source: from, target: to });

const agentParams = { prompt: "run the tests", cwd: "", model: "", timeoutSec: 900 };

describe("editorGraphToDefinition", () => {
  it("compiles a trigger → agent → log graph", () => {
    const { definition, errors } = editorGraphToDefinition({
      nodes: [
        node("t", "manualTrigger", {}),
        node("a", "agent", agentParams),
        node("l", "log", { message: "{{$prev.text}}" }),
      ],
      edges: [edge("t", "a"), edge("a", "l")],
    });

    expect(errors).toEqual([]);
    expect(definition.nodes.map((n) => n.id)).toEqual(["t", "a", "l"]);
  });

  it("puts nodes in execution order regardless of how they were drawn", () => {
    // The runner walks `definition.nodes` by index, so this sort *is* the scheduling.
    const { definition, errors } = editorGraphToDefinition({
      nodes: [
        node("l", "log", { message: "done" }),
        node("a", "agent", agentParams),
        node("t", "manualTrigger", {}),
      ],
      edges: [edge("t", "a"), edge("a", "l")],
    });

    expect(errors).toEqual([]);
    expect(definition.nodes.map((n) => n.id)).toEqual(["t", "a", "l"]);
  });

  it("rejects params that do not match the node's schema", () => {
    const { errors } = editorGraphToDefinition({
      nodes: [node("t", "manualTrigger", {}), node("a", "agent", { prompt: "" })],
      edges: [edge("t", "a")],
    });
    expect(errors.length).toBeGreaterThan(0);
  });

  it("rejects an unknown node type", () => {
    const { errors } = editorGraphToDefinition({
      nodes: [node("x", "teleport" as EditorNodeData["nodeType"], {})],
      edges: [],
    });
    expect(errors.join(" ")).toContain("Unknown node type");
  });

  it("refuses a graph that would never finish", () => {
    const { errors } = editorGraphToDefinition({
      nodes: [node("a", "log", { message: "a" }), node("b", "log", { message: "b" })],
      edges: [edge("a", "b"), edge("b", "a")],
    });
    expect(errors.join(" ")).toContain("loop");
  });

  it("refuses a node nothing connects to", () => {
    const { errors } = editorGraphToDefinition({
      nodes: [
        node("t", "manualTrigger", {}),
        node("a", "agent", agentParams),
        node("orphan", "log", { message: "never runs" }),
      ],
      edges: [edge("t", "a")],
    });
    expect(errors.join(" ")).toContain("not connected");
  });

  it("allows a lone node, which is what Run now drives", () => {
    const { errors } = editorGraphToDefinition({
      nodes: [node("a", "agent", agentParams)],
      edges: [],
    });
    expect(errors).toEqual([]);
  });
});

describe("topoSort", () => {
  const plain = (id: string) => ({ id, type: "log" as const, name: id, params: {} });

  it("is deterministic for a graph with no constraints", () => {
    const nodes = [plain("c"), plain("a"), plain("b")];
    // Ties break on original index, so the same graph always compiles to the same array —
    // a definition that reshuffled between publishes would make runs impossible to compare.
    expect(topoSort(nodes, []).ordered.map((n) => n.id)).toEqual(["c", "a", "b"]);
  });

  it("reports every node it could not order", () => {
    const nodes = [plain("a"), plain("b")];
    const { cycle } = topoSort(nodes, [
      { from: "a", to: "b", fromHandle: null },
      { from: "b", to: "a", fromHandle: null },
    ]);
    expect(cycle.sort()).toEqual(["a", "b"]);
  });

  it("ignores an edge pointing at a node that is not in the graph", () => {
    const nodes = [plain("a")];
    const { ordered, cycle } = topoSort(nodes, [{ from: "a", to: "ghost", fromHandle: null }]);
    expect(ordered.map((n) => n.id)).toEqual(["a"]);
    expect(cycle).toEqual([]);
  });
});
