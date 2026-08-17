import { ALL_TOOLS, toolsFor } from "~/server/mcp/registry";
import { ALL_SCOPES, isMcpScope } from "~/server/mcp/scopes";

/**
 * The security property of the whole MCP server: a token only ever sees the tools its
 * scopes allow. Filtering at `tools/list` rather than refusing at call time is what stops a
 * model — or a prompt injection — from naming a tool that was never offered.
 */

const names = (scopes: string[]) => toolsFor(scopes).map((tool) => tool.name);

describe("toolsFor", () => {
  it("shows nothing to a token with no scopes", () => {
    expect(toolsFor([])).toHaveLength(0);
  });

  it("hides every write tool from a read-only token", () => {
    const readOnly = ALL_SCOPES.filter((scope) => scope.endsWith(":read"));
    for (const tool of toolsFor(readOnly)) {
      expect(tool.scope.endsWith(":read")).toBe(true);
    }
  });

  it("keeps a read-only automations token away from running and editing", () => {
    const listed = names(["automations:read"]);
    expect(listed).toContain("automation_list");
    expect(listed).toContain("automation_run_get");
    expect(listed).not.toContain("automation_run");
    expect(listed).not.toContain("automation_publish");
    expect(listed).not.toContain("automation_delete");
  });

  it("keeps a read-only blueprints token away from editing", () => {
    const listed = names(["blueprints:read"]);
    expect(listed).toContain("blueprint_get");
    expect(listed).not.toContain("blueprint_edit");
    expect(listed).not.toContain("blueprint_restore");
  });

  it("does not let one area's write scope reach another area", () => {
    expect(names(["blueprints:write"])).not.toContain("automation_run");
    expect(names(["automations:write"])).not.toContain("blueprint_edit");
  });

  it("shows everything to a fully scoped token", () => {
    expect(toolsFor(ALL_SCOPES)).toHaveLength(ALL_TOOLS.length);
  });
});

describe("the tool catalogue", () => {
  it("has unique names", () => {
    const seen = new Set(ALL_TOOLS.map((tool) => tool.name));
    expect(seen.size).toBe(ALL_TOOLS.length);
  });

  it("declares a real scope on every tool", () => {
    // A typo'd scope would be unsatisfiable, so the tool would silently never be listed —
    // a failure mode that looks exactly like "the feature isn't built yet".
    for (const tool of ALL_TOOLS) expect(isMcpScope(tool.scope)).toBe(true);
  });

  it("describes every tool for a model to read", () => {
    for (const tool of ALL_TOOLS) expect(tool.description.length).toBeGreaterThan(20);
  });
});
