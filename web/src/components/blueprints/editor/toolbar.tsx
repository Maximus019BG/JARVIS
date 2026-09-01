"use client";

import {
  Circle,
  MousePointer2,
  Pencil,
  Ruler,
  Shapes,
  Slash,
  Spline,
  Square,
  Type,
  Waypoints,
} from "lucide-react";
import React from "react";

import { Button } from "~/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";
import { cn } from "~/lib/utils";

export type Tool =
  | "select"
  | "freehand"
  | "line"
  | "polyline"
  | "rect"
  | "circle"
  | "arc"
  | "text"
  | "dimension"
  | "symbol";

/** `key` is the single-press shortcut; they are unique and lower case on purpose. */
export const TOOLS: { id: Tool; label: string; key: string; icon: React.ElementType; hint: string }[] = [
  { id: "select", label: "Select", key: "v", icon: MousePointer2, hint: "Click, shift-click, or drag a box" },
  { id: "freehand", label: "Freehand", key: "f", icon: Pencil, hint: "Draw roughly — it snaps to a clean shape" },
  { id: "line", label: "Line", key: "l", icon: Slash, hint: "Drag from end to end" },
  { id: "polyline", label: "Polyline", key: "p", icon: Waypoints, hint: "Click each corner, Enter to finish" },
  { id: "rect", label: "Rectangle", key: "r", icon: Square, hint: "Drag corner to corner" },
  { id: "circle", label: "Circle", key: "c", icon: Circle, hint: "Drag from the centre" },
  { id: "arc", label: "Arc", key: "a", icon: Spline, hint: "Drag centre to start, then click the end" },
  { id: "text", label: "Text", key: "t", icon: Type, hint: "Click, then type" },
  { id: "dimension", label: "Dimension", key: "d", icon: Ruler, hint: "Drag between the two points" },
  { id: "symbol", label: "Symbol", key: "s", icon: Shapes, hint: "Pick one from the panel, then click" },
];

export function EditorToolbar({
  tool,
  onToolChange,
  className,
}: {
  tool: Tool;
  onToolChange: (tool: Tool) => void;
  className?: string;
}) {
  return (
    <div className={cn("bg-card flex flex-col gap-1 rounded-md border p-1", className)}>
      {TOOLS.map((entry) => (
        <Tooltip key={entry.id}>
          <TooltipTrigger asChild>
            <Button
              type="button"
              size="icon"
              variant={tool === entry.id ? "default" : "ghost"}
              className="h-9 w-9"
              onClick={() => onToolChange(entry.id)}
              aria-label={entry.label}
              aria-pressed={tool === entry.id}
            >
              <entry.icon className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">
            <div className="flex items-center gap-2">
              <span className="font-medium">{entry.label}</span>
              <kbd className="bg-background/20 rounded px-1 text-[10px] uppercase">{entry.key}</kbd>
            </div>
            <p className="text-[11px] opacity-80">{entry.hint}</p>
          </TooltipContent>
        </Tooltip>
      ))}
    </div>
  );
}
