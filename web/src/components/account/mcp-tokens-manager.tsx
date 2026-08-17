"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import {
  AlertCircle,
  ArrowLeft,
  Check,
  Copy,
  MoreHorizontal,
  Pencil,
  Plus,
  ShieldOff,
  SlidersHorizontal,
  Trash2,
  X,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { LoadingButton } from "~/components/common/loading-button";
import { DeviceAccessForm } from "~/components/devices/device-access-form";
import { levelsFrom, ScopeMatrix, toScopes } from "~/components/devices/scope-matrix";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "~/components/ui/empty";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { RadioGroup, RadioGroupItem } from "~/components/ui/radio-group";
import { ScrollArea } from "~/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "~/components/ui/select";
import { Separator } from "~/components/ui/separator";
import { Skeleton } from "~/components/ui/skeleton";
import { Switch } from "~/components/ui/switch";
import { devicesApi, type DeviceRow } from "~/lib/api/blueprint-versions";
import { useWorkstationBlueprints } from "~/lib/workstation-blueprints";
import { useActiveWorkstation, useListWorkstations } from "~/lib/workstation-hooks";

/**
 * Everything you can do to an MCP token: see it, rename it, re-scope it, kill it, forget it.
 *
 * List-first rather than create-first. A token is a long-lived credential, so the question you
 * arrive with is almost always "what is already out there" — minting a new one is the rarer
 * path and lives one click in.
 *
 * The four views swap in place instead of stacking overlays. This component is rendered both
 * inline in the account dialog's MCP tab and inside a dialog of its own on the settings page,
 * and a sheet or an alert dialog opened from within a modal traps focus in the wrong layer. One
 * state machine, no second layer, identical behaviour in both hosts.
 *
 * MCP tokens are not their own entity — they are `device` rows with `platform = "mcp"` — so
 * every call here goes through `devicesApi`.
 */

const DEFAULT_SCOPES = ["workstations:read", "automations:read", "blueprints:read"];

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  active: "default",
  revoked: "destructive",
};

type View =
  | { kind: "list" }
  | { kind: "create" }
  | { kind: "reveal"; token: string }
  | { kind: "access"; device: DeviceRow };

/** Which destructive question a row is currently asking, if any. */
type Pending = { id: string; action: "revoke" | "delete" };

const copy = async (value: string, what: string) => {
  try {
    await navigator.clipboard.writeText(value);
    toast.success(`${what} copied`);
  } catch {
    toast.error("Could not copy — select it and copy by hand");
  }
};

export function McpTokensManager() {
  const { data: workstations } = useListWorkstations();
  const { data: activeWorkstation } = useActiveWorkstation();
  const queryClient = useQueryClient();

  const [workstationId, setWorkstationId] = useState<string | null>(null);
  const chosenWorkstation = workstationId ?? activeWorkstation?.id ?? workstations?.[0]?.id ?? null;

  const blueprints = useWorkstationBlueprints(chosenWorkstation ?? undefined);

  const [view, setView] = useState<View>({ kind: "list" });
  const [showRevoked, setShowRevoked] = useState(false);
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);

  // Create-form state. Kept at this level so cancelling out to the list and coming back does
  // not silently lose a half-filled form.
  const [name, setName] = useState("");
  const [levels, setLevels] = useState(() => levelsFrom(DEFAULT_SCOPES));
  const [scope, setScope] = useState<"all" | "some">("all");
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  const scopes = toScopes(levels);
  const queryKey = ["workstation", chosenWorkstation, "mcp-tokens"];

  // Unfiltered by status: the "Show revoked" switch decides what is displayed, so a user can
  // confirm a leaked token really is dead rather than merely absent from a list.
  const { data: tokens, isPending } = useQuery({
    queryKey,
    enabled: Boolean(chosenWorkstation),
    queryFn: async () =>
      (await devicesApi.list(chosenWorkstation!)).filter((device) => device.platform === "mcp"),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey });

  const resetForm = () => {
    setName("");
    setLevels(levelsFrom(DEFAULT_SCOPES));
    setScope("all");
    setChosen(new Set());
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
      resetForm();
      setView({ kind: "reveal", token: result.token });
      void invalidate();
    } catch {
      toast.error("Could not create the token");
    } finally {
      setSaving(false);
    }
  };

  const commitRename = async (device: DeviceRow) => {
    const next = renaming?.value.trim() ?? "";
    if (!next || next === device.name) {
      setRenaming(null);
      return;
    }
    setBusy(true);
    try {
      await devicesApi.rename(device.id, next);
      toast.success(`Renamed to ${next}`);
      setRenaming(null);
      void invalidate();
    } catch {
      toast.error("Could not rename that token");
    } finally {
      setBusy(false);
    }
  };

  const confirmPending = async (device: DeviceRow) => {
    if (!pending) return;
    setBusy(true);
    try {
      if (pending.action === "revoke") {
        await devicesApi.revoke(device.id);
        toast.success(`${device.name} revoked`);
      } else {
        await devicesApi.remove(device.id);
        toast.success(`${device.name} deleted`);
      }
      setPending(null);
      void invalidate();
    } catch {
      toast.error(
        pending.action === "revoke" ? "Could not revoke that token" : "Could not delete that token",
      );
    } finally {
      setBusy(false);
    }
  };

  if (!chosenWorkstation) {
    return (
      <p className="text-muted-foreground text-sm">
        Create a workstation first — a token is always bound to one.
      </p>
    );
  }

  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const visible = (tokens ?? []).filter((device) => showRevoked || device.status !== "revoked");
  const revokedCount = (tokens ?? []).filter((device) => device.status === "revoked").length;

  if (view.kind === "reveal") {
    return (
      <div className="space-y-3">
        <div className="space-y-1">
          <Label className="text-xs">Your token — shown once</Label>
          <div className="flex items-center gap-2">
            <code className="bg-muted min-w-0 flex-1 truncate rounded border p-2 font-mono text-xs">
              {view.token}
            </code>
            <Button
              size="icon"
              variant="outline"
              onClick={() => copy(view.token, "Token")}
              aria-label="Copy token"
            >
              <Copy className="size-4" />
            </Button>
          </div>
        </div>

        <div className="space-y-1">
          <Label className="text-xs">Add it to Claude Code</Label>
          <code className="bg-muted block overflow-x-auto rounded border p-2 font-mono text-[11px] whitespace-pre">
            {`claude mcp add --transport http jarvis ${origin}/api/mcp --header "Authorization: Bearer ${view.token}"`}
          </code>
        </div>

        <p className="text-muted-foreground flex items-start gap-1.5 text-xs">
          <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
          Anyone holding this token has the access you just granted. Revoke it from the list if it
          leaks.
        </p>

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={() => setView({ kind: "create" })}>
            Create another
          </Button>
          <Button onClick={() => setView({ kind: "list" })}>Done</Button>
        </div>
      </div>
    );
  }

  if (view.kind === "access") {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" onClick={() => setView({ kind: "list" })}>
          <ArrowLeft className="size-4" />
          Back to tokens
        </Button>
        <div className="space-y-0.5">
          <p className="text-sm font-medium">Access for {view.device.name}</p>
          <p className="text-muted-foreground text-xs">Enforced on every request this token makes.</p>
        </div>
        <Separator />
        <DeviceAccessForm
          device={view.device}
          blueprints={blueprints}
          onCancel={() => setView({ kind: "list" })}
          onSaved={() => {
            void invalidate();
            setView({ kind: "list" });
          }}
        />
      </div>
    );
  }

  if (view.kind === "create") {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" onClick={() => setView({ kind: "list" })}>
          <ArrowLeft className="size-4" />
          Back to tokens
        </Button>

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

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={() => setView({ kind: "list" })}>
            Cancel
          </Button>
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
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-48 flex-1 space-y-2">
          <Label htmlFor="mcp-workstation">Workstation</Label>
          <Select value={chosenWorkstation} onValueChange={setWorkstationId}>
            <SelectTrigger id="mcp-workstation" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(workstations ?? []).map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button
          size="sm"
          onClick={() => {
            setPending(null);
            setRenaming(null);
            setView({ kind: "create" });
          }}
        >
          <Plus className="size-4" />
          New token
        </Button>
      </div>

      {revokedCount > 0 && (
        <div className="flex items-center gap-2">
          <Switch id="mcp-show-revoked" checked={showRevoked} onCheckedChange={setShowRevoked} />
          <Label htmlFor="mcp-show-revoked" className="text-muted-foreground font-normal">
            Show revoked ({revokedCount})
          </Label>
        </div>
      )}

      {isPending ? (
        <div className="space-y-2">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      ) : visible.length === 0 ? (
        <Empty className="border-none">
          <EmptyHeader>
            <EmptyTitle>No MCP tokens yet</EmptyTitle>
            <EmptyDescription>
              A token lets an MCP client — Claude Code, Cursor, the JARVIS TUI — reach this
              workstation, with its own read/write rights per area.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button size="sm" onClick={() => setView({ kind: "create" })}>
              <Plus className="size-4" />
              New token
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <div className="space-y-2">
          {visible.map((device) => {
            const revoked = device.status === "revoked";
            const asking = pending?.id === device.id ? pending : null;

            return (
              <div
                key={device.id}
                className={`space-y-2 rounded-md border p-3 ${revoked ? "opacity-60" : ""}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1 space-y-1">
                    {renaming?.id === device.id ? (
                      <form
                        className="flex items-center gap-1.5"
                        onSubmit={(event) => {
                          event.preventDefault();
                          void commitRename(device);
                        }}
                      >
                        <Input
                          autoFocus
                          className="h-8"
                          value={renaming.value}
                          maxLength={64}
                          aria-label={`Rename ${device.name}`}
                          onChange={(event) => setRenaming({ id: device.id, value: event.target.value })}
                          onKeyDown={(event) => {
                            if (event.key === "Escape") setRenaming(null);
                          }}
                        />
                        {/* Explicit save and cancel rather than save-on-blur: clicking the cancel
                            control blurs the input first, and a blur that saves would make cancel
                            do the opposite of what it says. */}
                        <Button
                          type="submit"
                          size="icon"
                          variant="ghost"
                          className="size-8 shrink-0"
                          disabled={busy}
                          aria-label="Save name"
                        >
                          <Check className="size-4" />
                        </Button>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="size-8 shrink-0"
                          onClick={() => setRenaming(null)}
                          aria-label="Cancel rename"
                        >
                          <X className="size-4" />
                        </Button>
                      </form>
                    ) : (
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-sm font-medium">{device.name}</span>
                        <Badge variant={STATUS_VARIANT[device.status] ?? "outline"} className="text-[10px]">
                          {device.status}
                        </Badge>
                        <code className="text-muted-foreground font-mono text-[11px]">
                          {device.tokenPrefix ?? "—"}…
                        </code>
                      </div>
                    )}

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

                    <p className="text-muted-foreground text-xs">
                      {device.lastSeenAt
                        ? `Last used ${formatDistanceToNow(new Date(device.lastSeenAt), { addSuffix: true })}`
                        : "Never used"}
                    </p>
                  </div>

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" aria-label={`Actions for ${device.name}`}>
                        <MoreHorizontal className="size-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onClick={() => {
                          setPending(null);
                          setRenaming({ id: device.id, value: device.name });
                        }}
                      >
                        <Pencil className="size-4" />
                        Rename
                      </DropdownMenuItem>
                      <DropdownMenuItem disabled={revoked} onClick={() => setView({ kind: "access", device })}>
                        <SlidersHorizontal className="size-4" />
                        Manage access
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => copy(device.id, "Token id")}>
                        <Copy className="size-4" />
                        Copy id
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        variant="destructive"
                        disabled={revoked}
                        onClick={() => {
                          setRenaming(null);
                          setPending({ id: device.id, action: "revoke" });
                        }}
                      >
                        <ShieldOff className="size-4" />
                        Revoke
                      </DropdownMenuItem>
                      {revoked && (
                        <DropdownMenuItem
                          variant="destructive"
                          onClick={() => {
                            setRenaming(null);
                            setPending({ id: device.id, action: "delete" });
                          }}
                        >
                          <Trash2 className="size-4" />
                          Delete permanently
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                {/* Confirmation inline in the row rather than in an alert dialog: this component
                    may already be inside a modal, and it keeps the token you are about to destroy
                    visible while you decide. */}
                {asking && (
                  <div className="bg-muted/50 flex flex-wrap items-center justify-between gap-2 rounded border p-2">
                    <p className="text-xs">
                      {asking.action === "revoke"
                        ? "Revoke this token? It stops working on its very next request."
                        : "Delete this record for good? Past pushes stay in the history, unattributed."}
                    </p>
                    <div className="flex gap-2">
                      <Button size="sm" variant="ghost" onClick={() => setPending(null)}>
                        Cancel
                      </Button>
                      <LoadingButton
                        size="sm"
                        variant="destructive"
                        isLoading={busy}
                        onClick={() => void confirmPending(device)}
                      >
                        {asking.action === "revoke" ? "Revoke" : "Delete"}
                      </LoadingButton>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
