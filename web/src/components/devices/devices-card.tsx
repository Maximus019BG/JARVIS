"use client";

import { formatDistanceToNow } from "date-fns";
import { Copy, MoreHorizontal, ShieldOff, SlidersHorizontal } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardAction, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "~/components/ui/empty";
import { Skeleton } from "~/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "~/components/ui/table";
import { devicesApi, type DeviceRow } from "~/lib/api/blueprint-versions";
import { typeToConfirm } from "~/lib/type-to-confirm-store";
import { openDeviceAccessSheet } from "./device-access-sheet";
import { LinkDeviceDialog, type LinkableBlueprint } from "./link-device-dialog";

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  active: "default",
  revoked: "destructive",
};

function accessLabel(device: DeviceRow): string {
  if (device.access.scope === "all") return `All blueprints · ${device.access.mode}`;
  const count = device.access.blueprintIds.length;
  if (count === 0) return "No access";
  return `${count} blueprint${count === 1 ? "" : "s"} · ${device.access.mode}`;
}

export function DevicesCard({
  workstationId,
  blueprints,
  defaultCode,
}: {
  workstationId: string;
  blueprints: LinkableBlueprint[];
  defaultCode?: string;
}) {
  const [devices, setDevices] = useState<DeviceRow[] | null>(null);

  const load = useCallback(async () => {
    try {
      setDevices(await devicesApi.list(workstationId));
    } catch {
      toast.error("Could not load devices");
      setDevices([]);
    }
  }, [workstationId]);

  useEffect(() => {
    void load();
  }, [load]);

  const revoke = (device: DeviceRow) => {
    void typeToConfirm.show({
      title: `Revoke ${device.name}?`,
      description:
        "Its token stops working on the very next request. Past versions it pushed stay in the history, and it can be paired again later.",
      confirmText: device.name,
      confirmButtonText: "Revoke",
      confirmButtonVariant: "destructive",
      onConfirm: async () => {
        typeToConfirm.setIsLoading(true);
        try {
          await devicesApi.revoke(device.id);
          toast.success(`${device.name} revoked`);
          await load();
          typeToConfirm.close(true);
        } catch {
          toast.error("Could not revoke this device");
        } finally {
          typeToConfirm.setIsLoading(false);
        }
      },
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Devices</CardTitle>
        <CardDescription>
          Machines that can sync blueprints with this workstation — a laptop running the TUI, or a Pi.
        </CardDescription>
        <CardAction>
          <LinkDeviceDialog
            workstationId={workstationId}
            blueprints={blueprints}
            onLinked={load}
            defaultCode={defaultCode}
          />
        </CardAction>
      </CardHeader>

      <div className="px-6 pb-6">
        {devices === null ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : devices.length === 0 ? (
          <Empty className="border-none">
            <EmptyHeader>
              <EmptyTitle>No devices yet</EmptyTitle>
              <EmptyDescription>
                Run <code className="font-mono text-xs">jarvis pair</code> on a machine, then enter the code it shows.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Device</TableHead>
                  <TableHead>Token</TableHead>
                  <TableHead>Access</TableHead>
                  <TableHead>Last seen</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {devices.map((device) => (
                  <TableRow key={device.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{device.name}</span>
                        <Badge variant={STATUS_VARIANT[device.status] ?? "outline"} className="text-[10px]">
                          {device.status}
                        </Badge>
                        {device.status === "active" && !device.paired && (
                          <Badge variant="outline" className="text-[10px]">
                            awaiting first connection
                          </Badge>
                        )}
                      </div>
                      <div className="text-muted-foreground mt-0.5 flex items-center gap-1.5 text-xs">
                        <code className="font-mono">{device.id}</code>
                        <button
                          type="button"
                          className="hover:text-foreground"
                          onClick={() => {
                            void navigator.clipboard.writeText(device.id);
                            toast.success("Device id copied");
                          }}
                        >
                          <Copy className="size-3" />
                        </button>
                        {device.platform && <span className="ml-1">{device.platform}</span>}
                      </div>
                    </TableCell>
                    <TableCell>
                      <code className="font-mono text-xs">{device.tokenPrefix ?? "—"}</code>
                    </TableCell>
                    <TableCell className="text-sm">{accessLabel(device)}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {device.lastSeenAt
                        ? formatDistanceToNow(new Date(device.lastSeenAt), { addSuffix: true })
                        : "never"}
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon">
                            <MoreHorizontal className="size-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => openDeviceAccessSheet(device, blueprints, load)}>
                            <SlidersHorizontal className="size-4" />
                            Manage access
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            variant="destructive"
                            disabled={device.status === "revoked"}
                            onClick={() => revoke(device)}
                          >
                            <ShieldOff className="size-4" />
                            Revoke
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </Card>
  );
}
