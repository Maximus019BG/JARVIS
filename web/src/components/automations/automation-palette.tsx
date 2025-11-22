"use client";

import React from "react";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";

export type PaletteItem = {
  id: string;
  label: string;
  type: "trigger" | "action" | "condition";
};

const items: PaletteItem[] = [
  { id: "trigger-http", label: "HTTP Trigger", type: "trigger" },
  { id: "action-log", label: "Log Action", type: "action" },
  { id: "condition-branch", label: "Condition", type: "condition" },
];

export default function AutomationPalette({
  className,
  onAdd,
}: {
  className?: string;
  onAdd?: (type: "trigger" | "action" | "condition") => void;
}) {
  return (
    <div className={cn("bg-popover rounded-lg border p-2", className)}>
      <div className="mb-2 text-sm font-medium">Nodes</div>
      <div className="flex flex-col gap-2">
        {items.map((it) => (
          <Button
            key={it.id}
            variant="outline"
            size="sm"
            className="justify-start"
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData("text/plain", JSON.stringify(it));
            }}
            onClick={() => onAdd?.(it.type)}
          >
            {it.label}
          </Button>
        ))}
      </div>
    </div>
  );
}
