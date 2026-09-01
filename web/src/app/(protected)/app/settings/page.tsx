"use client";

import React from "react";
import { useSearchParams } from "next/navigation";
import { ApprovalsCard } from "~/components/approvals/approvals-card";
import { DevicesCard } from "~/components/devices/devices-card";
import { McpTokensDialog } from "~/components/devices/mcp-tokens-dialog";
import { PendingRequestsCard } from "~/components/devices/pending-requests-card";
import { CreateWorkstationDialog } from "~/components/workstation/create-workstation-dialog";
import { Button } from "~/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "~/components/ui/empty";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import { useActiveWorkstation } from "~/lib/workstation-hooks";
import { useWorkstationBlueprints } from "~/lib/workstation-blueprints";

export default function SettingsPage() {
  const { data: activeWorkstation } = useActiveWorkstation();
  const searchParams = useSearchParams();
  // `/link?code=…` redirects here so the printed URL stays short enough to read off a
  // projected surface; the dialog opens itself with the code prefilled.
  const code = searchParams.get("code") ?? undefined;
  const blueprints = useWorkstationBlueprints(activeWorkstation?.id);

  /**
   * A device is always paired *into* a workstation, so with none there is nothing to
   * approve into. This used to render nothing at all, which left a new account facing a
   * blank page with no way forward — the one state where the way forward matters most.
   */
  if (!activeWorkstation) {
    return (
      <div className="container mx-auto p-6">
        <h1 className="mb-4 text-2xl font-semibold">Settings</h1>
        <Empty className="rounded-lg border">
          <EmptyHeader>
            <EmptyTitle>No workstation yet</EmptyTitle>
            <EmptyDescription>
              A workstation holds your blueprints and the devices allowed to reach them. Create one to
              start pairing machines.
            </EmptyDescription>
          </EmptyHeader>
          <CreateWorkstationDialog>
            <Button>Create a workstation</Button>
          </CreateWorkstationDialog>
        </Empty>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6">
      <h1 className="mb-4 text-2xl font-semibold">Settings</h1>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Workstation</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-muted-foreground text-sm">
              {activeWorkstation.name}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Security</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-muted-foreground text-sm">
              Manage access and permissions for this workstation
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Integrations</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-muted-foreground text-sm">
              Connect third party tools and automations
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="mt-4">
        <PendingRequestsCard
          workstationId={activeWorkstation.id}
          blueprints={blueprints}
        />
      </div>

      <div className="mt-4">
        <ApprovalsCard />
      </div>

      <div className="mt-4">
        <DevicesCard
          workstationId={activeWorkstation.id}
          blueprints={blueprints}
          defaultCode={code}
        />
      </div>

      <div className="mt-4">
        <Card>
          <CardHeader>
            <CardTitle>MCP tokens</CardTitle>
            <CardDescription>
              Bearer tokens for MCP clients — Claude Code, Cursor, the JARVIS TUI. Also on the
              MCP tab of your account dialog.
            </CardDescription>
            <CardAction>
              <McpTokensDialog />
            </CardAction>
          </CardHeader>
        </Card>
      </div>
    </div>
  );
}
