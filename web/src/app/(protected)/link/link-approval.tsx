"use client";

import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Loader2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { DeviceApproval } from "~/components/devices/device-approval";
import { devicesApi } from "~/lib/api/blueprint-versions";
import { useWorkstationBlueprints } from "~/lib/workstation-blueprints";
import { useActiveWorkstation } from "~/lib/workstation-hooks";

/**
 * The approval screen on its own, sized for the phone that just scanned the QR.
 *
 * Deliberately thin: the permission form itself is `DeviceApproval`, shared with the dialog
 * and the pending list, so the three entry points cannot drift into three different sets of
 * defaults.
 */
export function LinkApproval({ code }: { code: string }) {
  const { data: workstation } = useActiveWorkstation();
  const blueprints = useWorkstationBlueprints(workstation?.id);
  const [approved, setApproved] = useState<string | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["devices", "lookup", code],
    queryFn: () => devicesApi.lookup(code),
    retry: false,
  });

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-md flex-col justify-center p-4">
      <Card>
        <CardHeader>
          <CardTitle>{approved ? "Device approved" : "Approve this device?"}</CardTitle>
          <CardDescription>
            {approved
              ? "It picks up its credentials within a few seconds."
              : `Pairing code ${code.toUpperCase()}`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {approved ? (
            <div className="flex flex-col items-center gap-3 py-4 text-center">
              <CheckCircle2 className="text-primary size-10" />
              <p className="font-medium">{approved} can now sync with {workstation?.name}.</p>
              <Button asChild variant="outline">
                <Link href="/app/settings">Manage devices</Link>
              </Button>
            </div>
          ) : isLoading || !workstation ? (
            <div className="text-muted-foreground flex items-center justify-center gap-2 py-8 text-sm">
              <Loader2 className="size-4 animate-spin" />
              Checking that code…
            </div>
          ) : isError || !data ? (
            <div className="space-y-3 py-4 text-center">
              <p className="text-sm">That code is unknown, expired, or meant for another account.</p>
              <p className="text-muted-foreground text-xs">
                Codes last ten minutes. Run <code className="font-mono">/pair</code> again to get a new one.
              </p>
              <Button asChild variant="outline">
                <Link href="/app/settings">Go to devices</Link>
              </Button>
            </div>
          ) : (
            <DeviceApproval
              userCode={code}
              workstationId={workstation.id}
              blueprints={blueprints}
              request={data}
              onApproved={(device) => setApproved(device.name)}
            />
          )}
        </CardContent>
      </Card>
    </main>
  );
}
