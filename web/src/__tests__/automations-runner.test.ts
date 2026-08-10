import { executeInline, nextAction, resolve, type Context } from "~/server/automations/runner";
import type { WorkflowDefinitionNode } from "~/lib/automations/definition";

const node = (
  id: string,
  type: WorkflowDefinitionNode["type"],
  params: Record<string, unknown> = {},
): WorkflowDefinitionNode => ({ id, type, name: type, params });

const ctx = (over: Partial<Context> = {}): Context => ({
  $json: { branch: "main", n: 2 },
  $prev: { text: "the agent said this" },
  $node: {},
  ...over,
});

describe("resolve", () => {
  it("interpolates into a surrounding string", () => {
    expect(resolve("fix the test on {{$json.branch}}", ctx())).toBe("fix the test on main");
  });

  it("returns the value itself when the whole string is one expression", () => {
    // So `{{$json}}` can carry an object downstream rather than "[object Object]".
    expect(resolve("{{$json}}", ctx())).toEqual({ branch: "main", n: 2 });
  });

  it("reaches an agent's output through $prev and $node", () => {
    expect(resolve("{{$prev.text}}", ctx())).toBe("the agent said this");
    expect(resolve("{{$node.a1.text}}", ctx({ $node: { a1: { text: "hi" } } }))).toBe("hi");
  });

  it("renders a missing path as empty rather than the word undefined", () => {
    expect(resolve("[{{$json.nope}}]", ctx())).toBe("[]");
  });

  it("passes non-strings through untouched", () => {
    expect(resolve(42, ctx())).toBe(42);
    expect(resolve(null, ctx())).toBeNull();
  });
});

describe("nextAction", () => {
  const nodes = [node("t1", "webhookTrigger"), node("a1", "agent"), node("l1", "log")];

  it("starts at the first node", () => {
    expect(nextAction(nodes, [])).toMatchObject({ kind: "inline", index: 0 });
  });

  it("suspends on the agent node", () => {
    expect(nextAction(nodes, [{ status: "succeeded" }])).toMatchObject({ kind: "agent", index: 1 });
  });

  it("waits while a step is still out with a workstation", () => {
    // The resume guard: re-entering here must not hand the same job out twice.
    expect(nextAction(nodes, [{ status: "succeeded" }, { status: "running" }])).toEqual({ kind: "wait" });
  });

  it("resumes at the node after the agent once its result is in", () => {
    expect(nextAction(nodes, [{ status: "succeeded" }, { status: "succeeded" }])).toMatchObject({
      kind: "inline",
      index: 2,
    });
  });

  it("is done when every node has a step", () => {
    expect(nextAction(nodes, [{ status: "succeeded" }, { status: "succeeded" }, { status: "succeeded" }])).toEqual({
      kind: "done",
    });
  });
});

describe("executeInline", () => {
  it("resolves a log message from the previous step, agent output included", () => {
    expect(executeInline(node("l1", "log", { message: "agent: {{$prev.text}}" }), ctx())).toEqual({
      message: "agent: the agent said this",
    });
  });

  it("sets a field under a resolved name", () => {
    expect(executeInline(node("s1", "set", { field: "{{$json.branch}}", value: 1 }), ctx())).toEqual({ main: 1 });
  });

  it("passes the trigger payload through", () => {
    expect(executeInline(node("t1", "webhookTrigger"), ctx())).toEqual({ branch: "main", n: 2 });
  });

  it("passes through on if and merge, which do not branch yet", () => {
    expect(executeInline(node("i1", "if"), ctx())).toEqual({ text: "the agent said this" });
  });
});
