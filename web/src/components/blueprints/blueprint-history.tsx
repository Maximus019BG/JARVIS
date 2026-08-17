"use client";

import type { BlueprintDoc } from "@blueprint/schema.ts";
import { formatDistanceToNow } from "date-fns";
import {
  Crosshair,
  Cpu,
  GitCommitHorizontal,
  GitCompare,
  Loader2,
  RotateCcw,
  Grid3x3,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { BlueprintCanvas, type DiffTint } from "~/components/blueprints/canvas";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { ButtonGroup } from "~/components/ui/button-group";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "~/components/ui/empty";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "~/components/ui/resizable";
import { ScrollArea } from "~/components/ui/scroll-area";
import { Separator } from "~/components/ui/separator";
import { Skeleton } from "~/components/ui/skeleton";
import { Switch } from "~/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";
import {
  blueprintVersionsApi,
  type DiffResponse,
  type VersionRow,
} from "~/lib/api/blueprint-versions";
import { typeToConfirm } from "~/lib/type-to-confirm-store";

const refOf = (row: VersionRow) => row.commitSha ?? `v${row.version}`;

const TINT_LABEL: { tint: DiffTint; label: string; className: string }[] = [
  { tint: "added", label: "added", className: "text-emerald-600 dark:text-emerald-400" },
  { tint: "removed", label: "removed", className: "text-red-600 dark:text-red-400" },
  { tint: "modified", label: "modified", className: "text-amber-600 dark:text-amber-400" },
];

export function BlueprintHistory({ blueprintId }: { blueprintId: string }) {
  const router = useRouter();

  const [versions, setVersions] = useState<VersionRow[] | null>(null);
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [compareWith, setCompareWith] = useState<string | null>(null);
  const [doc, setDoc] = useState<BlueprintDoc | null>(null);
  const [diff, setDiff] = useState<DiffResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [showUnchanged, setShowUnchanged] = useState(true);
  const [showGrid, setShowGrid] = useState(true);
  const [fitKey, setFitKey] = useState(0);

  const load = useCallback(async () => {
    try {
      const data = await blueprintVersionsApi.list(blueprintId);
      setVersions(data.versions);
      setName(data.blueprint.name);
      setSelected((current) => current ?? (data.versions[0] ? refOf(data.versions[0]) : null));
    } catch {
      toast.error("Could not load history");
      setVersions([]);
    }
  }, [blueprintId]);

  useEffect(() => {
    void load();
  }, [load]);

  // One effect for both modes: two selections mean a diff, one means a single version.
  useEffect(() => {
    if (!selected) return;
    let live = true;
    setBusy(true);
    const run = async () => {
      try {
        if (compareWith && compareWith !== selected) {
          const older = versions?.find((row) => refOf(row) === compareWith);
          const newer = versions?.find((row) => refOf(row) === selected);
          // Always diff oldest -> newest, whichever order they were clicked in.
          const [a, b] =
            (older?.version ?? 0) <= (newer?.version ?? 0) ? [compareWith, selected] : [selected, compareWith];
          const result = await blueprintVersionsApi.diff(blueprintId, a, b);
          if (!live) return;
          setDiff(result);
          setDoc(result.b.doc);
        } else {
          const result = await blueprintVersionsApi.at(blueprintId, selected);
          if (!live) return;
          setDiff(null);
          setDoc(result.doc);
        }
        setFitKey((key) => key + 1);
      } catch {
        if (live) toast.error("Could not load that version");
      } finally {
        if (live) setBusy(false);
      }
    };
    void run();
    return () => {
      live = false;
    };
  }, [blueprintId, selected, compareWith, versions]);

  const tints = useMemo(() => {
    if (!diff) return undefined;
    const map = new Map<string, DiffTint>();
    for (const change of diff.changes) {
      if (change.kind === "added") map.set(change.id, "added");
      if (change.kind === "modified") map.set(change.id, "modified");
    }
    if (showUnchanged) {
      for (const entity of diff.b.doc.entities) {
        if (!map.has(entity.id!)) map.set(entity.id!, "unchanged");
      }
    }
    return map;
  }, [diff, showUnchanged]);

  const ghost = useMemo(() => {
    if (!diff) return undefined;
    const map = new Map<string, DiffTint>();
    for (const change of diff.changes) {
      if (change.kind === "removed") map.set(change.id, "removed");
      if (change.kind === "modified") map.set(change.id, "removed");
    }
    return { doc: diff.a.doc, tints: map };
  }, [diff]);

  const restore = (row: VersionRow) => {
    void typeToConfirm.show({
      title: `Restore v${row.version}?`,
      description:
        "This appends a new version holding the old content. Nothing is overwritten — the current version stays in the history, and the restore shows up as its own entry.",
      confirmText: name,
      confirmButtonText: "Restore",
      onConfirm: async () => {
        typeToConfirm.setIsLoading(true);
        try {
          const result = await blueprintVersionsApi.restore(blueprintId, refOf(row));
          toast.success(`Restored v${result.restoredFrom} as v${result.version}`);
          setCompareWith(null);
          setSelected(null);
          await load();
          router.refresh();
          typeToConfirm.close(true);
        } catch {
          toast.error("Restore failed");
        } finally {
          typeToConfirm.setIsLoading(false);
        }
      },
    });
  };

  if (versions === null) {
    return (
      <div className="space-y-3 p-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-[60vh] w-full" />
      </div>
    );
  }

  if (versions.length === 0) {
    return (
      <Empty className="m-6">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <GitCommitHorizontal />
          </EmptyMedia>
          <EmptyTitle>No history yet</EmptyTitle>
          <EmptyDescription>
            Push a blueprint from the TUI with <code className="font-mono">blueprint_sync</code> and its commits appear
            here.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  const selectedRow = versions.find((row) => refOf(row) === selected);

  return (
    // react-resizable-panels v4: `orientation`, not `direction`, and a bare number means
    // *pixels* — percentages have to be strings.
    <ResizablePanelGroup orientation="horizontal" className="min-h-[calc(100vh-8rem)]">
      <ResizablePanel defaultSize="30" minSize="22" maxSize="45">
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between gap-2 px-4 py-3">
            <span className="text-sm font-medium">{versions.length} versions</span>
            {compareWith ? (
              <Button variant="ghost" size="sm" onClick={() => setCompareWith(null)}>
                Clear compare
              </Button>
            ) : (
              <span className="text-muted-foreground text-xs">⇧-click to compare</span>
            )}
          </div>
          <Separator />
          <ScrollArea className="flex-1">
            <div className="p-2">
              {versions.map((row) => {
                const ref = refOf(row);
                const isSelected = ref === selected;
                const isCompare = ref === compareWith;
                return (
                  <button
                    key={row.id}
                    type="button"
                    onClick={(event) => {
                      if (event.shiftKey && selected && selected !== ref) setCompareWith(ref);
                      else {
                        setSelected(ref);
                        setCompareWith(null);
                      }
                    }}
                    className={`w-full rounded-md px-3 py-2.5 text-left transition-colors ${
                      isSelected
                        ? "bg-primary/10 ring-primary/30 ring-1"
                        : isCompare
                          ? "bg-primary/5 ring-primary/20 ring-1"
                          : "hover:bg-muted/60"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="font-mono text-[11px]">
                        {row.commitSha ?? `v${row.version}`}
                      </Badge>
                      {!row.commitSha && (
                        <Badge variant="secondary" className="text-[10px]">
                          web
                        </Badge>
                      )}
                      {isCompare && <span className="text-primary text-[10px] font-medium">compare</span>}
                    </div>
                    <p className="mt-1.5 truncate text-sm">{row.message ?? "(no message)"}</p>
                    <div className="text-muted-foreground mt-1 flex items-center gap-2 text-xs">
                      <span>{row.author?.name ?? "unknown"}</span>
                      <span>·</span>
                      <span>{formatDistanceToNow(new Date(row.createdAt), { addSuffix: true })}</span>
                      {row.device && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="ml-auto inline-flex items-center gap-1">
                              <Cpu className="size-3" />
                              <span className="max-w-20 truncate">{row.device.name}</span>
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>{row.device.platform ?? row.device.name}</TooltipContent>
                        </Tooltip>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </ScrollArea>
        </div>
      </ResizablePanel>

      <ResizableHandle withHandle />

      <ResizablePanel defaultSize="70">
        <div className="flex h-full flex-col">
          <div className="flex flex-wrap items-center gap-3 px-4 py-3">
            {diff ? (
              <>
                <GitCompare className="text-muted-foreground size-4" />
                <span className="text-sm">
                  v{diff.a.version} → v{diff.b.version}
                </span>
                <span className="text-muted-foreground text-sm">{diff.summary}</span>
                <div className="flex items-center gap-3">
                  {TINT_LABEL.filter((entry) => diff.counts[entry.tint] > 0).map((entry) => (
                    <span key={entry.tint} className={`text-xs font-medium ${entry.className}`}>
                      {diff.counts[entry.tint]} {entry.label}
                    </span>
                  ))}
                </div>
                <label className="text-muted-foreground ml-2 flex items-center gap-2 text-xs">
                  <Switch checked={showUnchanged} onCheckedChange={setShowUnchanged} />
                  unchanged
                </label>
              </>
            ) : (
              <>
                <GitCommitHorizontal className="text-muted-foreground size-4" />
                <span className="text-sm">
                  {selectedRow ? `v${selectedRow.version}` : "—"}{" "}
                  <span className="text-muted-foreground">{selectedRow?.message ?? ""}</span>
                </span>
              </>
            )}

            <div className="ml-auto flex items-center gap-2">
              {busy && <Loader2 className="text-muted-foreground size-4 animate-spin" />}
              <ButtonGroup>
                <Button variant="outline" size="sm" onClick={() => setFitKey((key) => key + 1)}>
                  <Crosshair className="size-4" />
                </Button>
                <Button
                  variant={showGrid ? "secondary" : "outline"}
                  size="sm"
                  onClick={() => setShowGrid((value) => !value)}
                >
                  <Grid3x3 className="size-4" />
                </Button>
              </ButtonGroup>
              {selectedRow && versions[0] && refOf(versions[0]) !== refOf(selectedRow) && (
                <Button variant="outline" size="sm" onClick={() => restore(selectedRow)}>
                  <RotateCcw className="size-4" />
                  Restore
                </Button>
              )}
            </div>
          </div>
          <Separator />
          <div className="bg-muted/20 min-h-0 flex-1">
            {doc && <BlueprintCanvas doc={doc} tints={tints} ghost={ghost} showGrid={showGrid} fitKey={fitKey} />}
          </div>
        </div>
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
