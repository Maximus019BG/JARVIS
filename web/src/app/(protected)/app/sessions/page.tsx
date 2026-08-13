import { desc, eq } from "drizzle-orm";
import { headers } from "next/headers";
import Link from "next/link";
import { auth } from "~/lib/auth";
import { db } from "~/server/db";
import { agentSession } from "~/server/db/schemas/agent_session";
import { workstation } from "~/server/db/schemas/workstation";
import { Badge } from "~/components/ui/badge";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "~/components/ui/empty";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "~/components/ui/table";
import { money, thousands } from "~/lib/format";

export default async function SessionsPage() {
  // `(protected)/layout.tsx` has already redirected anyone unauthenticated; this is for the
  // ownership filter below, which is the actual authorization boundary.
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return null;

  const rows = await db
    .select({
      id: agentSession.id,
      title: agentSession.title,
      cwd: agentSession.cwd,
      startedAt: agentSession.startedAt,
      turns: agentSession.turns,
      inputTokens: agentSession.inputTokens,
      outputTokens: agentSession.outputTokens,
      costMicros: agentSession.costMicros,
    })
    .from(agentSession)
    .innerJoin(workstation, eq(workstation.id, agentSession.workstationId))
    .where(eq(workstation.userId, session.user.id))
    .orderBy(desc(agentSession.updatedAt))
    .limit(100);

  return (
    <div className="container mx-auto p-6">
      <h1 className="mb-4 text-2xl font-semibold">Sessions</h1>

      {rows.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No sessions yet</EmptyTitle>
            <EmptyDescription>
              Set <code>syncSessions: true</code> in your jarvis config and restart the TUI. Transcripts
              contain your source code, so it is off until you ask for it.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Session</TableHead>
                <TableHead>Directory</TableHead>
                <TableHead>Started</TableHead>
                <TableHead className="text-right">Turns</TableHead>
                <TableHead className="text-right">Tokens</TableHead>
                <TableHead className="text-right">Cost</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-medium">
                    <Link href={`/app/sessions/${row.id}`} className="hover:underline">
                      {row.title}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground max-w-xs truncate text-xs">{row.cwd}</TableCell>
                  <TableCell className="text-muted-foreground text-xs">
                    {row.startedAt.toLocaleDateString()}
                  </TableCell>
                  <TableCell className="text-right">
                    {row.turns === 0 ? <Badge variant="outline">untracked</Badge> : row.turns}
                  </TableCell>
                  <TableCell className="text-right text-xs">
                    {thousands(row.inputTokens)}/{thousands(row.outputTokens)}
                  </TableCell>
                  <TableCell className="text-right">{money(row.costMicros)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
