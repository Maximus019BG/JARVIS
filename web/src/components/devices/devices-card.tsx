"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { Copy, MoreHorizontal, ShieldOff, SlidersHorizontal } from "lucide-react";
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
import { copyToClipboard } from "~/lib/copy";
import { typeToConfirm } from "~/lib/type-to-confirm-store";
import { AddDevicePanel } from "./add-device-panel";
import { openDeviceAccessSheet } from "./device-access-sheet";
import { LinkDeviceDialog, type LinkableBlueprint } from "./link-device-dialog";

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  active: "default",
  revoked: "destructive",
};

/**
 * Whether a device is actually working, not merely approved.
 *
 * `jarvis work` polls every three seconds while busy and every fifteen once idle, so a gap
 * under a minute means something is running on the other end. Without this the table
 * answers "was this ever paired", which is not the question anyone opens it with.
 */
function liveness(device: DeviceRow): { label: string; live: boolean } {
  if (device.status !== "active") return { label: "—", live: false };
  if (!device.lastSeenAt) return { label: "never", live: false };
  const seen = new Date(device.lastSeenAt);
  const live = Date.now() - seen.getTime() < 60_000;
  return { label: live ? "polling now" : formatDistanceToNow(seen, { addSuffix: true }), live };
}

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
  const client = useQueryClient();
  const { data: devices } = useQuery({
    queryKey: ["devices", "list", workstationId],
    queryFn: () => devicesApi.list(workstationId),
    /**
     * Poll only while something is still arriving. A device is approved before it holds a
     * token — it mints one on its next check — so `paired: false` is a transient state that
     * used to sit there reading as broken until someone reloaded the page.
     */
    refetchInterval: (query) => (query.state.data?.some((device) => !device.paired) ? 3000 : false),
  });

  const load = () => {
    void client.invalidateQueries({ queryKey: ["devices"] });
  };

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
          load();
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

      <div className="space-y-4 px-6 pb-6">
        <AddDevicePanel />

        {devices === undefined ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : devices.length === 0 ? (
          <Empty className="border-none">
            <EmptyHeader>
              <EmptyTitle>No devices yet</EmptyTitle>
              <EmptyDescription>
                Start JARVIS on a machine and run <code className="font-mono text-xs">/pair</code>. It shows up
                here for approval, no code to type.
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
                          onClick={() => void copyToClipboard(device.id, "Device id")}
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
                    <TableCell className="text-sm">
                      {(() => {
                        const { label, live } = liveness(device);
                        return (
                          <span className={live ? "flex items-center gap-1.5" : "text-muted-foreground"}>
                            {live && <span className="bg-primary size-1.5 animate-pulse rounded-full" />}
                            {label}
                          </span>
                        );
                      })()}
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
