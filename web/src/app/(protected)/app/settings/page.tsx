"use client";

import React from "react";
import { useSearchParams } from "next/navigation";
import { DevicesCard } from "~/components/devices/devices-card";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { useActiveWorkstation } from "~/lib/workstation-hooks";
import { useWorkstationBlueprints } from "~/lib/workstation-blueprints";

export default function SettingsPage() {
  const { data: activeWorkstation } = useActiveWorkstation();
  const searchParams = useSearchParams();
  // `/link?code=…` redirects here so the printed URL stays short enough to read off a
  // projected surface; the dialog opens itself with the code prefilled.
  const code = searchParams.get("code") ?? undefined;
  const blueprints = useWorkstationBlueprints(activeWorkstation?.id);

  if (!activeWorkstation) return null;

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
        <DevicesCard
          workstationId={activeWorkstation.id}
          blueprints={blueprints}
          defaultCode={code}
        />
      </div>
    </div>
  );
}
