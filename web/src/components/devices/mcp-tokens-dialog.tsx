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
      {/*
        Scroll on the inner pane rather than on DialogContent: DialogContent carries
        `bp-notch`/`bp-ticks`, whose outline and corner ticks are `absolute; inset: 0`
        pseudo-elements that scroll away with the content if it is the scroll container.
        No `h-full` either — this dialog is short with two tokens and tall while minting one,
        so it sizes to its content up to the cap.
      */}
      <DialogContent className="flex max-h-[min(40rem,85vh)] flex-col sm:max-w-[calc(100%-2rem)] md:max-w-2xl">
        <DialogHeader>
          <DialogTitle>MCP tokens</DialogTitle>
          <DialogDescription>
            Credentials that let an MCP client reach a workstation. Each carries its own
            read/write rights per area.
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <McpTokensManager />
        </div>
      </DialogContent>
    </Dialog>
  );
}
