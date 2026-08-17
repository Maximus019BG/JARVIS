import type { z } from "zod";

import type { device } from "~/server/db/schemas/device";
import type { McpArea, McpScope } from "~/server/mcp/scopes";

/**
 * Who is calling, resolved once per request from the bearer token.
 *
 * A token belongs to exactly one workstation, so tools take no `workstationId` argument —
 * they read `ctx.workstationId`. That removes a whole class of model mistakes and makes
 * cross-tenant access unexpressible rather than merely checked.
 */
export type McpContext = {
  device: typeof device.$inferSelect;
  deviceId: string;
  workstationId: string;
  userId: string;
  scopes: readonly string[];
};

/**
 * One tool.
 *
 * Handlers return plain data and throw on failure — `registry.ts` wraps both into MCP
 * content blocks, so a tool file contains no protocol code at all. Adding a tool is
 * appending one of these to a module's array.
 */
export type McpTool<S extends z.ZodType = z.ZodType> = {
  /** snake_case, namespaced by subject: `automation_run`, `blueprint_view`. */
  name: string;
  title: string;
  /** Written for a model: say what it returns and what it costs, not what it "manages". */
  description: string;
  /** The single gate. Checked before the tool is listed, so an unscoped token never sees it. */
  scope: McpScope;
  input: S;
  handler: (args: z.infer<S>, ctx: McpContext) => Promise<unknown>;
};

export type McpModule = {
  area: McpArea;
  tools: McpTool[];
};

/**
 * Helper that keeps `input` and `handler` inferring together.
 *
 * Without it, `McpTool[]` widens `S` to `z.ZodType` and every handler's `args` becomes
 * `unknown`. With it, each tool is written inline and stays typed.
 */
export const tool = <S extends z.ZodType>(definition: McpTool<S>): McpTool => definition;
