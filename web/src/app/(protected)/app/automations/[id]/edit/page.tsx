"use client";

import React from "react";
import { useRouter, useParams } from "next/navigation";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { automationsApi, type Automation } from "~/lib/api/automations";
import AutomationCanvas, {
  type CanvasState,
} from "~/components/automations/automation-canvas";
import { useActiveWorkstation } from "~/lib/workstation-hooks";
import { useEffect } from "react";

export default function EditAutomationPage() {
  const router = useRouter();
  const params = useParams();
  const { data: activeWorkstation } = useActiveWorkstation();
  const [automation, setAutomation] = React.useState<Automation | null>(null);
  const [name, setName] = React.useState("");
  const [canvas, setCanvas] = React.useState<CanvasState>({
    nodes: [],
    edges: [],
  });
  const handleCanvasChange = React.useCallback(
    (v: CanvasState) => setCanvas(v),
    [],
  );
  const [loading, setLoading] = React.useState(false);
  useEffect(() => {
    const load = async () => {
      const id = params?.id as string;
      if (!activeWorkstation?.id || !id) return;
      try {
        const res = await automationsApi.get(activeWorkstation.id, id);
        setAutomation(res);
        setName(res.name);
        try {
          const metadata = res.metadata
            ? JSON.parse(res.metadata)
            : { nodes: [], edges: [] };
          setCanvas({
            nodes: metadata.nodes ?? [],
            edges: metadata.edges ?? [],
          });
        } catch {
          setCanvas({ nodes: [], edges: [] });
        }
      } catch (e) {
        console.error(e);
      }
    };
    void load();
  }, [activeWorkstation?.id, params?.id]);

  if (!activeWorkstation) return null;

  const save = async () => {
    if (!activeWorkstation?.id || !id) return;
    setLoading(true);
    try {
      await automationsApi.save(activeWorkstation.id, id, {
        name,
        data: { nodes: canvas.nodes, edges: canvas.edges },
      });
      router.refresh();
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container mx-auto p-6">
      <div className="space-y-4">
        <Label>Name</Label>
        <Input value={name} onChange={(e) => setName(e.target.value)} />
        <Label>Visual Editor</Label>
        <div className="h-[600px]">
          <AutomationCanvas value={canvas} onChange={handleCanvasChange} />
        </div>
        <div className="flex justify-between">
          <Button onClick={() => router.back()} variant="outline">
            Back
          </Button>
          <div>
            <Button
              onClick={() => router.push(`/app/automations/${id}/edit`)}
              variant="ghost"
            >
              Preview
            </Button>
            <Button onClick={save} disabled={loading || !name} className="ml-2">
              Save
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
