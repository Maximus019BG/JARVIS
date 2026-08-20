"use client";

import { bbox } from "@blueprint/geom.ts";
import type { Op } from "@blueprint/ops.ts";
import { toSvg } from "@blueprint/render-svg.ts";
import type { BlueprintDoc, Entity, Pt } from "@blueprint/schema.ts";
import { DOMAINS, searchSymbols, type SymbolDomain } from "@blueprint/symbols/index.ts";
import { RotateCw, Search } from "lucide-react";
import React from "react";

import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Slider } from "~/components/ui/slider";
import { cn } from "~/lib/utils";

/** Rendering every symbol at once is hundreds of SVGs; the count below the grid says so. */
const SHOWN = 60;

export type SymbolPlacement = { name: string; rotate: number; scale: number };

/**
 * The op for one placement.
 *
 * A single `place` rather than the handful of `add`s it expands to, because the engine is
 * what turns a placement into a remembered part — and a symbol dropped here without that
 * record cannot be wired with `connect` and can collide with an id an agent allocated. The
 * geometry, the id prefix and the part are then identical whether the resistor came from
 * this palette, from the terminal or from the agent.
 */
export function symbolOp(placement: SymbolPlacement, at: Pt, layer: string, label?: string): Op {
  return {
    op: "place",
    symbol: placement.name,
    at,
    rotate: placement.rotate,
    scale: placement.scale,
    layer,
    ...(label ? { label } : {}),
  };
}

/** Preview of one symbol, fitted to its own bounds so tiny and huge parts read the same. */
function Thumbnail({ entities }: { entities: Entity[] }) {
  const svg = React.useMemo(() => {
    const box = bbox(entities) ?? [0, 0, 1, 1];
    const pad = Math.max((box[2] - box[0]) * 0.15, (box[3] - box[1]) * 0.15, 0.5);
    const doc: BlueprintDoc = {
      schema: 1,
      id: "preview",
      name: "preview",
      units: "mm",
      viewBox: [box[0] - pad, box[1] - pad, box[2] - box[0] + pad * 2, box[3] - box[1] + pad * 2],
      layers: [{ id: "l0", name: "s", color: "currentColor", visible: true }],
      entities,
      parts: [],
    };
    return toSvg(doc);
  }, [entities]);

  return (
    <div
      className="text-foreground pointer-events-none h-10 w-full [&>svg]:h-full [&>svg]:w-full"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

export function SymbolPalette({
  placement,
  onPlacementChange,
}: {
  placement: SymbolPlacement | null;
  onPlacementChange: (placement: SymbolPlacement | null) => void;
}) {
  const [query, setQuery] = React.useState("");
  const [domain, setDomain] = React.useState<SymbolDomain | "all">("all");

  const results = React.useMemo(
    () => searchSymbols({ domain: domain === "all" ? undefined : domain, query: query.trim() || undefined }),
    [query, domain],
  );
  const shown = results.slice(0, SHOWN);

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="text-muted-foreground pointer-events-none absolute top-2.5 left-2.5 h-3.5 w-3.5" />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="resistor, door, sensor…"
          className="h-9 pl-8"
        />
      </div>

      <div className="bg-muted/40 flex rounded-md border p-0.5">
        {(["all", ...DOMAINS] as const).map((entry) => (
          <button
            key={entry}
            type="button"
            onClick={() => setDomain(entry)}
            className={cn(
              "flex-1 rounded px-2 py-1 text-xs capitalize transition-colors",
              domain === entry ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {entry}
          </button>
        ))}
      </div>

      {placement && (
        <div className="border-primary/40 bg-primary/5 space-y-3 rounded-md border p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate font-mono text-xs">{placement.name}</span>
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground text-xs"
              onClick={() => onPlacementChange(null)}
            >
              Clear
            </button>
          </div>
          <p className="text-muted-foreground text-xs">Click the sheet to place it. Esc cancels.</p>
          <div className="space-y-1">
            <Label className="text-muted-foreground flex items-center gap-1 text-[11px]">
              <RotateCw className="h-3 w-3" /> Rotation {placement.rotate}°
            </Label>
            <Slider
              value={[placement.rotate]}
              min={0}
              max={345}
              step={15}
              onValueChange={([value]) => onPlacementChange({ ...placement, rotate: value ?? 0 })}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-muted-foreground text-[11px]">Scale ×{placement.scale}</Label>
            <Slider
              value={[placement.scale]}
              min={0.25}
              max={4}
              step={0.25}
              onValueChange={([value]) => onPlacementChange({ ...placement, scale: value ?? 1 })}
            />
          </div>
        </div>
      )}

      <div className="grid grid-cols-3 gap-2">
        {shown.map((entry) => (
          <button
            key={entry.name}
            type="button"
            title={`${entry.name} — ${entry.symbol.describe}`}
            onClick={() => onPlacementChange({ name: entry.name, rotate: placement?.rotate ?? 0, scale: placement?.scale ?? 1 })}
            className={cn(
              "flex flex-col items-center gap-1 rounded-md border p-2 transition-colors",
              placement?.name === entry.name ? "border-primary bg-primary/5" : "hover:border-muted-foreground/40",
            )}
          >
            <Thumbnail entities={entry.symbol.entities} />
            <span className="text-muted-foreground w-full truncate text-center text-[10px]">
              {entry.name.split("/")[1]}
            </span>
          </button>
        ))}
      </div>

      <p className="text-muted-foreground text-xs">
        {results.length === 0
          ? "No symbols match that."
          : results.length > SHOWN
            ? `Showing ${SHOWN} of ${results.length} — narrow the search to see the rest.`
            : `${results.length} symbol${results.length === 1 ? "" : "s"}`}
      </p>
    </div>
  );
}
