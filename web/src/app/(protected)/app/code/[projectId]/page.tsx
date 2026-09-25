import { desc, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { getSession } from "~/lib/session";
import { db } from "~/server/db";
import { codeProject, codeVersion } from "~/server/db/schemas/code_project";
import { workstation } from "~/server/db/schemas/workstation";

export default async function CodeProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ file?: string }>;
}) {
  const [{ projectId }, { file }] = await Promise.all([params, searchParams]);
  const session = await getSession();
  if (!session?.user) return null;

  const row = (
    await db
      .select({
        name: codeProject.name,
        version: codeProject.version,
        headSha: codeProject.headSha,
        files: codeProject.files,
        ownerId: workstation.userId,
      })
      .from(codeProject)
      .innerJoin(workstation, eq(workstation.id, codeProject.workstationId))
      .where(eq(codeProject.id, projectId))
      .limit(1)
  )[0];
  // 404 rather than 403, as for sessions: whether an id exists is itself information.
  if (row?.ownerId !== session.user.id) notFound();

  const versions = await db
    .select({
      version: codeVersion.version,
      sha: codeVersion.commitSha,
      message: codeVersion.message,
      at: codeVersion.createdAt,
    })
    .from(codeVersion)
    .where(eq(codeVersion.projectId, projectId))
    .orderBy(desc(codeVersion.version))
    .limit(50);

  const files = JSON.parse(row.files) as Record<string, string>;
  const paths = Object.keys(files).sort();
  const selected =
    file && file in files
      ? file
      : (paths.find((path) => /^readme/i.test(path)) ?? paths[0]);

  return (
    <div className="container mx-auto p-6">
      <Link
        href="/app/code"
        className="text-muted-foreground text-sm hover:underline"
      >
        ← Code
      </Link>
      <h1 className="mt-2 text-2xl font-semibold">{row.name}</h1>
      <p className="text-muted-foreground mb-6 text-xs">
        v{row.version} ·{" "}
        <span className="font-mono">{row.headSha?.slice(0, 7)}</span> ·{" "}
        {paths.length} files · pull it on another device with{" "}
        <code>/code clone {row.name}</code>
      </p>

      <div className="grid gap-4 lg:grid-cols-[16rem_1fr]">
        <Card className="self-start">
          <CardHeader>
            <CardTitle className="text-sm">Files</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-1 text-xs">
            {paths.map((path) => (
              <Link
                key={path}
                href={`?file=${encodeURIComponent(path)}`}
                className={`truncate font-mono hover:underline ${path === selected ? "font-semibold" : "text-muted-foreground"}`}
              >
                {path}
              </Link>
            ))}
          </CardContent>
        </Card>

        <Card className="min-w-0">
          <CardHeader>
            <CardTitle className="font-mono text-sm">
              {selected ?? "no text files"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {selected && (
              <pre className="overflow-x-auto text-xs leading-relaxed">
                {files[selected]}
              </pre>
            )}
          </CardContent>
        </Card>
      </div>

      <h2 className="mt-8 mb-2 text-lg font-semibold">History</h2>
      <ul className="text-sm">
        {versions.map((entry) => (
          <li key={entry.version} className="flex gap-3 border-b py-1.5">
            <span className="text-muted-foreground w-10">v{entry.version}</span>
            <span className="font-mono text-xs">{entry.sha.slice(0, 7)}</span>
            <span className="flex-1 truncate">{entry.message}</span>
            <span className="text-muted-foreground text-xs">
              {entry.at.toLocaleString()}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
