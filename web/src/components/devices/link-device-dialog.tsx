"use client";

import { Fingerprint } from "~/components/animate-ui/icons/fingerprint";
import { CheckCircle2, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "~/components/ui/dialog";
import { InputOTP, InputOTPGroup, InputOTPSeparator, InputOTPSlot } from "~/components/ui/input-otp";
import { devicesApi } from "~/lib/api/blueprint-versions";
import { DeviceApproval, type LinkableBlueprint, type PendingRequest } from "./device-approval";

export type { LinkableBlueprint };

/**
 * The approval half of the device pairing flow, entered by code.
 *
 * Three views on purpose: the code identifies a request, and only then does the reader see
 * what is asking — name, platform and fingerprint — before choosing what it may reach.
 * Showing that *before* approving is the whole defence against someone else's machine
 * guessing a code.
 *
 * The third view is why this no longer closes on Approve. Approval creates the device row
 * but no token; the device mints one on its next poll, up to five seconds later. Closing on
 * Approve used to leave a toast promising it would finish "in a few seconds" and a table
 * that never refreshed to show whether it had.
 */
type View =
  | { kind: "code" }
  | { kind: "review"; request: PendingRequest }
  | { kind: "waiting"; deviceId: string; name: string };

export function LinkDeviceDialog({
  workstationId,
  blueprints,
  onLinked,
  defaultCode,
}: {
  workstationId: string;
  blueprints: LinkableBlueprint[];
  onLinked?: () => void;
  defaultCode?: string;
}) {
  const [open, setOpen] = useState(Boolean(defaultCode));
  const [code, setCode] = useState((defaultCode ?? "").replace(/[^0-9A-Za-z]/g, "").toUpperCase());
  const [view, setView] = useState<View>({ kind: "code" });
  const [looking, setLooking] = useState(false);
  const [connected, setConnected] = useState(false);

  const reset = () => {
    setView({ kind: "code" });
    setCode("");
    setConnected(false);
  };

  const lookup = async (value: string) => {
    setLooking(true);
    try {
      setView({ kind: "review", request: await devicesApi.lookup(value) });
    } catch {
      toast.error("That code is unknown or has expired");
      setCode("");
    } finally {
      setLooking(false);
    }
  };

  // Watch for the device taking delivery of its token, which is the moment it is actually
  // usable. Stops on its own once that happens, and is torn down with the dialog.
  const waitingFor = view.kind === "waiting" ? view.deviceId : null;
  useEffect(() => {
    if (!waitingFor || connected) return;
    const timer = setInterval(() => {
      void devicesApi
        .list(workstationId)
        .then((devices) => {
          if (devices.find((device) => device.id === waitingFor)?.paired) {
            setConnected(true);
            onLinked?.();
          }
        })
        .catch(() => undefined);
    }, 2000);
    return () => clearInterval(timer);
  }, [connected, onLinked, waitingFor, workstationId]);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          reset();
          onLinked?.();
        }
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm">
          <Fingerprint className="size-4" />
          Link a device
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Link a device</DialogTitle>
          <DialogDescription>
            Run <code className="font-mono text-xs">/pair</code> in JARVIS on that machine and enter
            the code it shows.
          </DialogDescription>
        </DialogHeader>

        {view.kind === "code" && (
          <div className="flex flex-col items-center gap-4 py-2">
            <InputOTP
              maxLength={8}
              value={code}
              onChange={(value) => {
                const next = value.toUpperCase();
                setCode(next);
                if (next.length === 8) void lookup(next);
              }}
              disabled={looking}
            >
              <InputOTPGroup>
                <InputOTPSlot index={0} />
                <InputOTPSlot index={1} />
                <InputOTPSlot index={2} />
                <InputOTPSlot index={3} />
              </InputOTPGroup>
              <InputOTPSeparator />
              <InputOTPGroup>
                <InputOTPSlot index={4} />
                <InputOTPSlot index={5} />
                <InputOTPSlot index={6} />
                <InputOTPSlot index={7} />
              </InputOTPGroup>
            </InputOTP>
            <p className="text-muted-foreground text-xs">
              {looking ? "Checking…" : "Codes expire after 10 minutes"}
            </p>
          </div>
        )}

        {view.kind === "review" && (
          <DeviceApproval
            userCode={code}
            workstationId={workstationId}
            blueprints={blueprints}
            request={view.request}
            onBack={reset}
            onApproved={(device) => setView({ kind: "waiting", deviceId: device.id, name: device.name })}
          />
        )}

        {view.kind === "waiting" && (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            {connected ? (
              <>
                <CheckCircle2 className="text-primary size-8" />
                <p className="font-medium">{view.name} is connected</p>
                <p className="text-muted-foreground text-sm">It can sync blueprints with this workstation now.</p>
              </>
            ) : (
              <>
                <Loader2 className="text-muted-foreground size-8 animate-spin" />
                <p className="font-medium">Waiting for {view.name} to connect…</p>
                <p className="text-muted-foreground text-sm">
                  Approved. It picks up its credentials on its next check, within a few seconds.
                </p>
              </>
            )}
          </div>
        )}

        {view.kind === "waiting" && (
          <DialogFooter>
            <Button onClick={() => setOpen(false)}>{connected ? "Done" : "Close"}</Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
