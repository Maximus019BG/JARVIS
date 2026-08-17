"use client";

import { Plug } from "lucide-react";
import { useState } from "react";
import { McpTokensManager } from "~/components/account/mcp-tokens-manager";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "~/components/ui/dialog";

/**
 * The same manager the account dialog's MCP tab shows, reachable from the settings page too.
 *
 * Two doors to one room on purpose: you go to the account dialog when you are thinking about
 * your own credentials, and to settings when you are thinking about this workstation. Both read
 * the same React Query key, so a change made through one is visible in the other without a
 * reload.
 */
export function McpTokensDialog() {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Plug className="size-4" />
          Manage tokens
        </Button>
      </DialogTrigger>
      <DialogContent className="flex h-full max-h-[40rem] flex-col overflow-auto sm:max-w-[calc(100%-2rem)] md:max-w-2xl">
        <DialogHeader>
          <DialogTitle>MCP tokens</DialogTitle>
          <DialogDescription>
            Credentials that let an MCP client reach a workstation. Each carries its own
            read/write rights per area.
          </DialogDescription>
        </DialogHeader>
        <McpTokensManager />
      </DialogContent>
    </Dialog>
  );
}
