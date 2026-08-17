"use client";

import React from "react";
import Link from "next/link";
import { useRouter, useParams } from "next/navigation";
import { toast } from "sonner";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { automationsApi } from "~/lib/api/automations";
import { detailsOf, problem } from "~/lib/api/error";
import AutomationCanvas, {
  type CanvasState,
} from "~/components/automations/automation-canvas";
import { AutomationTriggers } from "~/components/automations/automation-triggers";
import { useActiveWorkstation } from "~/lib/workstation-hooks";
import { useEffect } from "react";

export default function EditAutomationPage() {
  const router = useRouter();
  const params = useParams();
  const id = params?.id as string;

  const { data: activeWorkstation } = useActiveWorkstation();
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
  /** Per-node validation messages from the last failed publish. */
  const [errors, setErrors] = React.useState<string[]>([]);

  useEffect(() => {
    const load = async () => {
      if (!activeWorkstation?.id || !id) return;
      try {
        const res = await automationsApi.get(activeWorkstation.id, id);
        setName(res.name);
        try {
          const metadata = (
            res.metadata ? JSON.parse(res.metadata) : {}
          ) as Partial<CanvasState>;
          setCanvas({
            nodes: metadata.nodes ?? [],
            edges: metadata.edges ?? [],
          });
        } catch {
          setCanvas({ nodes: [], edges: [] });
        }
      } catch (e) {
        toast.error(problem(e, "Could not load this automation"));
      }
    };
    void load();
  }, [activeWorkstation?.id, id]);

  if (!activeWorkstation) return null;

  const save = async () => {
    if (!activeWorkstation?.id || !id) return;
    setLoading(true);
    try {
      await automationsApi.save(activeWorkstation.id, id, {
        name,
        data: { nodes: canvas.nodes, edges: canvas.edges },
      });
      toast.success("Saved");
      router.refresh();
    } catch (e) {
      toast.error(problem(e, "Could not save"));
    } finally {
      setLoading(false);
    }
  };

  /**
   * Publish compiles the newest saved version into a runnable definition, so it saves first
   * — otherwise the button would publish whatever was on screen the last time you pressed
   * Save, which is not what anybody means by "publish this".
   */
  const publish = async () => {
    if (!activeWorkstation?.id || !id) return;
    setLoading(true);
    setErrors([]);
    try {
      await automationsApi.save(activeWorkstation.id, id, {
        name,
        data: { nodes: canvas.nodes, edges: canvas.edges },
      });
      const res = await automationsApi.publish(activeWorkstation.id, id);
      toast.success(`Published version ${res.publishedVersion}`);
      router.refresh();
    } catch (e) {
      // The publish route rejects an invalid graph with the per-node messages
      // `editorGraphToDefinition` produced. They are the only actionable thing here, so
      // they go on the page rather than into a toast that disappears.
      setErrors(detailsOf(e));
      toast.error(problem(e, "Could not publish"));
    } finally {
      setLoading(false);
    }
  };

  const runNow = async () => {
    if (!activeWorkstation?.id || !id) return;
    setLoading(true);
    try {
      const res = await automationsApi.run(activeWorkstation.id, id);
      // A run holding an `agent` step is not finished when the request returns — it is
      // waiting for a workstation to poll. Say so instead of implying it completed.
      toast.success(res.suspended ? "Run started — waiting for a workstation" : `Run ${res.status}`);
      router.push(`/app/automations/${id}/runs/${res.runId}`);
    } catch (e) {
      toast.error(problem(e, "Could not start a run"));
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
        {errors.length > 0 && (
          <Alert variant="destructive">
            <AlertTitle>This workflow cannot be published yet</AlertTitle>
            <AlertDescription>
              <ul className="list-disc pl-4">
                {errors.map((error) => (
                  <li key={error}>{error}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}

        {/* A trigger runs the *published* version, so this sits below the editor: there is
            nothing for a webhook or a schedule to invoke until Publish has been pressed. */}
        <AutomationTriggers workstationId={activeWorkstation.id} automationId={id} />

        <div className="flex justify-between">
          <Button onClick={() => router.back()} variant="outline">
            Back
          </Button>
          <div className="flex gap-2">
            <Button asChild variant="ghost">
              <Link href={`/app/automations/${id}/runs`}>Runs</Link>
            </Button>
            <Button onClick={save} disabled={loading || !name} variant="outline">
              Save
            </Button>
            <Button onClick={publish} disabled={loading || !name} variant="outline">
              Publish
            </Button>
            <Button onClick={runNow} disabled={loading}>
              Run now
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
