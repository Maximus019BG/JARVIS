"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "~/components/ui/empty";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "~/components/ui/table";
import { automationsApi } from "~/lib/api/automations";
import { RUN_POLL_MS, runBadgeVariant, unfinished } from "~/lib/automations/run-status";
import { useActiveWorkstation } from "~/lib/workstation-hooks";

export default function AutomationRunsPage() {
  const params = useParams();
  const id = params?.id as string;
  const { data: activeWorkstation } = useActiveWorkstation();
  const workstationId = activeWorkstation?.id;

  const { data, isLoading } = useQuery({
    queryKey: ["automations", workstationId, id, "runs"],
    queryFn: () => automationsApi.runs(workstationId!, id),
    enabled: !!workstationId && !!id,
    // Keep polling while anything is still in flight: an `agent` step suspends its run until
    // a workstation claims it, so a run can sit unfinished for minutes with nothing to push.
    refetchInterval: (query) => (query.state.data?.runs.some((run) => unfinished(run.status)) ? RUN_POLL_MS : false),
  });

  const runs = data?.runs ?? [];

  return (
    <div className="container mx-auto flex flex-col gap-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Runs</h1>
        <Button asChild variant="outline">
          <Link href={`/app/automations/${id}/edit`}>Back to editor</Link>
        </Button>
      </div>

      {isLoading ? (
        <p className="text-muted-foreground text-sm">Loading…</p>
      ) : runs.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No runs yet</EmptyTitle>
            <EmptyDescription>
              Publish the workflow, then press <strong>Run now</strong> in the editor — or call its
              webhook trigger.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Started</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Trigger</TableHead>
                <TableHead className="text-right">Steps</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.map((run) => (
                <TableRow key={run.id}>
                  <TableCell className="font-medium">
                    <Link href={`/app/automations/${id}/runs/${run.id}`} className="hover:underline">
                      {new Date(run.startedAt ?? run.createdAt).toLocaleString()}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Badge variant={runBadgeVariant(run.status)}>{run.status}</Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-xs">
                    {run.triggerId ? "webhook" : "manual"}
                  </TableCell>
                  <TableCell className="text-right">{run.stepCount}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
