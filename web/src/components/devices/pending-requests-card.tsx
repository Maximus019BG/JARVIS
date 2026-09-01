"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Fingerprint } from "~/components/animate-ui/icons/fingerprint";
import { Monitor, Sparkles, X } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { devicesApi, type PendingDeviceRequest } from "~/lib/api/blueprint-versions";
import { typeToConfirm } from "~/lib/type-to-confirm-store";
import { DeviceApproval, type LinkableBlueprint } from "./device-approval";

/** Live "expires in 4:12", so a stale request reads as stale rather than as broken. */
function useCountdown(expiresAt: string): string {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const left = Math.max(0, Math.floor((new Date(expiresAt).getTime() - now) / 1000));
  return `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
}

function PendingRow({
  request,
  onApprove,
  onReject,
}: {
  request: PendingDeviceRequest;
  onApprove: () => void;
  onReject: () => void;
}) {
  const countdown = useCountdown(request.expiresAt);

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <Monitor className="size-4 shrink-0" />
          <span className="truncate font-medium">{request.name}</span>
          {request.platform && (
            <Badge variant="secondary" className="text-[10px]">
              {request.platform}
            </Badge>
          )}
          {!request.knownFingerprint && (
            <Badge variant="outline" className="text-[10px]">
              <Sparkles className="mr-1 size-3" />
              new device
            </Badge>
          )}
        </div>
        {/*
          The fingerprint, not the name, is what makes this safe to act on: anyone who knows
          your email can put a row here, and the name is whatever they chose to call it.
        */}
        <div className="text-muted-foreground flex items-center gap-2 text-xs">
          <Fingerprint className="size-3.5 shrink-0" />
          <code className="font-mono">{request.fingerprint}</code>
          <span>· expires in {countdown}</span>
        </div>
      </div>

      {/* Reject is given the same weight as Approve — an unrecognised row is meant to be
          turned down, and a UI that makes that the harder click gets the wrong answer. */}
      <div className="flex shrink-0 gap-2">
        <Button variant="outline" size="sm" onClick={onReject}>
          <X className="size-4" />
          Reject
        </Button>
        <Button size="sm" onClick={onApprove}>
          Approve
        </Button>
      </div>
    </div>
  );
}

/**
 * Pairing requests waiting for the signed-in user.
 *
 * A device that named an email at `/pair` lands here, so approving costs a tap instead of
 * transcribing an eight-character code. The list is scoped server-side to `target_user_id`
 * and is never a global feed — see the route for why that distinction matters.
 */
export function PendingRequestsCard({
  workstationId,
  blueprints,
}: {
  workstationId: string;
  blueprints: LinkableBlueprint[];
}) {
  const client = useQueryClient();
  const [approving, setApproving] = useState<PendingDeviceRequest | null>(null);

  const { data: requests } = useQuery({
    queryKey: ["devices", "pending"],
    queryFn: () => devicesApi.pending(),
    // A request appears without any action in this tab, so this has to poll to be useful at
    // all. Ten-minute TTL, so five seconds is frequent enough to feel immediate and cheap.
    refetchInterval: 5000,
  });

  const refresh = () => {
    void client.invalidateQueries({ queryKey: ["devices"] });
  };

  const reject = (request: PendingDeviceRequest) =>
    void typeToConfirm.show({
      title: `Reject ${request.name}?`,
      description:
        "The request disappears and that machine stops waiting. Nothing is granted, and it can ask again.",
      confirmText: request.name,
      confirmButtonText: "Reject",
      confirmButtonVariant: "destructive",
      onConfirm: async () => {
        typeToConfirm.setIsLoading(true);
        try {
          await devicesApi.reject(request.userCode);
          toast.success(`${request.name} rejected`);
          refresh();
          typeToConfirm.close(true);
        } catch {
          toast.error("Could not reject this request");
        } finally {
          typeToConfirm.setIsLoading(false);
        }
      },
    });

  // Nothing waiting is the normal state; an empty card every visit would be noise.
  if (!requests || requests.length === 0) return null;

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Waiting to be approved</CardTitle>
          <CardDescription>
            {requests.length === 1 ? "A machine is" : `${requests.length} machines are`} asking to pair
            with your account. Check the fingerprint matches the machine you ran{" "}
            <code className="font-mono text-xs">/pair</code> on.
          </CardDescription>
        </CardHeader>
        <div className="space-y-2 px-6 pb-6">
          {requests.map((request) => (
            <PendingRow
              key={request.userCode}
              request={request}
              onApprove={() => setApproving(request)}
              onReject={() => reject(request)}
            />
          ))}
        </div>
      </Card>

      <Dialog open={approving !== null} onOpenChange={(next) => !next && setApproving(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Approve {approving?.name}</DialogTitle>
            <DialogDescription>Choose what this device may reach.</DialogDescription>
          </DialogHeader>
          {approving && (
            <DeviceApproval
              userCode={approving.userCode}
              workstationId={workstationId}
              blueprints={blueprints}
              request={approving}
              backLabel="Cancel"
              onBack={() => setApproving(null)}
              onApproved={(device) => {
                toast.success(`${device.name} approved`, {
                  description: "It picks up its credentials within a few seconds.",
                });
                setApproving(null);
                refresh();
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
