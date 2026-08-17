"use client";

import { flatten } from "@blueprint/geom.ts";
import type { BlueprintDoc, Entity } from "@blueprint/schema.ts";
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
};

const TINT_ALPHA: Record<DiffTint, number> = { added: 1, removed: 0.9, modified: 1, unchanged: 0.35 };

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
};

function readPalette(element: HTMLElement): Palette {
  const style = getComputedStyle(element);
  const token = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  return {
    ink: token("--foreground", "#0a0a0a"),
    muted: token("--muted-foreground", "#737373"),
    grid: token("--border", "#e5e5e5"),
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

export function BlueprintCanvas({
  doc,
  tints,
  ghost,
  hiddenLayers,
  showGrid = true,
  className,
  fitKey = 0,
}: BlueprintCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  // scale is pixels per document unit; offset is in pixels.
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

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
    setView({ scale, x: size.width / 2 - (vx + vw / 2) * scale, y: size.height / 2 - (vy + vh / 2) * scale });
  }, [doc.viewBox, size.width, size.height]);

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

    // Ghost first: removed geometry belongs behind whatever replaced it.
    if (ghost) {
      for (const entity of ghost.doc.entities) {
        const tint = ghost.tints?.get(entity.id!);
        if (tint) drawEntity(entity, tint, tint === "removed");
      }
    }
    for (const entity of doc.entities) drawEntity(entity, tints?.get(entity.id!), false);
  }, [doc, tints, ghost, layersHidden, showGrid, size, view]);

  const onWheel = (event: React.WheelEvent) => {
    event.preventDefault();
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const px = event.clientX - rect.left;
    const py = event.clientY - rect.top;
    const factor = Math.exp(-event.deltaY * 0.0015);
    setView((current) => {
      const scale = Math.min(400, Math.max(0.05, current.scale * factor));
      // Keep the document point under the cursor fixed while zooming.
      return {
        scale,
        x: px - ((px - current.x) / current.scale) * scale,
        y: py - ((py - current.y) / current.scale) * scale,
      };
    });
  };

  return (
    <div ref={wrapRef} className={className ?? "relative h-full w-full"}>
      <canvas
        ref={canvasRef}
        className="h-full w-full touch-none select-none"
        style={{ width: size.width, height: size.height, cursor: drag.current ? "grabbing" : "grab" }}
        onWheel={onWheel}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = { x: event.clientX, y: event.clientY, ox: view.x, oy: view.y };
        }}
        onPointerMove={(event) => {
          const from = drag.current;
          if (!from) return;
          setView((current) => ({
            ...current,
            x: from.ox + (event.clientX - from.x),
            y: from.oy + (event.clientY - from.y),
          }));
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
      />
    </div>
  );
}

export { gridStep };
