"use client";

import type { Op } from "@blueprint/ops.ts";
import type { BlueprintDoc, Entity } from "@blueprint/schema.ts";
import React from "react";

import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { cn } from "~/lib/utils";

const DASHES = ["solid", "dashed", "dotted"] as const;

/**
 * Values commit on blur or Enter, never per keystroke: the journal is the undo history, and
 * typing "120" into a width field should be one undo step rather than three.
 */
function NumberField({
  label,
  value,
  onCommit,
  step = 1,
  className,
}: {
  label: string;
  value: number | undefined;
  onCommit: (value: number) => void;
  step?: number;
  className?: string;
}) {
  const commit = (raw: string) => {
    const next = Number(raw);
    if (Number.isFinite(next) && next !== value) onCommit(next);
  };
  return (
    <div className={cn("space-y-1", className)}>
      <Label className="text-muted-foreground text-[11px]">{label}</Label>
      <Input
        key={`${label}:${value ?? ""}`}
        type="number"
        step={step}
        defaultValue={value ?? ""}
        onBlur={(event) => commit(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
        className="h-8"
      />
    </div>
  );
}

function PointFields({
  label,
  point,
  onCommit,
}: {
  label: string;
  point: [number, number];
  onCommit: (point: [number, number]) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <NumberField label={`${label} X`} value={point[0]} onCommit={(x) => onCommit([x, point[1]])} step={0.5} />
      <NumberField label={`${label} Y`} value={point[1]} onCommit={(y) => onCommit([point[0], y])} step={0.5} />
    </div>
  );
}

export function PropertiesPanel({
  doc,
  selection,
  onOps,
}: {
  doc: BlueprintDoc;
  selection: Set<string>;
  onOps: (...ops: Op[]) => boolean;
}) {
  const selected = doc.entities.filter((entity) => selection.has(entity.id!));
  const ids = selected.map((entity) => entity.id!);
  const only: Entity | undefined = selected.length === 1 ? selected[0] : undefined;

  // With nothing selected the panel is not empty — it is the sheet, which is the one thing
  // there is always something to say about.
  if (selected.length === 0) {
    const [vx, vy, vw, vh] = doc.viewBox;
    const setView = (box: [number, number, number, number]) => onOps({ op: "setView", viewBox: box });
    return (
      <div className="space-y-4">
        <div>
          <p className="text-sm font-medium">Sheet</p>
          <p className="text-muted-foreground text-xs">
            {doc.entities.length} object{doc.entities.length === 1 ? "" : "s"} · measured in {doc.units ?? "mm"}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <NumberField label="Width" value={vw} step={1} onCommit={(w) => w > 0 && setView([vx, vy, w, vh])} />
          <NumberField label="Height" value={vh} step={1} onCommit={(h) => h > 0 && setView([vx, vy, vw, h])} />
          <NumberField label="Origin X" value={vx} step={1} onCommit={(x) => setView([x, vy, vw, vh])} />
          <NumberField label="Origin Y" value={vy} step={1} onCommit={(y) => setView([vx, y, vw, vh])} />
        </div>
        <p className="text-muted-foreground text-xs">Select something to edit it.</p>
      </div>
    );
  }

  const patch = (values: Record<string, unknown>) =>
    only && onOps({ op: "update", id: only.id!, patch: values });

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm font-medium">
          {only ? only.type : `${selected.length} objects`}
          {only && <span className="text-muted-foreground ml-2 font-mono text-xs">{only.id}</span>}
        </p>
      </div>

      {only?.type === "line" && (
        <>
          <PointFields label="Start" point={only.a} onCommit={(a) => patch({ a })} />
          <PointFields label="End" point={only.b} onCommit={(b) => patch({ b })} />
        </>
      )}
      {only?.type === "rect" && (
        <>
          <PointFields label="Corner" point={only.at} onCommit={(at) => patch({ at })} />
          <div className="grid grid-cols-3 gap-2">
            <NumberField label="W" value={only.w} step={0.5} onCommit={(w) => patch({ w })} />
            <NumberField label="H" value={only.h} step={0.5} onCommit={(h) => patch({ h })} />
            <NumberField label="Radius" value={only.rx ?? 0} step={0.5} onCommit={(rx) => patch({ rx })} />
          </div>
        </>
      )}
      {only?.type === "circle" && (
        <>
          <PointFields label="Centre" point={only.c} onCommit={(c) => patch({ c })} />
          <NumberField label="Radius" value={only.r} step={0.5} onCommit={(r) => r > 0 && patch({ r })} />
        </>
      )}
      {only?.type === "arc" && (
        <>
          <PointFields label="Centre" point={only.c} onCommit={(c) => patch({ c })} />
          <div className="grid grid-cols-3 gap-2">
            <NumberField label="Radius" value={only.r} step={0.5} onCommit={(r) => r > 0 && patch({ r })} />
            <NumberField label="From °" value={only.a0} onCommit={(a0) => patch({ a0 })} />
            <NumberField label="To °" value={only.a1} onCommit={(a1) => patch({ a1 })} />
          </div>
        </>
      )}
      {only?.type === "text" && (
        <>
          <div className="space-y-1">
            <Label className="text-muted-foreground text-[11px]">Text</Label>
            <Input
              key={`text:${only.id}:${only.text}`}
              defaultValue={only.text}
              onBlur={(event) => event.target.value !== only.text && patch({ text: event.target.value })}
              onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()}
              className="h-8"
            />
          </div>
          <PointFields label="At" point={only.at} onCommit={(at) => patch({ at })} />
          <div className="grid grid-cols-2 gap-2">
            <NumberField label="Size" value={only.size ?? 4} step={0.5} onCommit={(size) => size > 0 && patch({ size })} />
            <NumberField label="Angle °" value={only.angle ?? 0} onCommit={(angle) => patch({ angle })} />
          </div>
        </>
      )}
      {only?.type === "dimension" && (
        <>
          <PointFields label="From" point={only.a} onCommit={(a) => patch({ a })} />
          <PointFields label="To" point={only.b} onCommit={(b) => patch({ b })} />
          <NumberField
            label="Offset (negative flips it)"
            value={only.offset}
            step={1}
            onCommit={(offset) => offset !== 0 && patch({ offset })}
          />
          <div className="space-y-1">
            <Label className="text-muted-foreground text-[11px]">Label (blank measures it)</Label>
            <Input
              key={`label:${only.id}:${only.label ?? ""}`}
              defaultValue={only.label ?? ""}
              placeholder={String(
                Math.round(Math.hypot(only.b[0] - only.a[0], only.b[1] - only.a[1]) * 100) / 100,
              )}
              onBlur={(event) => patch({ label: event.target.value || undefined })}
              onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()}
              className="h-8"
            />
          </div>
        </>
      )}
      {only?.type === "polyline" && (
        <p className="text-muted-foreground text-xs">
          {only.pts.length} points · {only.closed ? "closed" : "open"}
        </p>
      )}

      <div className="space-y-3 border-t pt-3">
        <div className="space-y-1">
          <Label className="text-muted-foreground text-[11px]">Layer</Label>
          <Select
            value={selected.every((entity) => entity.layer === selected[0]!.layer) ? selected[0]!.layer : undefined}
            onValueChange={(layer) => onOps({ op: "restyle", ids, layer })}
          >
            <SelectTrigger className="h-8 w-full">
              <SelectValue placeholder="Mixed" />
            </SelectTrigger>
            <SelectContent>
              {doc.layers.map((layer) => (
                <SelectItem key={layer.id} value={layer.id}>
                  {layer.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label className="text-muted-foreground text-[11px]">Stroke</Label>
            <div className="flex h-8 items-center gap-2 rounded-md border px-2">
              <input
                type="color"
                value={only?.stroke ?? doc.layers.find((l) => l.id === selected[0]!.layer)?.color ?? "#0f766e"}
                onChange={(event) => onOps({ op: "restyle", ids, stroke: event.target.value })}
                className="h-5 w-5 cursor-pointer border-0 bg-transparent p-0"
              />
              <span className="text-muted-foreground truncate text-xs">
                {only?.stroke ?? "from layer"}
              </span>
            </div>
          </div>
          <NumberField
            label="Width"
            value={only?.width ?? 0.4}
            step={0.1}
            onCommit={(width) => width > 0 && onOps({ op: "restyle", ids, width })}
          />
        </div>

        <div className="space-y-1">
          <Label className="text-muted-foreground text-[11px]">Dash</Label>
          <div className="bg-muted/40 flex rounded-md border p-0.5">
            {DASHES.map((dash) => (
              <button
                key={dash}
                type="button"
                onClick={() => onOps({ op: "restyle", ids, dash })}
                className={cn(
                  "flex-1 rounded px-2 py-1 text-xs capitalize transition-colors",
                  (only?.dash ?? "solid") === dash
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {dash}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
