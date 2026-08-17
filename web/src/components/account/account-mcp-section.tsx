"use client";

import { Plug } from "lucide-react";
import { McpTokensManager } from "~/components/account/mcp-tokens-manager";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";

/**
 * The MCP tab of the account dialog.
 *
 * Lives on the account dialog rather than a page because a token is a personal credential —
 * you reach for it from wherever you are, in the same place you'd change your password.
 *
 * Only the card shell is here. Everything the tab actually does lives in `McpTokensManager`,
 * which swaps its own views in place rather than opening anything: nesting a modal inside the
 * account modal would trap focus in the wrong layer, and keeping the manager overlay-free is
 * what lets the settings page reuse it inside a dialog of its own.
 */
export function AccountMcpSection() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Plug className="size-4" />
          MCP tokens
        </CardTitle>
        <CardDescription>
          Let an MCP client — Claude Code, Cursor, the JARVIS TUI — reach a workstation. Each
          token carries its own read/write rights per area; a tool it has no scope for is not even
          listed to it.
        </CardDescription>
      </CardHeader>

      <CardContent>
        <McpTokensManager />
      </CardContent>
    </Card>
  );
}
