"use client";

import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { useActiveWorkstation } from "~/lib/workstation-hooks";

export default function SettingsPage() {
  const { data: activeWorkstation } = useActiveWorkstation();

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
    </div>
  );
}
