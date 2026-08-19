"use client";

import { fitStroke, type StrokePoint } from "@blueprint/fit.ts";
import { applyOps } from "@blueprint/ops.ts";
import type { Entity, Pt } from "@blueprint/schema.ts";
import {
  ArrowLeft,
  Grid3x3,
  History,
  Loader2,
  Magnet,
  Maximize2,
  Redo2,
  Save,
  Trash2,
  Undo2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import React from "react";
import { toast } from "sonner";

import { Alert, AlertDescription } from "~/components/ui/alert";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Skeleton } from "~/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";
import { BlueprintCanvas, entitiesWithin, type CanvasPointer, type CanvasView } from "./canvas";
import { CheckPanel } from "./editor/check-panel";
import { LayersPanel } from "./editor/layers-panel";
import { PropertiesPanel } from "./editor/properties-panel";
import { SymbolPalette, symbolOps, type SymbolPlacement } from "./editor/symbol-palette";
import { EditorToolbar, TOOLS, type Tool } from "./editor/toolbar";
import { useEditorDoc } from "./editor/use-editor-doc";

type Props = { blueprintId: string; userId: string; workstationId: string };

const angleOf = (from: Pt, to: Pt) => (Math.atan2(to[1] - from[1], to[0] - from[0]) * 180) / Math.PI;
const round2 = (value: number) => Math.round(value * 100) / 100;

export function BlueprintEditor({ blueprintId, userId, workstationId }: Props) {
  const router = useRouter();
  const editor = useEditorDoc(blueprintId);
  const { doc, base, push, undo, redo, save } = editor;

  const [tool, setTool] = React.useState<Tool>("select");
  const [selection, setSelection] = React.useState<Set<string>>(new Set());
  const [layerChoice, setLayerChoice] = React.useState<string | null>(null);
  const [hiddenLayers, setHiddenLayers] = React.useState<Set<string>>(new Set());
  const [snap, setSnap] = React.useState(true);
  const [showGrid, setShowGrid] = React.useState(true);
  const [canvasView, setCanvasView] = React.useState<CanvasView>({ scale: 1, x: 0, y: 0, step: 10 });
  const [panning, setPanning] = React.useState(false);
  const [fitKey, setFitKey] = React.useState(0);
  // An override rather than a synced copy: the loaded name is the source of truth until
  // the user types over it, which is also exactly what "renamed" means for the save button.
  const [nameOverride, setNameOverride] = React.useState<string | null>(null);
  const [placement, setPlacement] = React.useState<SymbolPlacement | null>(null);
  const [tab, setTab] = React.useState("properties");
  const [cursor, setCursor] = React.useState<Pt | null>(null);

  // In-progress gesture. A ref, not state: it changes on every pointer move and nothing
  // renders from it directly.
  const gesture = React.useRef<{ from: Pt; stroke: StrokePoint[] } | null>(null);
  /** Ids being dragged. State, not part of the ref, because the live preview renders from it. */
  const [moving, setMoving] = React.useState<string[] | null>(null);
  const [preview, setPreview] = React.useState<Entity | null>(null);
  const [marquee, setMarquee] = React.useState<[Pt, Pt] | null>(null);
  const [dragDelta, setDragDelta] = React.useState<Pt | null>(null);
  const [poly, setPoly] = React.useState<Pt[]>([]);
  const [arcPending, setArcPending] = React.useState<{ c: Pt; r: number; a0: number } | null>(null);
  const [textAt, setTextAt] = React.useState<Pt | null>(null);
  const [textDraft, setTextDraft] = React.useState("");
  const placedCount = React.useRef(0);

  const name = nameOverride ?? base?.name ?? "";
  // A layer can be deleted out from under the choice, so it falls back rather than pointing
  // at nothing and silently dropping every new shape.
  const activeLayer =
    doc?.layers.some((layer) => layer.id === layerChoice) && layerChoice
      ? layerChoice
      : (doc?.layers[0]?.id ?? "l0");

  // A drag moves the selection live without touching the journal — the single `move` op is
  // pushed on release, so one drag is one undo step.
  const shown = React.useMemo(() => {
    if (!doc) return null;
    if (!dragDelta || !moving?.length) return doc;
    try {
      return applyOps(doc, [{ op: "move", ids: moving, by: dragDelta }]).doc;
    } catch {
      return doc;
    }
  }, [doc, dragDelta, moving]);

  const layerCounts = React.useMemo(() => {
    const counts = new Map<string, number>();
    for (const entity of doc?.entities ?? []) {
      counts.set(entity.layer ?? "", (counts.get(entity.layer ?? "") ?? 0) + 1);
    }
    return counts;
  }, [doc]);

  const step = canvasView.step;
  const snapPoint = React.useCallback(
    (point: Pt): Pt => (snap ? [Math.round(point[0] / step) * step, Math.round(point[1] / step) * step] : point),
    [snap, step],
  );

  const clearGesture = React.useCallback(() => {
    gesture.current = null;
    setPreview(null);
    setMarquee(null);
    setDragDelta(null);
    setMoving(null);
  }, []);

  const cancelAll = React.useCallback(() => {
    clearGesture();
    setPoly([]);
    setArcPending(null);
    setTextAt(null);
    setPlacement(null);
  }, [clearGesture]);

  /** Text is authored at a size that reads on this sheet, not at a fixed number of units. */
  const textSize = React.useMemo(() => (doc ? Math.max(0.5, round2(doc.viewBox[3] / 50)) : 4), [doc]);

  const commitText = () => {
    const at = textAt;
    const value = textDraft.trim();
    setTextAt(null);
    setTextDraft("");
    if (!at || !value) return;
    push({ op: "add", entity: { type: "text", at, text: value, size: textSize, layer: activeLayer } });
  };

  // ─── pointer ───────────────────────────────────────────────────────────────────────

  const onDown = (pointer: CanvasPointer) => {
    if (!doc) return;
    const at = snapPoint(pointer.at);

    if (tool === "symbol") {
      if (!placement) return toast.info("Pick a symbol from the panel first");
      placedCount.current += 1;
      const ops = symbolOps(placement, at, activeLayer, placedCount.current);
      if (!ops) return toast.error(`No symbol called ${placement.name}`);
      push(...ops);
      return;
    }

    if (tool === "text") {
      setTextAt(at);
      setTextDraft("");
      return;
    }

    if (tool === "polyline") {
      setPoly((current) => [...current, at]);
      return;
    }

    if (tool === "arc" && arcPending) {
      const a1 = angleOf(arcPending.c, at);
      push({
        op: "add",
        entity: { type: "arc", c: arcPending.c, r: arcPending.r, a0: arcPending.a0, a1, layer: activeLayer },
      });
      setArcPending(null);
      setPreview(null);
      return;
    }

    if (tool === "select") {
      if (pointer.hit) {
        const next = new Set(pointer.shift ? selection : []);
        if (pointer.shift && selection.has(pointer.hit)) next.delete(pointer.hit);
        else next.add(pointer.hit);
        gesture.current = { from: at, stroke: [] };
        if (!pointer.shift && selection.has(pointer.hit)) {
          // Dragging an existing multi-selection should move all of it, not collapse it.
          setMoving([...selection]);
          return;
        }
        setSelection(next);
        setMoving([...next]);
        return;
      }
      if (!pointer.shift) setSelection(new Set());
      gesture.current = { from: at, stroke: [] };
      setMoving(null);
      setMarquee([at, at]);
      return;
    }

    gesture.current = { from: at, stroke: [{ x: pointer.at[0], y: pointer.at[1], t: performance.now() }] };
  };

  const onMove = (pointer: CanvasPointer) => {
    setCursor(pointer.at);
    const active = gesture.current;

    if (tool === "polyline" && poly.length > 0) {
      const at = snapPoint(pointer.at);
      setPreview({ type: "polyline", pts: [...poly, at], layer: activeLayer });
      return;
    }

    if (tool === "arc" && arcPending) {
      const at = pointer.at;
      let a1 = angleOf(arcPending.c, at);
      // Arcs sweep in increasing-angle order, so an end angle behind the start would draw
      // the long way round or nothing at all.
      if (a1 <= arcPending.a0) a1 += 360;
      setPreview({ type: "arc", c: arcPending.c, r: arcPending.r, a0: arcPending.a0, a1, layer: activeLayer });
      return;
    }

    if (!active) return;
    const at = snapPoint(pointer.at);

    if (moving) {
      setDragDelta([at[0] - active.from[0], at[1] - active.from[1]]);
      return;
    }
    if (tool === "select") {
      setMarquee([active.from, at]);
      return;
    }
    if (tool === "freehand") {
      active.stroke.push({ x: pointer.at[0], y: pointer.at[1], t: performance.now() });
      const fitted = fitStroke(active.stroke, { tool: "auto", snapGrid: snap ? step : 0 });
      setPreview(fitted ? { ...fitted, layer: activeLayer } : null);
      return;
    }
    setPreview(shapeFrom(tool, active.from, at, activeLayer));
  };

  const onUp = (pointer: CanvasPointer) => {
    const active = gesture.current;
    if (!active || !doc) return;
    const at = snapPoint(pointer.at);

    if (moving) {
      const by: Pt = [at[0] - active.from[0], at[1] - active.from[1]];
      if (by[0] !== 0 || by[1] !== 0) push({ op: "move", ids: moving, by });
      clearGesture();
      return;
    }

    if (tool === "select") {
      const box = marquee;
      if (box) {
        const found = entitiesWithin(doc, box[0], box[1]);
        if (found.length > 0) {
          setSelection((current) => (pointer.shift ? new Set([...current, ...found]) : new Set(found)));
        }
      }
      clearGesture();
      return;
    }

    if (tool === "arc") {
      const r = Math.hypot(at[0] - active.from[0], at[1] - active.from[1]);
      clearGesture();
      if (r <= 0) return;
      setArcPending({ c: active.from, r, a0: angleOf(active.from, at) });
      return;
    }

    if (tool === "freehand") {
      const fitted = fitStroke(active.stroke, { tool: "auto", snapGrid: snap ? step : 0 });
      clearGesture();
      if (fitted) push({ op: "add", entity: { ...fitted, layer: activeLayer } });
      return;
    }

    const entity = shapeFrom(tool, active.from, at, activeLayer);
    clearGesture();
    if (entity) push({ op: "add", entity });
  };

  const onDoubleClick = () => {
    if (tool === "polyline" && poly.length >= 2) finishPolyline();
  };

  const finishPolyline = React.useCallback(
    (closed = false) => {
      if (poly.length >= 2) push({ op: "add", entity: { type: "polyline", pts: poly, closed, layer: activeLayer } });
      setPoly([]);
      setPreview(null);
    },
    [poly, push, activeLayer],
  );

  // ─── keyboard ──────────────────────────────────────────────────────────────────────

  const deleteSelection = React.useCallback(() => {
    if (selection.size === 0) return;
    push({ op: "delete", ids: [...selection] });
    setSelection(new Set());
  }, [selection, push]);

  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;

      if (event.key === " " && !event.repeat) {
        setPanning(true);
        event.preventDefault();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void save({ name });
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "a") {
        event.preventDefault();
        setSelection(new Set((doc?.entities ?? []).map((entity) => entity.id!)));
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      if (event.key === "Escape") return cancelAll();
      if (event.key === "Enter" && poly.length >= 2) return finishPolyline();
      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        return deleteSelection();
      }
      if (event.key.startsWith("Arrow") && selection.size > 0) {
        event.preventDefault();
        const distance = step * (event.shiftKey ? 10 : 1);
        const by: Pt =
          event.key === "ArrowLeft"
            ? [-distance, 0]
            : event.key === "ArrowRight"
              ? [distance, 0]
              : event.key === "ArrowUp"
                ? [0, -distance]
                : [0, distance];
        push({ op: "move", ids: [...selection], by });
        return;
      }
      const found = TOOLS.find((entry) => entry.key === event.key.toLowerCase());
      if (found) {
        cancelAll();
        setTool(found.id);
        if (found.id === "symbol") setTab("symbols");
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === " ") setPanning(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [cancelAll, deleteSelection, doc, finishPolyline, name, poly.length, push, redo, save, selection, step, undo]);

  const dirty = editor.dirty || (base ? name !== base.name : false);

  React.useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  // ─── render ────────────────────────────────────────────────────────────────────────

  if (editor.loading) {
    return (
      <div className="flex h-full flex-col gap-3 p-3">
        <Skeleton className="h-14 w-full" />
        <div className="flex flex-1 gap-3">
          <Skeleton className="w-12" />
          <Skeleton className="flex-1" />
          <Skeleton className="w-80" />
        </div>
      </div>
    );
  }

  if (editor.error || !doc || !shown || !base) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-6">
        <p className="text-muted-foreground text-sm">{editor.error ?? "This blueprint could not be opened."}</p>
        <Button variant="outline" onClick={() => router.push("/app/blueprints")}>
          Back to blueprints
        </Button>
      </div>
    );
  }

  const [, , sheetWidth, sheetHeight] = doc.viewBox;

  return (
    <div className="flex h-full flex-col">
      <header className="bg-card flex flex-wrap items-center gap-3 border-b px-4 py-2.5">
        <Button variant="ghost" size="sm" onClick={() => router.push("/app/blueprints")}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Blueprints
        </Button>

        <Input
          value={name}
          onChange={(event) => setNameOverride(event.target.value)}
          className="h-8 w-56 font-medium"
          aria-label="Blueprint name"
        />

        <div className="text-muted-foreground flex items-center gap-2 text-xs">
          <Badge variant="secondary" className="font-mono">
            v{base.version}
          </Badge>
          <span>
            {round2(sheetWidth)} × {round2(sheetHeight)} {doc.units ?? "mm"}
          </span>
          {dirty && (
            <span className="text-amber-500">
              ● {editor.pendingCount} unsaved change{editor.pendingCount === 1 ? "" : "s"}
            </span>
          )}
        </div>

        <div className="ml-auto flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={undo} disabled={!editor.canUndo}>
                <Undo2 className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Undo · ⌘Z</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={redo} disabled={!editor.canRedo}>
                <Redo2 className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Redo · ⇧⌘Z</TooltipContent>
          </Tooltip>
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              router.push(`/app/blueprints/${workstationId}/${blueprintId}/${userId}/history`)
            }
          >
            <History className="mr-2 h-4 w-4" />
            History
          </Button>
          <Button size="sm" onClick={() => void save({ name })} disabled={!dirty || editor.saving}>
            {editor.saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Save
          </Button>
        </div>
      </header>

      {base.legacy && (
        <Alert className="rounded-none border-x-0 border-t-0">
          <AlertDescription className="text-xs">
            This drawing was made in the old web editor. It has been converted so it can be edited,
            versioned and synced — saving stores the converted version, and the original stays in
            history.
          </AlertDescription>
        </Alert>
      )}

      <div className="flex min-h-0 flex-1 gap-3 p-3">
        <EditorToolbar tool={tool} onToolChange={(next) => { cancelAll(); setTool(next); if (next === "symbol") setTab("symbols"); }} />

        <div className="bg-card relative min-w-0 flex-1 overflow-hidden rounded-md border">
          <BlueprintCanvas
            doc={shown}
            interactive
            selection={selection}
            preview={preview}
            marquee={marquee}
            panning={panning}
            hiddenLayers={hiddenLayers}
            showGrid={showGrid}
            fitKey={fitKey}
            onViewChange={setCanvasView}
            onCanvasPointerDown={onDown}
            onCanvasPointerMove={onMove}
            onCanvasPointerUp={onUp}
            onCanvasDoubleClick={onDoubleClick}
            cursor={tool === "select" ? "default" : "crosshair"}
          />

          {textAt && (
            <Input
              autoFocus
              value={textDraft}
              placeholder="Type, then Enter"
              onChange={(event) => setTextDraft(event.target.value)}
              onBlur={commitText}
              onKeyDown={(event) => {
                if (event.key === "Enter") commitText();
                if (event.key === "Escape") {
                  setTextAt(null);
                  setTextDraft("");
                }
              }}
              className="absolute h-8 w-48"
              style={{
                left: textAt[0] * canvasView.scale + canvasView.x,
                top: textAt[1] * canvasView.scale + canvasView.y - 16,
              }}
            />
          )}

          <div className="bg-background/80 absolute top-2 right-2 flex items-center gap-1 rounded-md border p-1 backdrop-blur">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant={snap ? "secondary" : "ghost"}
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => setSnap((current) => !current)}
                >
                  <Magnet className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Snap to grid ({round2(step)} {doc.units ?? "mm"})</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant={showGrid ? "secondary" : "ghost"}
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => setShowGrid((current) => !current)}
                >
                  <Grid3x3 className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Show grid</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setFitKey((n) => n + 1)}>
                  <Maximize2 className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Fit to sheet</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={deleteSelection}
                  disabled={selection.size === 0}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Delete selection · ⌫</TooltipContent>
            </Tooltip>
          </div>

          <div className="text-muted-foreground bg-background/80 absolute bottom-2 left-2 flex items-center gap-3 rounded-md border px-2 py-1 text-[11px] tabular-nums backdrop-blur">
            <span>
              {cursor ? `${round2(cursor[0])}, ${round2(cursor[1])}` : "—"} {doc.units ?? "mm"}
            </span>
            <span>{Math.round(canvasView.scale * 100)}%</span>
            {selection.size > 0 && <span>{selection.size} selected</span>}
            {poly.length > 0 && <span>{poly.length} points · Enter to finish</span>}
            {arcPending && <span>Click to set the arc’s end</span>}
          </div>
        </div>

        <aside className="bg-card flex w-80 shrink-0 flex-col rounded-md border">
          <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col">
            <TabsList className="m-2 grid grid-cols-4">
              <TabsTrigger value="properties" className="text-xs">
                Object
              </TabsTrigger>
              <TabsTrigger value="layers" className="text-xs">
                Layers
              </TabsTrigger>
              <TabsTrigger value="symbols" className="text-xs">
                Symbols
              </TabsTrigger>
              <TabsTrigger value="check" className="text-xs">
                Check
              </TabsTrigger>
            </TabsList>
            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              <TabsContent value="properties" className="mt-0">
                <PropertiesPanel doc={doc} selection={selection} onOps={push} />
              </TabsContent>
              <TabsContent value="layers" className="mt-0">
                <LayersPanel
                  doc={doc}
                  activeLayer={activeLayer}
                  onActiveLayerChange={setLayerChoice}
                  hiddenLayers={hiddenLayers}
                  onToggleHidden={(id) =>
                    setHiddenLayers((current) => {
                      const next = new Set(current);
                      if (next.has(id)) next.delete(id);
                      else next.add(id);
                      return next;
                    })
                  }
                  onOps={push}
                  counts={layerCounts}
                />
              </TabsContent>
              <TabsContent value="symbols" className="mt-0">
                <SymbolPalette
                  placement={placement}
                  onPlacementChange={(next) => {
                    setPlacement(next);
                    if (next) setTool("symbol");
                  }}
                />
              </TabsContent>
              <TabsContent value="check" className="mt-0">
                <CheckPanel doc={doc} onSelect={(id) => setSelection(new Set([id]))} />
              </TabsContent>
            </div>
          </Tabs>
        </aside>
      </div>
    </div>
  );
}

/** The entity a drag from `from` to `to` describes, or null when it describes nothing. */
function shapeFrom(tool: Tool, from: Pt, to: Pt, layer: string): Entity | null {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  switch (tool) {
    case "line":
      return dx === 0 && dy === 0 ? null : { type: "line", a: from, b: to, layer };
    case "rect": {
      const w = Math.abs(dx);
      const h = Math.abs(dy);
      if (w === 0 || h === 0) return null;
      return { type: "rect", at: [Math.min(from[0], to[0]), Math.min(from[1], to[1])], w, h, layer };
    }
    case "circle": {
      const r = Math.hypot(dx, dy);
      return r > 0 ? { type: "circle", c: from, r, layer } : null;
    }
    case "dimension": {
      const length = Math.hypot(dx, dy);
      if (length === 0) return null;
      // A dimension with no offset sits on top of the thing it measures, which the checker
      // flags — so it starts a readable distance away and is adjustable from the panel.
      return { type: "dimension", a: from, b: to, offset: Math.max(length * 0.15, 2), layer };
    }
    default:
      return null;
  }
}

export default BlueprintEditor;
