import type { McpServer } from "@modelcontextprotocol/server";

import { fail, ok } from "~/server/mcp/result";
import { satisfies } from "~/server/mcp/scopes";
import { MODULES } from "~/server/mcp/tools";
import type { McpContext, McpTool } from "~/server/mcp/types";

/** Every tool from every module, flattened once. */
export const ALL_TOOLS: McpTool[] = MODULES.flatMap((module) => module.tools);

/**
 * The tools a token may use.
 *
 * Filtering rather than refusing at call time is the point: a read-only token does not see
 * `automation_run` in `tools/list` at all, so a model never spends a turn discovering it
 * cannot use it, and a prompt injection cannot name a tool that was never offered.
 */
export const toolsFor = (scopes: readonly string[]): McpTool[] =>
  ALL_TOOLS.filter((tool) => satisfies(scopes, tool.scope));

/**
 * Registers the caller's tools on a per-request `McpServer`.
 *
 * The single try/catch is why handlers can just throw: an unhandled rejection here would
 * surface as a protocol error the model never reads, while `isError` content comes back as
 * something it can act on.
 */
export function registerTools(server: McpServer, ctx: McpContext): void {
  for (const tool of toolsFor(ctx.scopes)) {
    server.registerTool(
      tool.name,
      { title: tool.title, description: tool.description, inputSchema: tool.input },
      async (args: unknown) => {
        try {
          return ok(await tool.handler(args, ctx));
        } catch (error) {
          return fail(error);
        }
      },
    );
  }
}
