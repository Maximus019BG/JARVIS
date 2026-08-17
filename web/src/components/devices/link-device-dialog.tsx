"use client";

import { Fingerprint } from "~/components/animate-ui/icons/fingerprint";
import { AlertCircle, Check, Monitor } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { LoadingButton } from "~/components/common/loading-button";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
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
import { Label } from "~/components/ui/label";
import { RadioGroup, RadioGroupItem } from "~/components/ui/radio-group";
import { ScrollArea } from "~/components/ui/scroll-area";
import { Separator } from "~/components/ui/separator";
import { devicesApi } from "~/lib/api/blueprint-versions";

export type LinkableBlueprint = { id: string; name: string };

type PendingRequest = { name: string; fingerprint: string; platform: string | null; expiresAt: string };

/**
 * The approval half of the device pairing flow. Two steps on purpose: the code identifies
 * a request, and only then does the user see what is asking — name, platform and
 * fingerprint — before choosing what it may reach. Showing that *before* approving is the
 * whole defence against someone else's machine guessing a code.
 */
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
  const [request, setRequest] = useState<PendingRequest | null>(null);
  const [looking, setLooking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [scope, setScope] = useState<"all" | "some">("all");
  const [mode, setMode] = useState<"read" | "write">("write");
  const [chosen, setChosen] = useState<Set<string>>(new Set());

  const reset = () => {
    setRequest(null);
    setCode("");
    setScope("all");
    setMode("write");
    setChosen(new Set());
  };

  const lookup = async (value: string) => {
    setLooking(true);
    try {
      setRequest(await devicesApi.lookup(value));
    } catch {
      toast.error("That code is unknown or has expired");
      setCode("");
    } finally {
      setLooking(false);
    }
  };

  const approve = async () => {
    setSaving(true);
    try {
      const device = await devicesApi.approve({
        userCode: code,
        workstationId,
        blueprintIds: scope === "some" ? [...chosen] : [],
        allBlueprints: scope === "all",
        mode,
      });
      toast.success(`${device.name} approved`, {
        description: "It will finish pairing within a few seconds.",
      });
      setOpen(false);
      reset();
      onLinked?.();
    } catch {
      toast.error("Could not approve this device");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
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
            Run <code className="font-mono text-xs">jarvis pair</code> on the machine and enter the code it shows.
          </DialogDescription>
        </DialogHeader>

        {!request ? (
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
            <p className="text-muted-foreground text-xs">{looking ? "Checking…" : "Codes expire after 10 minutes"}</p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="bg-muted/40 space-y-2 rounded-lg border p-3">
              <div className="flex items-center gap-2">
                <Monitor className="size-4" />
                <span className="font-medium">{request.name}</span>
                {request.platform && (
                  <Badge variant="secondary" className="text-[10px]">
                    {request.platform}
                  </Badge>
                )}
              </div>
              <div className="text-muted-foreground flex items-center gap-2 text-xs">
                <Fingerprint className="size-3.5" />
                <code className="font-mono">{request.fingerprint}</code>
              </div>
              <p className="text-muted-foreground flex items-start gap-1.5 text-xs">
                <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
                Only approve this if the fingerprint matches the machine you just ran the command on.
              </p>
            </div>

            <Separator />

            <div className="space-y-2">
              <Label>Access</Label>
              <RadioGroup value={scope} onValueChange={(value) => setScope(value as "all" | "some")}>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="all" id="scope-all" />
                  <Label htmlFor="scope-all" className="font-normal">
                    All blueprints, including new ones
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="some" id="scope-some" />
                  <Label htmlFor="scope-some" className="font-normal">
                    Only the ones I choose
                  </Label>
                </div>
              </RadioGroup>
            </div>

            {scope === "some" && (
              <ScrollArea className="h-36 rounded-md border p-2">
                {blueprints.length === 0 ? (
                  <p className="text-muted-foreground p-2 text-xs">
                    This workstation has no blueprints yet. Grant all access, or pair after the first push.
                  </p>
                ) : (
                  blueprints.map((item) => (
                    <label key={item.id} className="hover:bg-muted/60 flex items-center gap-2 rounded px-2 py-1.5">
                      <Checkbox
                        checked={chosen.has(item.id)}
                        onCheckedChange={(checked) =>
                          setChosen((current) => {
                            const next = new Set(current);
                            if (checked) next.add(item.id);
                            else next.delete(item.id);
                            return next;
                          })
                        }
                      />
                      <span className="truncate text-sm">{item.name}</span>
                    </label>
                  ))
                )}
              </ScrollArea>
            )}

            <div className="space-y-2">
              <Label>Permission</Label>
              <RadioGroup
                value={mode}
                onValueChange={(value) => setMode(value as "read" | "write")}
                className="flex gap-4"
              >
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="write" id="mode-write" />
                  <Label htmlFor="mode-write" className="font-normal">
                    Read and write
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="read" id="mode-read" />
                  <Label htmlFor="mode-read" className="font-normal">
                    Read only
                  </Label>
                </div>
              </RadioGroup>
            </div>
          </div>
        )}

        <DialogFooter>
          {request && (
            <>
              <Button variant="ghost" onClick={reset}>
                Back
              </Button>
              <LoadingButton
                isLoading={saving}
                onClick={approve}
                disabled={scope === "some" && chosen.size === 0}
              >
                <Check className="size-4" />
                Approve
              </LoadingButton>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
