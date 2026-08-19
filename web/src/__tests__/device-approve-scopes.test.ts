import {
  ALL_SCOPES,
  defaultScopesForMode,
  isMcpScope,
  MCP_AREAS,
  satisfies,
} from "~/server/mcp/scopes";

/**
 * Approval used to leave `scopes` empty, which made every freshly paired device silently
 * unable to use MCP at all. These pin the rule that replaced that: whatever blueprint
 * permission the approver picked is the permission the MCP token gets.
 */
describe("defaultScopesForMode", () => {
  it("gives a read-only device no write anywhere", () => {
    const scopes = defaultScopesForMode("read");
    expect(scopes.some((scope) => scope.endsWith(":write"))).toBe(false);
    expect(scopes).toHaveLength(MCP_AREAS.length);
  });

  it("gives a read-write device the full vocabulary", () => {
    expect(new Set(defaultScopesForMode("write"))).toEqual(new Set(ALL_SCOPES));
  });

  it("lets both modes read every area", () => {
    for (const mode of ["read", "write"] as const) {
      const held = defaultScopesForMode(mode);
      for (const area of MCP_AREAS) expect(satisfies(held, `${area}:read`)).toBe(true);
    }
  });

  it("only ever emits real scopes", () => {
    for (const mode of ["read", "write"] as const) {
      for (const scope of defaultScopesForMode(mode)) expect(isMcpScope(scope)).toBe(true);
    }
  });

  it("returns a fresh array, so a caller cannot mutate the shared constant", () => {
    // `scopes` goes straight into a DB insert; handing out ALL_SCOPES itself would let one
    // request's edit change what every later approval grants.
    const first = defaultScopesForMode("write");
    first.pop();
    expect(defaultScopesForMode("write")).toHaveLength(ALL_SCOPES.length);
  });
});
