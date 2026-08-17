import type { McpModule } from "~/server/mcp/types";
import { authoringModule } from "~/server/mcp/tools/authoring";
import { automationsModule } from "~/server/mcp/tools/automations";
import { blueprintsModule } from "~/server/mcp/tools/blueprints";
import { workstationsModule } from "~/server/mcp/tools/workstations";

/**
 * Every tool module the MCP server offers.
 *
 * Adding an area: write `tools/<area>.ts` exporting an `McpModule`, add it here, and add its
 * name to `MCP_AREAS` in `../scopes.ts`. Nothing else changes — the registry, the scope
 * filter, the token UI's checkbox matrix and the `tools/list` output all follow.
 */
export const MODULES: McpModule[] = [
  workstationsModule,
  automationsModule,
  authoringModule,
  blueprintsModule,
];
