import { and, desc, eq, gte } from "drizzle-orm";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "~/components/ui/empty";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "~/components/ui/table";
import { getSession } from "~/lib/session";
import { money, thousands } from "~/lib/format";
import { foldUsage } from "~/lib/usage";
import { db } from "~/server/db";
import { agentSession } from "~/server/db/schemas/agent_session";
import { workstation } from "~/server/db/schemas/workstation";

/** Days of history the page covers, today included. */
const WINDOW_DAYS = 30;
const TOP_SESSIONS = 10;

export default async function UsagePage() {
  // `(protected)/layout.tsx` has already redirected anyone unauthenticated; the ownership
  // filter in the query below is the actual authorization boundary.
  const session = await getSession();
  if (!session?.user) return null;

  const from = new Date();
  from.setHours(0, 0, 0, 0);
  from.setDate(from.getDate() - (WINDOW_DAYS - 1));

  // One query and a fold in JS rather than an aggregation per panel: a month of sessions for
  // one user is hundreds of rows, and every panel below reads the same set.
  const rows = await db
    .select({
      id: agentSession.id,
      title: agentSession.title,
      startedAt: agentSession.startedAt,
      turns: agentSession.turns,
      inputTokens: agentSession.inputTokens,
      outputTokens: agentSession.outputTokens,
      costMicros: agentSession.costMicros,
      workstationId: agentSession.workstationId,
      workstationName: workstation.name,
    })
    .from(agentSession)
    .innerJoin(workstation, eq(workstation.id, agentSession.workstationId))
    .where(and(eq(workstation.userId, session.user.id), gte(agentSession.startedAt, from)))
    .orderBy(desc(agentSession.costMicros));

  const { totals, days, busiestDay, byWorkstation } = foldUsage(rows, from, WINDOW_DAYS);

  if (rows.length === 0) {
    return (
      <div className="container mx-auto p-6">
        <h1 className="mb-4 text-2xl font-semibold">Usage</h1>
        <Empty>
          <EmptyHeader>
            <EmptyTitle>Nothing synced in the last {WINDOW_DAYS} days</EmptyTitle>
            <EmptyDescription>
              Set <code>syncSessions: true</code> in your jarvis config and restart the TUI. Spend is
              only known for sessions that have been pushed up.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    );
  }

  return (
    <div className="container mx-auto flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Usage</h1>
        <p className="text-muted-foreground text-xs">
          Last {WINDOW_DAYS} days · {rows.length} session{rows.length === 1 ? "" : "s"}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-muted-foreground text-xs font-medium uppercase">Spend</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{money(totals.cost)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-muted-foreground text-xs font-medium uppercase">Turns</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totals.turns}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-muted-foreground text-xs font-medium uppercase">Tokens</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{thousands(totals.tokens)}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Spend by day</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex h-32 items-end gap-px">
            {days.map((day) => (
              <div
                key={day.key}
                className="group relative flex h-full flex-1 items-end"
                title={`${day.key} — ${money(day.cost)}, ${day.sessions} session${day.sessions === 1 ? "" : "s"}`}
              >
                {/* A day too cheap to round to a visible height still gets a baseline: a bar
                    that vanishes is indistinguishable from no traffic at all. */}
                <div
                  className={day.cost > 0 ? "bg-primary w-full rounded-t" : "bg-border w-full"}
                  style={{ height: busiestDay > 0 ? `${Math.max((day.cost / busiestDay) * 100, day.cost > 0 ? 2 : 1)}%` : "1%" }}
                />
              </div>
            ))}
          </div>
          <div className="text-muted-foreground mt-2 flex justify-between text-xs">
            <span>{days[0]?.key}</span>
            <span>{days.at(-1)?.key}</span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Spend by workstation</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {byWorkstation.map((entry) => (
            <div key={entry.name} className="flex flex-col gap-1">
              <div className="flex justify-between text-sm">
                <span>{entry.name}</span>
                <span className="text-muted-foreground">
                  {money(entry.cost)} · {entry.sessions} session{entry.sessions === 1 ? "" : "s"}
                </span>
              </div>
              <div className="bg-muted h-2 overflow-hidden rounded">
                <div
                  className="bg-primary h-full"
                  style={{ width: totals.cost > 0 ? `${(entry.cost / totals.cost) * 100}%` : "0%" }}
                />
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Most expensive sessions</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Session</TableHead>
                <TableHead>Workstation</TableHead>
                <TableHead className="text-right">Turns</TableHead>
                <TableHead className="text-right">Tokens</TableHead>
                <TableHead className="text-right">Cost</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.slice(0, TOP_SESSIONS).map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-medium">
                    <Link href={`/app/sessions/${row.id}`} className="hover:underline">
                      {row.title}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-xs">{row.workstationName}</TableCell>
                  <TableCell className="text-right">{row.turns}</TableCell>
                  <TableCell className="text-right text-xs">
                    {thousands(row.inputTokens)}/{thousands(row.outputTokens)}
                  </TableCell>
                  <TableCell className="text-right">{money(row.costMicros)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
