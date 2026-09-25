import { desc, eq } from "drizzle-orm";
import Link from "next/link";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "~/components/ui/empty";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import { getSession } from "~/lib/session";
import { db } from "~/server/db";
import { codeProject } from "~/server/db/schemas/code_project";
import { workstation } from "~/server/db/schemas/workstation";

export default async function CodePage() {
  const session = await getSession();
  if (!session?.user) return null;

  const rows = await db
    .select({
      id: codeProject.id,
      name: codeProject.name,
      version: codeProject.version,
      headSha: codeProject.headSha,
      updatedAt: codeProject.updatedAt,
      workstation: workstation.name,
    })
    .from(codeProject)
    .innerJoin(workstation, eq(workstation.id, codeProject.workstationId))
    .where(eq(workstation.userId, session.user.id))
    .orderBy(desc(codeProject.updatedAt))
    .limit(100);

  return (
    <div className="container mx-auto p-6">
      <h1 className="mb-4 text-2xl font-semibold">Code</h1>

      {rows.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No code projects yet</EmptyTitle>
            <EmptyDescription>
              In the TUI run <code>/code new &lt;name&gt;</code> (or{" "}
              <code>jarvis init</code> in an existing folder), then{" "}
              <code>/code push</code>. The device needs Code access under
              Settings → Devices first.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Project</TableHead>
                <TableHead>Workstation</TableHead>
                <TableHead>Head</TableHead>
                <TableHead>Updated</TableHead>
                <TableHead className="text-right">Version</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-medium">
                    <Link
                      href={`/app/code/${row.id}`}
                      className="hover:underline"
                    >
                      {row.name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-xs">
                    {row.workstation}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {row.headSha?.slice(0, 7) ?? "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-xs">
                    {row.updatedAt.toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right">v{row.version}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
