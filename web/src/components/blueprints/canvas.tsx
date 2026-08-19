"use client";

import { bbox, flatten } from "@blueprint/geom.ts";
import type { BlueprintDoc, Entity, Pt } from "@blueprint/schema.ts";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type DiffTint = "added" | "removed" | "modified" | "unchanged";

/** Resolved at draw time from CSS custom properties, so themes and dark mode just work. */
type Palette = {
  ink: string;
  muted: string;
  grid: string;
  added: string;
  removed: string;
  modified: string;
  accent: string;
};

const TINT_ALPHA: Record<DiffTint, number> = { added: 1, removed: 0.9, modified: 1, unchanged: 0.35 };

/** Where the pointer is, in document units, plus the modifiers that change what a drag means. */
export type CanvasPointer = {
  at: Pt;
  shift: boolean;
  alt: boolean;
  /** Entity under the cursor, nearest first. Undefined when the pointer is over empty sheet. */
  hit?: string;
};

/** The current view, so a caller can size its snap grid and place overlays in screen space. */
export type CanvasView = { scale: number; x: number; y: number; step: number };

export type BlueprintCanvasProps = {
  doc: BlueprintDoc;
  /** Entity id -> how to tint it. Absent means draw it normally. */
  tints?: Map<string, DiffTint>;
  /** Ghost geometry drawn underneath, used for the "before" side of a diff. */
  ghost?: { doc: BlueprintDoc; tints?: Map<string, DiffTint> };
  hiddenLayers?: Set<string>;
  showGrid?: boolean;
  className?: string;
  /** Bumping this refits the view — used by the fit-to-view button. */
  fitKey?: number;

  // --- editing. All optional: without them this is the read-only renderer it has always been.
  /** Routes left-drag to the pointer callbacks instead of panning. Pan moves to middle/right drag. */
  interactive?: boolean;
  selection?: Set<string>;
  /** The shape currently being drawn, rendered as a dashed ghost. */
  preview?: Entity | null;
  /** Rubber-band rectangle in document units. */
  marquee?: [Pt, Pt] | null;
  /** Held-space panning, decided by the editor because it owns the keyboard. */
  panning?: boolean;
  cursor?: string;
  onCanvasPointerDown?: (pointer: CanvasPointer) => void;
  onCanvasPointerMove?: (pointer: CanvasPointer) => void;
  onCanvasPointerUp?: (pointer: CanvasPointer) => void;
  onCanvasDoubleClick?: (pointer: CanvasPointer) => void;
  onViewChange?: (view: CanvasView) => void;
};

function readPalette(element: HTMLElement): Palette {
  const style = getComputedStyle(element);
  const token = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  return {
    ink: token("--foreground", "#0a0a0a"),
    muted: token("--muted-foreground", "#737373"),
    grid: token("--border", "#e5e5e5"),
    accent: token("--primary", "#0f766e"),
    added: "oklch(0.696 0.17 162.48)",
    removed: "oklch(0.637 0.237 25.331)",
    modified: "oklch(0.769 0.188 70.08)",
  };
}

/** Nice round grid step for the current zoom: 1, 2, 5, 10, 20, 50 … in document units. */
function gridStep(unitsPerPixel: number): number {
  const target = unitsPerPixel * 48;
  const magnitude = 10 ** Math.floor(Math.log10(target));
  for (const factor of [1, 2, 5]) {
    if (magnitude * factor >= target) return magnitude * factor;
  }
  return magnitude * 10;
}

/**
 * Nearest entity to a document-space point, within `tolerance` document units.
 *
 * Everything is measured against `flatten`, the same polyline approximation the renderer
 * draws — so what looks clickable is clickable, and arcs and béziers need no special case.
 */
export function hitTest(
  doc: BlueprintDoc,
  point: Pt,
  tolerance: number,
  skip?: (entity: Entity) => boolean,
): string | undefined {
  let best: { id: string; distance: number } | undefined;
  // Last drawn is topmost, so walk backwards and let a tie go to the entity on top.
  for (let index = doc.entities.length - 1; index >= 0; index -= 1) {
    const entity = doc.entities[index]!;
    if (skip?.(entity)) continue;
    let distance = Infinity;
    if (entity.type === "text") {
      distance = Math.hypot(entity.at[0] - point[0], entity.at[1] - point[1]) - (entity.size ?? 4);
    } else {
      for (const run of flatten(entity, tolerance / 2)) {
        for (let n = 1; n < run.length; n += 1) {
          distance = Math.min(distance, distanceToSegment(point, run[n - 1]!, run[n]!));
        }
        if (run.length === 1) distance = Math.min(distance, Math.hypot(run[0]![0] - point[0], run[0]![1] - point[1]));
      }
    }
    if (distance <= tolerance && (!best || distance < best.distance)) {
      best = { id: entity.id!, distance };
    }
  }
  return best?.id;
}

function distanceToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lengthSquared));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** Ids whose bounding box falls entirely inside the rectangle — marquee selection. */
export function entitiesWithin(doc: BlueprintDoc, from: Pt, to: Pt): string[] {
  const x0 = Math.min(from[0], to[0]);
  const x1 = Math.max(from[0], to[0]);
  const y0 = Math.min(from[1], to[1]);
  const y1 = Math.max(from[1], to[1]);
  return doc.entities
    .filter((entity) => {
      const box = bbox([entity]);
      return box !== undefined && box[0] >= x0 && box[1] >= y0 && box[2] <= x1 && box[3] <= y1;
    })
    .map((entity) => entity.id!);
}

export function BlueprintCanvas({
  doc,
  tints,
  ghost,
  hiddenLayers,
  showGrid = true,
  className,
  fitKey = 0,
  interactive = false,
  selection,
  preview,
  marquee,
  panning = false,
  cursor,
  onCanvasPointerDown,
  onCanvasPointerMove,
  onCanvasPointerUp,
  onCanvasDoubleClick,
  onViewChange,
}: BlueprintCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  // scale is pixels per document unit; offset is in pixels.
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  // Mirrors `view` so wheel and pan events that coalesce between renders still compose off
  // the latest value — the reason this is not a plain functional setState is that the view
  // has to be reported outward at the same moment, and an updater is no place for that.
  const viewRef = useRef(view);

  const applyView = useCallback(
    (next: { scale: number; x: number; y: number }) => {
      viewRef.current = next;
      setView(next);
      onViewChange?.({ ...next, step: gridStep(1 / next.scale) });
    },
    [onViewChange],
  );

  useEffect(() => {
    const element = wrapRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const fit = useCallback(() => {
    const [vx, vy, vw, vh] = doc.viewBox;
    if (!size.width || !size.height || !vw || !vh) return;
    const scale = Math.min(size.width / vw, size.height / vh) * 0.92;
    applyView({ scale, x: size.width / 2 - (vx + vw / 2) * scale, y: size.height / 2 - (vy + vh / 2) * scale });
  }, [doc.viewBox, size.width, size.height, applyView]);

  useEffect(fit, [fit, fitKey]);

  const layersHidden = useMemo(() => hiddenLayers ?? new Set<string>(), [hiddenLayers]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !size.width || !size.height) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(size.width * ratio);
    canvas.height = Math.round(size.height * ratio);
    const palette = readPalette(canvas);

    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, size.width, size.height);

    const toScreen = (x: number, y: number): [number, number] => [x * view.scale + view.x, y * view.scale + view.y];

    if (showGrid) {
      const step = gridStep(1 / view.scale);
      const [vx, vy, vw, vh] = doc.viewBox;
      context.save();
      context.strokeStyle = palette.grid;
      context.globalAlpha = 0.5;
      context.lineWidth = 1;
      context.beginPath();
      for (let x = Math.ceil(vx / step) * step; x <= vx + vw; x += step) {
        const [sx, top] = toScreen(x, vy);
        const [, bottom] = toScreen(x, vy + vh);
        context.moveTo(sx, top);
        context.lineTo(sx, bottom);
      }
      for (let y = Math.ceil(vy / step) * step; y <= vy + vh; y += step) {
        const [left, sy] = toScreen(vx, y);
        const [right] = toScreen(vx + vw, y);
        context.moveTo(left, sy);
        context.lineTo(right, sy);
      }
      context.stroke();
      context.restore();

      // The sheet edge, so it is obvious when geometry has wandered off the page.
      const [ox, oy] = toScreen(vx, vy);
      context.save();
      context.strokeStyle = palette.grid;
      context.lineWidth = 1.5;
      context.strokeRect(ox, oy, vw * view.scale, vh * view.scale);
      context.restore();
    }

    const layerColour = new Map(doc.layers.map((layer) => [layer.id, layer.color]));

    const drawEntity = (entity: Entity, tint: DiffTint | undefined, dashOverride: boolean) => {
      if (layersHidden.has(entity.layer ?? "")) return;
      const layer = doc.layers.find((candidate) => candidate.id === entity.layer);
      if (layer?.visible === false && !layersHidden.has(layer.id)) return;

      context.save();
      const colour =
        tint === "added"
          ? palette.added
          : tint === "removed"
            ? palette.removed
            : tint === "modified"
              ? palette.modified
              : tint === "unchanged"
                ? palette.muted
                : entity.stroke ?? layerColour.get(entity.layer ?? "") ?? palette.ink;

      context.strokeStyle = colour;
      context.fillStyle = colour;
      context.globalAlpha = tint ? TINT_ALPHA[tint] : 1;
      context.lineWidth = Math.max(1, (entity.width ?? 0.4) * view.scale);
      context.lineJoin = "round";
      context.lineCap = "round";
      if (dashOverride || entity.dash === "dashed") context.setLineDash([6, 4]);
      else if (entity.dash === "dotted") context.setLineDash([2, 3]);

      if (entity.type === "text") {
        const size = Math.max(8, (entity.size ?? 4) * view.scale);
        const [tx, ty] = toScreen(entity.at[0], entity.at[1]);
        context.translate(tx, ty);
        if (entity.angle) context.rotate((entity.angle * Math.PI) / 180);
        context.font = `${size}px ui-sans-serif, system-ui, sans-serif`;
        context.fillText(entity.text, 0, 0);
        context.restore();
        return;
      }

      context.beginPath();
      for (const run of flatten(entity, 0.5 / Math.max(view.scale, 0.01))) {
        run.forEach(([x, y], index) => {
          const [sx, sy] = toScreen(x, y);
          if (index === 0) context.moveTo(sx, sy);
          else context.lineTo(sx, sy);
        });
      }
      context.stroke();

      // Dimensions carry their measurement, or the drawing is not a blueprint.
      if (entity.type === "dimension") {
        const length = Math.hypot(entity.b[0] - entity.a[0], entity.b[1] - entity.a[1]);
        const label = entity.label ?? `${Math.round(length * 100) / 100}`;
        const nx = -(entity.b[1] - entity.a[1]) / (length || 1);
        const ny = (entity.b[0] - entity.a[0]) / (length || 1);
        const away = entity.offset + Math.sign(entity.offset || 1) * 3;
        const [lx, ly] = toScreen(
          (entity.a[0] + entity.b[0]) / 2 + nx * away,
          (entity.a[1] + entity.b[1]) / 2 + ny * away,
        );
        context.setLineDash([]);
        context.font = `${Math.max(9, 3 * view.scale)}px ui-sans-serif, system-ui, sans-serif`;
        context.textAlign = "center";
        context.fillText(label, lx, ly);
      }
      context.restore();
    };

    // Selection reads as a halo *under* the geometry: an overlay on top would hide the very
    // strokes the user is about to edit.
    if (selection?.size) {
      context.save();
      context.strokeStyle = palette.accent;
      context.globalAlpha = 0.3;
      context.lineJoin = "round";
      context.lineCap = "round";
      for (const entity of doc.entities) {
        if (!selection.has(entity.id!) || layersHidden.has(entity.layer ?? "")) continue;
        context.lineWidth = Math.max(6, (entity.width ?? 0.4) * view.scale + 6);
        context.beginPath();
        if (entity.type === "text") {
          const [tx, ty] = toScreen(entity.at[0], entity.at[1]);
          context.arc(tx, ty, 8, 0, Math.PI * 2);
        } else {
          for (const run of flatten(entity, 0.5 / Math.max(view.scale, 0.01))) {
            run.forEach(([x, y], index) => {
              const [sx, sy] = toScreen(x, y);
              if (index === 0) context.moveTo(sx, sy);
              else context.lineTo(sx, sy);
            });
          }
        }
        context.stroke();
      }
      context.restore();
    }

    // Ghost first: removed geometry belongs behind whatever replaced it.
    if (ghost) {
      for (const entity of ghost.doc.entities) {
        const tint = ghost.tints?.get(entity.id!);
        if (tint) drawEntity(entity, tint, tint === "removed");
      }
    }
    for (const entity of doc.entities) drawEntity(entity, tints?.get(entity.id!), false);

    if (selection?.size) {
      const box = bbox(doc.entities.filter((entity) => selection.has(entity.id!)));
      if (box) {
        const [x0, y0] = toScreen(box[0], box[1]);
        const [x1, y1] = toScreen(box[2], box[3]);
        context.save();
        context.strokeStyle = palette.accent;
        context.setLineDash([4, 3]);
        context.lineWidth = 1;
        context.strokeRect(x0 - 4, y0 - 4, x1 - x0 + 8, y1 - y0 + 8);
        context.setLineDash([]);
        context.fillStyle = palette.accent;
        const corners: [number, number][] = [
          [x0 - 4, y0 - 4],
          [x1 + 4, y0 - 4],
          [x0 - 4, y1 + 4],
          [x1 + 4, y1 + 4],
        ];
        for (const [hx, hy] of corners) context.fillRect(hx - 2.5, hy - 2.5, 5, 5);
        context.restore();
      }
    }

    if (preview) {
      context.save();
      context.globalAlpha = 0.85;
      drawEntity({ ...preview, id: "__preview", layer: preview.layer ?? doc.layers[0]!.id }, undefined, true);
      context.restore();
    }

    if (marquee) {
      const [a, b] = marquee;
      const [mx0, my0] = toScreen(Math.min(a[0], b[0]), Math.min(a[1], b[1]));
      const [mx1, my1] = toScreen(Math.max(a[0], b[0]), Math.max(a[1], b[1]));
      context.save();
      context.strokeStyle = palette.accent;
      context.fillStyle = palette.accent;
      context.globalAlpha = 0.1;
      context.fillRect(mx0, my0, mx1 - mx0, my1 - my0);
      context.globalAlpha = 0.8;
      context.setLineDash([4, 3]);
      context.lineWidth = 1;
      context.strokeRect(mx0, my0, mx1 - mx0, my1 - my0);
      context.restore();
    }
  }, [doc, tints, ghost, layersHidden, showGrid, size, view, selection, preview, marquee]);

  const onWheel = (event: React.WheelEvent) => {
    event.preventDefault();
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const px = event.clientX - rect.left;
    const py = event.clientY - rect.top;
    const factor = Math.exp(-event.deltaY * 0.0015);
    const current = viewRef.current;
    const scale = Math.min(400, Math.max(0.05, current.scale * factor));
    // Keep the document point under the cursor fixed while zooming.
    applyView({
      scale,
      x: px - ((px - current.x) / current.scale) * scale,
      y: py - ((py - current.y) / current.scale) * scale,
    });
  };

  /** Screen event -> document point plus what is under it, which is all a tool ever needs. */
  const readPointer = useCallback(
    (event: React.PointerEvent | React.MouseEvent): CanvasPointer => {
      const rect = canvasRef.current!.getBoundingClientRect();
      const at: Pt = [
        (event.clientX - rect.left - view.x) / view.scale,
        (event.clientY - rect.top - view.y) / view.scale,
      ];
      return {
        at,
        shift: event.shiftKey,
        alt: event.altKey,
        hit: hitTest(doc, at, 6 / view.scale, (entity) => layersHidden.has(entity.layer ?? "")),
      };
    },
    [doc, view, layersHidden],
  );

  // Left-drag draws when a tool is active; panning moves to middle-drag, right-drag and
  // held space, the way every drawing tool on earth already behaves.
  const shouldPan = (event: React.PointerEvent) => !interactive || panning || event.button !== 0;

  return (
    <div ref={wrapRef} className={className ?? "relative h-full w-full"}>
      <canvas
        ref={canvasRef}
        className="h-full w-full touch-none select-none"
        style={{
          width: size.width,
          height: size.height,
          cursor: dragging ? "grabbing" : panning ? "grab" : (cursor ?? (interactive ? "crosshair" : "grab")),
        }}
        onWheel={onWheel}
        onContextMenu={(event) => interactive && event.preventDefault()}
        onDoubleClick={(event) => interactive && onCanvasDoubleClick?.(readPointer(event))}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          if (shouldPan(event)) {
            drag.current = { x: event.clientX, y: event.clientY, ox: view.x, oy: view.y };
            setDragging(true);
            return;
          }
          onCanvasPointerDown?.(readPointer(event));
        }}
        onPointerMove={(event) => {
          const from = drag.current;
          if (from) {
            applyView({
              ...viewRef.current,
              x: from.ox + (event.clientX - from.x),
              y: from.oy + (event.clientY - from.y),
            });
            return;
          }
          if (interactive) onCanvasPointerMove?.(readPointer(event));
        }}
        onPointerUp={(event) => {
          if (drag.current) {
            drag.current = null;
            setDragging(false);
            return;
          }
          if (interactive) onCanvasPointerUp?.(readPointer(event));
        }}
      />
    </div>
  );
}

export { gridStep };
