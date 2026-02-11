"use client";

import React from "react";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";
import {
  nodeRegistryList,
  type AutomationNodeType,
} from "~/lib/automations/node-registry";

export type PaletteItem = {
  id: string;
  label: string;
  type: AutomationNodeType;
  category: string;
};

const items: PaletteItem[] = nodeRegistryList.map((n) => ({
  id: n.type,
  label: n.label,
  type: n.type,
  category: n.category,
}));

export default function AutomationPalette({
  className,
  onAdd,
}: {
  className?: string;
  onAdd?: (type: AutomationNodeType) => void;
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
