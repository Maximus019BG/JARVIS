"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { Check, X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "~/components/ui/empty";
import { Skeleton } from "~/components/ui/skeleton";

type Approval = {
  id: string;
  tool: string;
  title: string;
  detail: string | null;
  detailKind: string | null;
  createdAt: string;
  expiresAt: string;
  deviceName: string;
};

const KEY = ["approvals"];

export function ApprovalsCard() {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: KEY,
    queryFn: async (): Promise<Approval[]> => {
      const response = await fetch("/api/approval");
      if (!response.ok) throw new Error("could not load approvals");
      return ((await response.json()) as { approvals: Approval[] }).approvals;
    },
    // Matches the TUI's poll: an agent is blocked on this, so a stale list is a stalled run.
    refetchInterval: 3000,
  });

  const answer = useMutation({
    mutationFn: async ({ id, choice }: { id: string; choice: "once" | "reject" }) => {
      const response = await fetch(`/api/approval/${id}/answer`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ answer: choice }),
      });
      // 409 means the terminal got there first — not an error worth a red toast.
      if (response.status === 409) throw new Error("already answered at the terminal");
      if (!response.ok) throw new Error("could not send your answer");
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: KEY }),
    onError: (error: Error) => {
      toast.message(error.message);
      void queryClient.invalidateQueries({ queryKey: KEY });
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Pending approvals</CardTitle>
        <CardDescription>
          Tools your agents are waiting on. Allowing here runs the action once — it does not change
          any saved permission.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {isLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : !data?.length ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>Nothing waiting</EmptyTitle>
              <EmptyDescription>
                Turn on <code>remoteApproval</code> in your jarvis config and prompts will show up here.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          data.map((approval) => (
            <div key={approval.id} className="flex flex-col gap-2 rounded-lg border p-3">
              <div className="flex items-center gap-2">
                <Badge variant="outline">{approval.tool}</Badge>
                <span className="text-sm font-medium">{approval.title}</span>
                <span className="text-muted-foreground ml-auto text-xs">
                  {approval.deviceName} · {formatDistanceToNow(new Date(approval.createdAt), { addSuffix: true })}
                </span>
              </div>
              {approval.detail ? (
                <pre className="bg-muted max-h-48 overflow-auto rounded p-2 text-xs whitespace-pre-wrap">
                  {approval.detail}
                </pre>
              ) : null}
              <div className="flex gap-2">
                <Button
                  size="sm"
                  disabled={answer.isPending}
                  onClick={() => answer.mutate({ id: approval.id, choice: "once" })}
                >
                  <Check className="size-4" /> Allow once
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={answer.isPending}
                  onClick={() => answer.mutate({ id: approval.id, choice: "reject" })}
                >
                  <X className="size-4" /> Reject
                </Button>
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
