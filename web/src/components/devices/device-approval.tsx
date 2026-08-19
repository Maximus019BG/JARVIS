"use client";

import { Fingerprint } from "~/components/animate-ui/icons/fingerprint";
import { AlertCircle, Check, Monitor, Sparkles } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { LoadingButton } from "~/components/common/loading-button";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { Label } from "~/components/ui/label";
import { RadioGroup, RadioGroupItem } from "~/components/ui/radio-group";
import { ScrollArea } from "~/components/ui/scroll-area";
import { Separator } from "~/components/ui/separator";
import { devicesApi } from "~/lib/api/blueprint-versions";

export type LinkableBlueprint = { id: string; name: string };

export type PendingRequest = {
  name: string;
  fingerprint: string;
  platform: string | null;
  expiresAt: string;
  /** Only the pending list knows this; the code path leaves it undefined. */
  knownFingerprint?: boolean;
};

/**
 * What a device is allowed to reach, and the Approve button.
 *
 * Extracted because approval is now reachable three ways — the pending list, a scanned QR
 * landing on /link, and the code dialog — and three copies of a permission form is three
 * places for the defaults to drift apart.
 *
 * The fingerprint panel is not decoration. `POST /api/device/code` is unauthenticated by
 * design, so anyone can create a request; comparing this against the machine you just typed
 * on is the whole thing standing between "my Pi" and someone else's box.
 */
export function DeviceApproval({
  userCode,
  workstationId,
  blueprints,
  request,
  onApproved,
  onBack,
  backLabel = "Back",
}: {
  userCode: string;
  workstationId: string;
  blueprints: LinkableBlueprint[];
  request: PendingRequest;
  onApproved?: (device: { id: string; name: string }) => void;
  onBack?: () => void;
  backLabel?: string;
}) {
  const [saving, setSaving] = useState(false);
  const [scope, setScope] = useState<"all" | "some">("all");
  const [mode, setMode] = useState<"read" | "write">("write");
  const [chosen, setChosen] = useState<Set<string>>(new Set());

  const approve = async () => {
    setSaving(true);
    try {
      const device = await devicesApi.approve({
        userCode,
        workstationId,
        blueprintIds: scope === "some" ? [...chosen] : [],
        allBlueprints: scope === "all",
        mode,
      });
      onApproved?.(device);
    } catch {
      toast.error("Could not approve this device");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="bg-muted/40 space-y-2 rounded-lg border p-3">
        <div className="flex flex-wrap items-center gap-2">
          <Monitor className="size-4 shrink-0" />
          <span className="font-medium">{request.name}</span>
          {request.platform && (
            <Badge variant="secondary" className="text-[10px]">
              {request.platform}
            </Badge>
          )}
          {request.knownFingerprint === false && (
            <Badge variant="outline" className="text-[10px]">
              <Sparkles className="mr-1 size-3" />
              new device
            </Badge>
          )}
        </div>
        <div className="text-muted-foreground flex items-center gap-2 text-xs">
          <Fingerprint className="size-3.5 shrink-0" />
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
        <p className="text-muted-foreground text-xs">
          Also sets what this device may do over MCP. Change it later under Manage access.
        </p>
      </div>

      <div className="flex justify-end gap-2">
        {onBack && (
          <Button variant="ghost" onClick={onBack}>
            {backLabel}
          </Button>
        )}
        <LoadingButton
          isLoading={saving}
          onClick={approve}
          disabled={scope === "some" && chosen.size === 0}
        >
          <Check className="size-4" />
          Approve
        </LoadingButton>
      </div>
    </div>
  );
}
