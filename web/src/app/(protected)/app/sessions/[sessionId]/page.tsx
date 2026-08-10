import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "~/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { auth } from "~/lib/auth";
import { transcriptLines } from "~/lib/transcript-lines";
import { db } from "~/server/db";
import { agentSession } from "~/server/db/schemas/agent_session";
import { workstation } from "~/server/db/schemas/workstation";

export default async function SessionPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return null;

  const row = (
    await db
      .select({
        id: agentSession.id,
        title: agentSession.title,
        cwd: agentSession.cwd,
        startedAt: agentSession.startedAt,
        transcript: agentSession.transcript,
        turns: agentSession.turns,
        costMicros: agentSession.costMicros,
        ownerId: workstation.userId,
      })
      .from(agentSession)
      .innerJoin(workstation, eq(workstation.id, agentSession.workstationId))
      .where(eq(agentSession.id, sessionId))
      .limit(1)
  )[0];

  // 404 rather than 403 for somebody else's session: whether an id exists is itself
  // information, and the owner is the only one who needs to tell the two apart.
  if (row?.ownerId !== session.user.id) notFound();

  const entries = transcriptLines(row.transcript);

  return (
    <div className="container mx-auto max-w-4xl p-6">
      <Link href="/app/sessions" className="text-muted-foreground text-sm hover:underline">
        ← Sessions
      </Link>
      <h1 className="mt-2 text-2xl font-semibold">{row.title}</h1>
      <p className="text-muted-foreground mb-6 text-xs">
        {row.cwd} · {row.startedAt.toLocaleString()} · {entries.length} messages
        {row.turns > 0 ? ` · ${row.turns} turns · $${(row.costMicros / 1_000_000).toFixed(3)}` : ""}
      </p>

      <div className="flex flex-col gap-3">
        {entries.map((entry, index) =>
          entry.kind === "compact" ? (
            <div key={index} className="text-muted-foreground flex items-center gap-3 py-2 text-xs">
              <span className="bg-border h-px flex-1" />
              <span>compacted {entry.dropped} messages</span>
              <span className="bg-border h-px flex-1" />
            </div>
          ) : (
            <Card key={index} className={entry.role === "user" ? "bg-muted/50" : undefined}>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-xs font-medium uppercase">
                  {entry.role}
                  {entry.calls > 0 ? (
                    <Badge variant="outline">
                      {entry.calls} tool call{entry.calls === 1 ? "" : "s"}
                    </Badge>
                  ) : null}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <pre className="overflow-x-auto text-sm whitespace-pre-wrap">{entry.text}</pre>
              </CardContent>
            </Card>
          ),
        )}
      </div>
    </div>
  );
}
