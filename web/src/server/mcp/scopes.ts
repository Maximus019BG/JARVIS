/**
 * What an MCP token is allowed to do.
 *
 * One area per tool module, and one string per area/verb pair. This file is the whole
 * vocabulary: a new area is one entry in `MCP_AREAS`, and the token UI's checkbox matrix,
 * the `tools/list` filter and the migration default all follow from it.
 */

export const MCP_AREAS = [
  "workstations",
  "blueprints",
  "automations",
  "sessions",
  "approvals",
  "devices",
  "usage",
] as const;

export type McpArea = (typeof MCP_AREAS)[number];
export type McpScope = `${McpArea}:read` | `${McpArea}:write`;

export const ALL_SCOPES: McpScope[] = MCP_AREAS.flatMap(
  (area) => [`${area}:read`, `${area}:write`] as McpScope[],
);

const KNOWN = new Set<string>(ALL_SCOPES);

export const isMcpScope = (value: string): value is McpScope => KNOWN.has(value);

/**
 * Whether a token holding `held` may do something needing `need`.
 *
 * `write` implies `read` — a token that can publish an automation can obviously list one,
 * and making the UI tick both boxes to express that would be a trap. Unknown strings in
 * `held` never satisfy anything, so a scope removed from `MCP_AREAS` stops granting access
 * without needing a data migration first.
 */
export function satisfies(held: readonly string[], need: McpScope): boolean {
  if (!KNOWN.has(need)) return false;
  if (held.includes(need)) return true;
  return need.endsWith(":read") && held.includes(`${need.slice(0, -":read".length)}:write`);
}

/**
 * What a device gets over MCP when nobody said otherwise.
 *
 * Approval used to leave `scopes` empty, which meant every freshly paired device was
 * MCP-dead until someone went and ticked boxes for it — a state nothing in the UI
 * explained. Defaulting from the blueprint permission the approver already chose keeps
 * the two answers consistent: "read only" grants no `:write` anywhere.
 *
 * Pure, and next to `satisfies` rather than in the route, so the rule is testable without
 * a database — the same reason `grantsToReadable` lives beside its callers in device-auth.
 */
export function defaultScopesForMode(mode: "read" | "write"): McpScope[] {
  return mode === "write" ? [...ALL_SCOPES] : MCP_AREAS.map((area) => `${area}:read` as McpScope);
}
