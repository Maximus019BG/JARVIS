"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { automationsApi, type AutomationRunStep } from "~/lib/api/automations";
import { RUN_POLL_MS, runBadgeVariant, unfinished } from "~/lib/automations/run-status";
import { useActiveWorkstation } from "~/lib/workstation-hooks";

/** Wall clock of one step, once it has both ends. */
function duration(step: AutomationRunStep): string | null {
  if (!step.startedAt || !step.finishedAt) return null;
  const ms = new Date(step.finishedAt).getTime() - new Date(step.startedAt).getTime();
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

const json = (value: unknown) => JSON.stringify(value, null, 2);

export default function AutomationRunPage() {
  const params = useParams();
  const id = params?.id as string;
  const runId = params?.runId as string;
  const { data: activeWorkstation } = useActiveWorkstation();
  const workstationId = activeWorkstation?.id;

  const { data, isLoading } = useQuery({
    queryKey: ["automations", workstationId, id, "run", runId],
    queryFn: () => automationsApi.getRun(workstationId!, id, runId),
    enabled: !!workstationId && !!id && !!runId,
    // Nothing pushes: the run advances when a workstation posts a result, so the page has to
    // ask. Stops as soon as the run reaches a terminal status.
    refetchInterval: (query) => (unfinished(query.state.data?.run.status ?? "") ? RUN_POLL_MS : false),
  });

  if (isLoading) return <p className="text-muted-foreground p-6 text-sm">Loading…</p>;
  if (!data) return <p className="text-muted-foreground p-6 text-sm">Run not found.</p>;

  const { run, steps } = data;
  // A step handed to a workstation and not yet answered. Worth saying out loud, because the
  // page otherwise looks stuck for no visible reason.
  const waiting = steps.find((step) => step.type === "agent" && unfinished(step.status));

  return (
    <div className="container mx-auto flex max-w-4xl flex-col gap-4 p-6">
      <div className="flex items-start justify-between">
        <div>
          <Link href={`/app/automations/${id}/runs`} className="text-muted-foreground text-sm hover:underline">
            ← Runs
          </Link>
          <h1 className="mt-2 flex items-center gap-2 text-2xl font-semibold">
            Run
            <Badge variant={runBadgeVariant(run.status)}>{run.status}</Badge>
          </h1>
          <p className="text-muted-foreground text-xs">
            {new Date(run.startedAt ?? run.createdAt).toLocaleString()}
            {run.finishedAt ? ` · finished ${new Date(run.finishedAt).toLocaleTimeString()}` : ""} ·{" "}
            {steps.length} step{steps.length === 1 ? "" : "s"}
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href={`/app/automations/${id}/edit`}>Editor</Link>
        </Button>
      </div>

      {waiting && (
        <p className="text-muted-foreground rounded-lg border border-dashed p-3 text-sm">
          Waiting for a workstation to claim the <strong>{waiting.name ?? "agent"}</strong> step. Run{" "}
          <code>jarvis work</code> on the paired machine.
        </p>
      )}

      {steps.map((step) => (
        <Card key={step.id}>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium">
              <span className="text-muted-foreground">{step.index + 1}.</span>
              {step.name ?? step.type}
              <Badge variant="outline">{step.type}</Badge>
              <Badge variant={runBadgeVariant(step.status)}>{step.status}</Badge>
              {duration(step) && <span className="text-muted-foreground text-xs">{duration(step)}</span>}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {step.error && (
              <div>
                <p className="text-destructive mb-1 text-xs font-medium uppercase">Error</p>
                <pre className="text-destructive overflow-x-auto text-xs whitespace-pre-wrap">{step.error}</pre>
              </div>
            )}
            <div>
              <p className="text-muted-foreground mb-1 text-xs font-medium uppercase">Input</p>
              <pre className="bg-muted/50 overflow-x-auto rounded p-2 text-xs">{json(step.input)}</pre>
            </div>
            {step.output !== null && step.output !== undefined && (
              <div>
                <p className="text-muted-foreground mb-1 text-xs font-medium uppercase">Output</p>
                <pre className="bg-muted/50 overflow-x-auto rounded p-2 text-xs">{json(step.output)}</pre>
              </div>
            )}
          </CardContent>
        </Card>
      ))}

      {steps.length === 0 && (
        <p className="text-muted-foreground text-sm">
          No steps recorded. The published version may have an empty graph.
        </p>
      )}
    </div>
  );
}
