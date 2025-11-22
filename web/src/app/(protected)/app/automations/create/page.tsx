"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { useActiveWorkstation } from "~/lib/workstation-hooks";
import { automationsApi } from "~/lib/api/automations";
import AutomationCanvas, {
  type CanvasState,
} from "~/components/automations/automation-canvas";
import AutomationPalette from "~/components/automations/automation-palette";

export default function CreateAutomationPage() {
  const router = useRouter();
  const { data: activeWorkstation } = useActiveWorkstation();
  const [name, setName] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [canvas, setCanvas] = React.useState<CanvasState>({
    nodes: [],
    edges: [],
  });
  const handleCanvasChange = React.useCallback((v: CanvasState) => {
    setCanvas(v);
  }, []);
  const canvasRef = React.useRef<{
    createNode: (type: "trigger" | "action" | "condition") => void;
  } | null>(null);

  if (!activeWorkstation) return null;

  const save = async () => {
    if (!activeWorkstation?.id) return;
    setLoading(true);
    try {
      const id = crypto.randomUUID();
      await automationsApi.save(activeWorkstation.id, id, {
        name,
        data: { nodes: canvas.nodes, edges: canvas.edges },
      });
      router.push(`/app/automations/${id}/edit`);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container mx-auto p-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Create Automation</h1>
          <p className="text-muted-foreground">
            Use the canvas to build a new automation flow
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Input
            placeholder="Automation name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Button disabled={!name || loading} onClick={save}>
            Create
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-[220px_1fr] gap-4">
        <AutomationPalette
          onAdd={(type: "trigger" | "action" | "condition") =>
            canvasRef.current?.createNode(type)
          }
        />
        <div className="min-h-[80vh]">
          <AutomationCanvas
            ref={canvasRef}
            value={canvas}
            onChange={handleCanvasChange}
          />
        </div>
      </div>
    </div>
  );
}
