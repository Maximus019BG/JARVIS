"use client";

import { AlertCircle, Check, Copy, Plug } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { LoadingButton } from "~/components/common/loading-button";
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
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { RadioGroup, RadioGroupItem } from "~/components/ui/radio-group";
import { ScrollArea } from "~/components/ui/scroll-area";
import { Separator } from "~/components/ui/separator";
import { devicesApi } from "~/lib/api/blueprint-versions";
import { levelsFrom, ScopeMatrix, toScopes } from "./scope-matrix";
import type { LinkableBlueprint } from "./link-device-dialog";

/**
 * Mints a token for an MCP client — Claude Code, Cursor, the TUI's own `mcp` config.
 *
 * Two steps, and the second one is not optional: the token exists in readable form exactly
 * once, in the response to the create call. Closing the dialog without copying it means
 * minting another.
 *
 * Defaults are read-only across the board. A token that can publish automations and rewrite
 * drawings should be something somebody deliberately ticked.
 */
export function CreateMcpTokenDialog({
  workstationId,
  blueprints,
  onCreated,
}: {
  workstationId: string;
  blueprints: LinkableBlueprint[];
  onCreated?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [levels, setLevels] = useState(() =>
    levelsFrom(["workstations:read", "automations:read", "blueprints:read"]),
  );
  const [scope, setScope] = useState<"all" | "some">("all");
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [token, setToken] = useState<string | null>(null);

  const scopes = toScopes(levels);
  const writesBlueprints = levels.blueprints === "write";

  const reset = () => {
    setName("");
    setLevels(levelsFrom(["workstations:read", "automations:read", "blueprints:read"]));
    setScope("all");
    setChosen(new Set());
    setToken(null);
  };

  const create = async () => {
    setSaving(true);
    try {
      const result = await devicesApi.createMcpToken({
        workstationId,
        name: name.trim(),
        scopes,
        allBlueprints: scope === "all",
        blueprintIds: scope === "some" ? [...chosen] : [],
        // The grant mode mirrors the blueprint scope: a token that may not write blueprints
        // has no use for a write grant, and one that may should not be blocked by it.
        mode: writesBlueprints ? "write" : "read",
      });
      setToken(result.token);
      onCreated?.();
    } catch {
      toast.error("Could not create the token");
    } finally {
      setSaving(false);
    }
  };

  const copy = async () => {
    if (!token) return;
    try {
      await navigator.clipboard.writeText(token);
      toast.success("Token copied");
    } catch {
      toast.error("Could not copy — select it and copy by hand");
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
        <Button size="sm" variant="outline">
          <Plug className="size-4" />
          MCP token
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{token ? "Copy your token" : "Create an MCP token"}</DialogTitle>
          <DialogDescription>
            {token
              ? "This is the only time it is shown. Store it now."
              : "Lets an MCP client reach this workstation. Choose what it may do."}
          </DialogDescription>
        </DialogHeader>

        {token ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <code className="bg-muted min-w-0 flex-1 truncate rounded border p-2 font-mono text-xs">
                {token}
              </code>
              <Button size="icon" variant="outline" onClick={copy} aria-label="Copy token">
                <Copy className="size-4" />
              </Button>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Claude Code</Label>
              <code className="bg-muted block overflow-x-auto rounded border p-2 font-mono text-[11px] whitespace-pre">
                {`claude mcp add --transport http jarvis ${
                  typeof window === "undefined" ? "" : window.location.origin
                }/api/mcp --header "Authorization: Bearer ${token}"`}
              </code>
            </div>

            <p className="text-muted-foreground flex items-start gap-1.5 text-xs">
              <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
              Anyone holding this token has the access you just granted. Revoke it from the device list
              if it leaks.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="token-name">Name</Label>
              <Input
                id="token-name"
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
          </div>
        )}

        <DialogFooter>
          {token ? (
            <Button onClick={() => setOpen(false)}>
              <Check className="size-4" />
              Done
            </Button>
          ) : (
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
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
