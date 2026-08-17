"use client";

import { useState } from "react";
import { toast } from "sonner";
import { LoadingButton } from "~/components/common/loading-button";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { Label } from "~/components/ui/label";
import { ScrollArea } from "~/components/ui/scroll-area";
import { Separator } from "~/components/ui/separator";
import { Switch } from "~/components/ui/switch";
import { devicesApi, type DeviceRow } from "~/lib/api/blueprint-versions";
import { sheet } from "~/lib/sheet-store";
import { levelsFrom, ScopeMatrix, toScopes } from "./scope-matrix";
import type { LinkableBlueprint } from "./link-device-dialog";

/**
 * Body of the "Manage access" sheet. Replaces a device's whole grant set rather than
 * merging, so unticking a box actually removes access — see the PATCH handler.
 */
function AccessForm({
  device,
  blueprints,
  onSaved,
}: {
  device: DeviceRow;
  blueprints: LinkableBlueprint[];
  onSaved?: () => void;
}) {
  const [all, setAll] = useState(device.access.scope === "all");
  const [mode, setMode] = useState<"read" | "write">(device.access.mode === "read" ? "read" : "write");
  const [chosen, setChosen] = useState<Set<string>>(
    new Set(device.access.scope === "some" ? device.access.blueprintIds : []),
  );
  const [levels, setLevels] = useState(() => levelsFrom(device.scopes ?? []));
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      // Two independent boundaries, saved together because the sheet asks about both:
      // grants are what the sync routes enforce, scopes are what the MCP server enforces.
      const [result] = await Promise.all([
        devicesApi.setGrants(device.id, {
          allBlueprints: all,
          blueprintIds: all ? [] : [...chosen],
          mode,
        }),
        devicesApi.setScopes(device.id, toScopes(levels)),
      ]);
      toast.success(
        result.grants === 0
          ? `${device.name} can no longer reach any blueprint`
          : `${device.name} updated`,
      );
      onSaved?.();
      sheet.close();
    } catch {
      toast.error("Could not update access");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-0.5">
          <Label htmlFor="all-blueprints">All blueprints</Label>
          <p className="text-muted-foreground text-xs">Includes blueprints created after today.</p>
        </div>
        <Switch id="all-blueprints" checked={all} onCheckedChange={setAll} />
      </div>

      {!all && (
        <>
          <Separator />
          <div className="space-y-2">
            <Label>Blueprints</Label>
            <ScrollArea className="h-64 rounded-md border p-2">
              {blueprints.length === 0 ? (
                <p className="text-muted-foreground p-2 text-xs">No blueprints in this workstation yet.</p>
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
            {chosen.size === 0 && (
              <p className="text-muted-foreground text-xs">
                Nothing selected — saving will revoke this device&apos;s access to every blueprint.
              </p>
            )}
          </div>
        </>
      )}

      <Separator />

      <div className="flex items-start justify-between gap-4">
        <div className="space-y-0.5">
          <Label htmlFor="can-write">Allow writing</Label>
          <p className="text-muted-foreground text-xs">Off means the device can pull but never push.</p>
        </div>
        <Switch
          id="can-write"
          checked={mode === "write"}
          onCheckedChange={(checked) => setMode(checked ? "write" : "read")}
        />
      </div>

      <Separator />

      <div className="space-y-2">
        <div className="space-y-0.5">
          <Label>MCP access</Label>
          <p className="text-muted-foreground text-xs">
            What this token may do through the MCP server. Everything on <em>none</em> means it cannot
            use MCP at all — the tools are not even listed to it.
          </p>
        </div>
        <ScopeMatrix levels={levels} onChange={setLevels} />
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <Button variant="ghost" onClick={() => sheet.close()}>
          Cancel
        </Button>
        <LoadingButton isLoading={saving} onClick={save}>
          Save access
        </LoadingButton>
      </div>
    </div>
  );
}

export function openDeviceAccessSheet(
  device: DeviceRow,
  blueprints: LinkableBlueprint[],
  onSaved?: () => void,
) {
  sheet.open({
    title: `Access for ${device.name}`,
    description: "Choose what this device may reach. Enforced on every push and pull.",
    body: <AccessForm device={device} blueprints={blueprints} onSaved={onSaved} />,
  });
}
