import { ALL_SCOPES, isMcpScope, MCP_AREAS, satisfies } from "~/server/mcp/scopes";

describe("satisfies", () => {
  it("grants what the token holds", () => {
    expect(satisfies(["automations:read"], "automations:read")).toBe(true);
    expect(satisfies(["automations:write"], "automations:write")).toBe(true);
  });

  it("lets write imply read", () => {
    expect(satisfies(["blueprints:write"], "blueprints:read")).toBe(true);
  });

  it("never lets read imply write", () => {
    expect(satisfies(["blueprints:read"], "blueprints:write")).toBe(false);
  });

  it("does not leak across areas", () => {
    expect(satisfies(["blueprints:write"], "automations:read")).toBe(false);
  });

  it("denies everything on an empty token", () => {
    for (const scope of ALL_SCOPES) expect(satisfies([], scope)).toBe(false);
  });

  it("ignores strings that are not scopes", () => {
    // A wildcard is the shape somebody reaches for first; it must not work.
    expect(satisfies(["*"], "automations:write")).toBe(false);
    expect(satisfies(["automations"], "automations:read")).toBe(false);
    expect(satisfies(["automations:admin"], "automations:read")).toBe(false);
  });
});

describe("the vocabulary", () => {
  it("has a read and a write for every area", () => {
    expect(ALL_SCOPES).toHaveLength(MCP_AREAS.length * 2);
    for (const area of MCP_AREAS) {
      expect(isMcpScope(`${area}:read`)).toBe(true);
      expect(isMcpScope(`${area}:write`)).toBe(true);
    }
  });

  it("rejects anything else", () => {
    expect(isMcpScope("blueprints:delete")).toBe(false);
    expect(isMcpScope("secrets:read")).toBe(false);
  });
});
