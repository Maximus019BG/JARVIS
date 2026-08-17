"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertCircle, Copy, Plug, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { levelsFrom, ScopeMatrix, toScopes } from "~/components/devices/scope-matrix";
import { LoadingButton } from "~/components/common/loading-button";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import { Checkbox } from "~/components/ui/checkbox";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { RadioGroup, RadioGroupItem } from "~/components/ui/radio-group";
import { ScrollArea } from "~/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Separator } from "~/components/ui/separator";
import { devicesApi, type DeviceRow } from "~/lib/api/blueprint-versions";
import { useWorkstationBlueprints } from "~/lib/workstation-blueprints";
import { useActiveWorkstation, useListWorkstations } from "~/lib/workstation-hooks";

/**
 * The MCP tab of the account dialog: mint a token for an MCP client, and revoke the ones
 * already out there.
 *
 * Lives on the account dialog rather than a page because a token is a personal credential —
 * you reach for it from wherever you are, in the same place you'd change your password.
 *
 * Not a nested dialog: the token appears in place of the form once created. Nesting a modal
 * inside the account modal would trap focus in the wrong layer.
 */

const DEFAULT_SCOPES = ["workstations:read", "automations:read", "blueprints:read"];

export function AccountMcpSection() {
  const { data: workstations } = useListWorkstations();
  const { data: activeWorkstation } = useActiveWorkstation();

  const [workstationId, setWorkstationId] = useState<string | null>(null);
  const chosenWorkstation = workstationId ?? activeWorkstation?.id ?? workstations?.[0]?.id ?? null;

  const blueprints = useWorkstationBlueprints(chosenWorkstation ?? undefined);

  const [name, setName] = useState("");
  const [levels, setLevels] = useState(() => levelsFrom(DEFAULT_SCOPES));
  const [scope, setScope] = useState<"all" | "some">("all");
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [token, setToken] = useState<string | null>(null);

  const scopes = toScopes(levels);

  // React Query rather than a load-in-an-effect: it is what the workstation and blueprint
  // hooks already use here, and it keeps the list fresh across the two places that change it.
  const { data: tokens, refetch } = useQuery({
    queryKey: ["workstation", chosenWorkstation, "mcp-tokens"],
    enabled: Boolean(chosenWorkstation),
    queryFn: async () =>
      (await devicesApi.list(chosenWorkstation!)).filter(
        (device) => device.platform === "mcp" && device.status === "active",
      ),
  });

  const reset = () => {
    setName("");
    setLevels(levelsFrom(DEFAULT_SCOPES));
    setScope("all");
    setChosen(new Set());
    setToken(null);
  };

  const create = async () => {
    if (!chosenWorkstation) return;
    setSaving(true);
    try {
      const result = await devicesApi.createMcpToken({
        workstationId: chosenWorkstation,
        name: name.trim(),
        scopes,
        allBlueprints: scope === "all",
        blueprintIds: scope === "some" ? [...chosen] : [],
        // The grant mode mirrors the blueprint scope: a token that may not write blueprints
        // has no use for a write grant, and one that may should not be blocked by it.
        mode: levels.blueprints === "write" ? "write" : "read",
      });
      setToken(result.token);
      void refetch();
    } catch {
      toast.error("Could not create the token");
    } finally {
      setSaving(false);
    }
  };

  const revoke = async (device: DeviceRow) => {
    try {
      await devicesApi.revoke(device.id);
      toast.success(`${device.name} revoked`);
      void refetch();
    } catch {
      toast.error("Could not revoke that token");
    }
  };

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success("Copied");
    } catch {
      toast.error("Could not copy — select it and copy by hand");
    }
  };

  if (!chosenWorkstation) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>MCP tokens</CardTitle>
          <CardDescription>Create a workstation first.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const origin = typeof window === "undefined" ? "" : window.location.origin;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Plug className="size-4" />
          MCP tokens
        </CardTitle>
        <CardDescription>
          Let an MCP client — Claude Code, Cursor, the JARVIS TUI — reach this workstation. Each
          token carries its own read/write rights per area; a tool it has no scope for is not even
          listed to it.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-5">
        {token ? (
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">Your token — shown once</Label>
              <div className="flex items-center gap-2">
                <code className="bg-muted min-w-0 flex-1 truncate rounded border p-2 font-mono text-xs">
                  {token}
                </code>
                <Button size="icon" variant="outline" onClick={() => copy(token)} aria-label="Copy token">
                  <Copy className="size-4" />
                </Button>
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Add it to Claude Code</Label>
              <code className="bg-muted block overflow-x-auto rounded border p-2 font-mono text-[11px] whitespace-pre">
                {`claude mcp add --transport http jarvis ${origin}/api/mcp --header "Authorization: Bearer ${token}"`}
              </code>
            </div>

            <p className="text-muted-foreground flex items-start gap-1.5 text-xs">
              <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
              Anyone holding this token has the access you just granted. Revoke it below if it leaks.
            </p>

            <Button variant="outline" onClick={reset}>
              Create another
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            {workstations && workstations.length > 1 && (
              <div className="space-y-2">
                <Label>Workstation</Label>
                <Select value={chosenWorkstation} onValueChange={setWorkstationId}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {workstations.map((item) => (
                      <SelectItem key={item.id} value={item.id}>
                        {item.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="mcp-token-name">Name</Label>
              <Input
                id="mcp-token-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Claude Code on my laptop"
                maxLength={64}
              />
            </div>

            <Separator />

            <ScopeMatrix levels={levels} onChange={setLevels} />

            {levels.blueprints !== "none" && (
              <>
                <Separator />
                <div className="space-y-2">
                  <Label>Which blueprints</Label>
                  <RadioGroup value={scope} onValueChange={(value) => setScope(value as "all" | "some")}>
                    <div className="flex items-center gap-2">
                      <RadioGroupItem value="all" id="mcp-scope-all" />
                      <Label htmlFor="mcp-scope-all" className="font-normal">
                        All blueprints, including new ones
                      </Label>
                    </div>
                    <div className="flex items-center gap-2">
                      <RadioGroupItem value="some" id="mcp-scope-some" />
                      <Label htmlFor="mcp-scope-some" className="font-normal">
                        Only the ones I choose
                      </Label>
                    </div>
                  </RadioGroup>
                </div>

                {scope === "some" && (
                  <ScrollArea className="h-36 rounded-md border p-2">
                    {blueprints.length === 0 ? (
                      <p className="text-muted-foreground p-2 text-xs">
                        This workstation has no blueprints yet.
                      </p>
                    ) : (
                      blueprints.map((item) => (
                        <label
                          key={item.id}
                          className="hover:bg-muted/60 flex items-center gap-2 rounded px-2 py-1.5"
                        >
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
              </>
            )}

            {scopes.length === 0 && (
              <p className="text-muted-foreground text-xs">
                Nothing selected — this token would see no tools at all.
              </p>
            )}

            <LoadingButton
              isLoading={saving}
              onClick={create}
              disabled={
                name.trim().length === 0 ||
                scopes.length === 0 ||
                (levels.blueprints !== "none" && scope === "some" && chosen.size === 0)
              }
            >
              Create token
            </LoadingButton>
          </div>
        )}

        {tokens && tokens.length > 0 && (
          <>
            <Separator />
            <div className="space-y-2">
              <Label>Active tokens</Label>
              {tokens.map((device) => (
                <div
                  key={device.id}
                  className="flex items-start justify-between gap-3 rounded-md border p-3"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">{device.name}</span>
                      <code className="text-muted-foreground font-mono text-[11px]">
                        {device.tokenPrefix}…
                      </code>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {device.scopes.length === 0 ? (
                        <span className="text-muted-foreground text-xs">No scopes — sees nothing</span>
                      ) : (
                        device.scopes.map((granted) => (
                          <Badge key={granted} variant="secondary" className="text-[10px]">
                            {granted}
                          </Badge>
                        ))
                      )}
                    </div>
                    {device.lastSeenAt && (
                      <p className="text-muted-foreground text-xs">
                        Last used {new Date(device.lastSeenAt).toLocaleString()}
                      </p>
                    )}
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => revoke(device)}
                    aria-label={`Revoke ${device.name}`}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
