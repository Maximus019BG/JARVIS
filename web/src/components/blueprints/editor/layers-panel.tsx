"use client";

import type { Op } from "@blueprint/ops.ts";
import type { BlueprintDoc } from "@blueprint/schema.ts";
import { Eye, EyeOff, Plus } from "lucide-react";
import React from "react";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { cn } from "~/lib/utils";

/**
 * Layers do two jobs here: what new geometry is drawn on, and what is currently visible.
 * They are kept apart deliberately — hiding the layer you are drawing on is a legitimate
 * thing to do by accident, and the editor says so rather than silently swallowing strokes.
 */
export function LayersPanel({
  doc,
  activeLayer,
  onActiveLayerChange,
  hiddenLayers,
  onToggleHidden,
  onOps,
  counts,
}: {
  doc: BlueprintDoc;
  activeLayer: string;
  onActiveLayerChange: (id: string) => void;
  hiddenLayers: Set<string>;
  onToggleHidden: (id: string) => void;
  onOps: (...ops: Op[]) => boolean;
  counts: Map<string, number>;
}) {
  const [adding, setAdding] = React.useState(false);
  const [draft, setDraft] = React.useState("");

  const addLayer = () => {
    const name = draft.trim();
    if (!name) return setAdding(false);
    if (onOps({ op: "addLayer", layer: { name, color: "#0f766e", visible: true } })) {
      setDraft("");
      setAdding(false);
    }
  };

  return (
    <div className="space-y-2">
      {doc.layers.map((layer) => {
        const hidden = hiddenLayers.has(layer.id) || layer.visible === false;
        return (
          <div
            key={layer.id}
            className={cn(
              "flex items-center gap-2 rounded-md border p-2 transition-colors",
              activeLayer === layer.id ? "border-primary bg-primary/5" : "hover:bg-muted/40",
            )}
          >
            <button
              type="button"
              aria-label={`Colour of ${layer.name}`}
              className="relative h-5 w-5 shrink-0 rounded border"
              style={{ backgroundColor: layer.color ?? "#0f766e" }}
            >
              <input
                type="color"
                value={layer.color ?? "#0f766e"}
                onChange={(event) => onOps({ op: "setLayer", id: layer.id, patch: { color: event.target.value } })}
                className="absolute inset-0 cursor-pointer opacity-0"
              />
            </button>

            <button
              type="button"
              onClick={() => onActiveLayerChange(layer.id)}
              className="min-w-0 flex-1 text-left"
              title="Draw on this layer"
            >
              <Input
                value={layer.name}
                onChange={(event) => onOps({ op: "setLayer", id: layer.id, patch: { name: event.target.value } })}
                onClick={(event) => event.stopPropagation()}
                className="h-7 border-transparent bg-transparent px-1 text-sm shadow-none focus-visible:border-input"
              />
            </button>

            <span className="text-muted-foreground w-6 shrink-0 text-right text-[11px] tabular-nums">
              {counts.get(layer.id) ?? 0}
            </span>

            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-7 w-7 shrink-0"
              aria-label={hidden ? `Show ${layer.name}` : `Hide ${layer.name}`}
              onClick={() => onToggleHidden(layer.id)}
            >
              {hidden ? <EyeOff className="h-3.5 w-3.5 opacity-50" /> : <Eye className="h-3.5 w-3.5" />}
            </Button>
          </div>
        );
      })}

      {adding ? (
        <div className="flex gap-2">
          <Input
            autoFocus
            value={draft}
            placeholder="Layer name"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") addLayer();
              if (event.key === "Escape") setAdding(false);
            }}
            onBlur={addLayer}
            className="h-8"
          />
        </div>
      ) : (
        <Button type="button" variant="outline" size="sm" className="w-full" onClick={() => setAdding(true)}>
          <Plus className="mr-2 h-3.5 w-3.5" />
          Add layer
        </Button>
      )}

      {hiddenLayers.has(activeLayer) && (
        <p className="text-muted-foreground text-xs">
          You are drawing on a hidden layer — new shapes will not appear until you show it.
        </p>
      )}
    </div>
  );
}
