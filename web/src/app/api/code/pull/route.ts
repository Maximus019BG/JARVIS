import { and, asc, eq, gt } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "~/server/db";
import { codeProject, codeVersion } from "~/server/db/schemas/code_project";
import { authenticateDevice, forbidden } from "~/server/device-auth";
import { satisfies } from "~/server/mcp/scopes";

/**
 * Without `projectId`, the workstation's projects. With it, every bundle after `since` in
 * order — all of them when `since` is missing or unknown, which is what a clone asks for.
 */
export async function GET(request: Request) {
  const authed = await authenticateDevice(request);
  if (authed instanceof NextResponse) return authed;
  const { device } = authed;
  if (!satisfies(device.scopes, "code:read"))
    return forbidden("this device may not read code");

  const params = new URL(request.url).searchParams;
  const projectId = params.get("projectId");

  if (!projectId) {
    const projects = await db
      .select({
        id: codeProject.id,
        name: codeProject.name,
        version: codeProject.version,
        headSha: codeProject.headSha,
        updatedAt: codeProject.updatedAt,
      })
      .from(codeProject)
      .where(eq(codeProject.workstationId, device.workstationId));
    return NextResponse.json({ success: true, projects });
  }

  const project = (
    await db
      .select({
        name: codeProject.name,
        headSha: codeProject.headSha,
        version: codeProject.version,
      })
      .from(codeProject)
      .where(
        and(
          eq(codeProject.id, projectId),
          eq(codeProject.workstationId, device.workstationId),
        ),
      )
      .limit(1)
  )[0];
  if (!project)
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  const since = params.get("since");
  const after = since
    ? ((
        await db
          .select({ version: codeVersion.version })
          .from(codeVersion)
          .where(
            and(
              eq(codeVersion.projectId, projectId),
              eq(codeVersion.commitSha, since),
            ),
          )
          .limit(1)
      )[0]?.version ?? 0)
    : 0;

  // ponytail: every missing bundle in one response; page it if clones start timing out.
  const bundles = await db
    .select({
      sha: codeVersion.commitSha,
      version: codeVersion.version,
      bundle: codeVersion.bundle,
    })
    .from(codeVersion)
    .where(
      and(eq(codeVersion.projectId, projectId), gt(codeVersion.version, after)),
    )
    .orderBy(asc(codeVersion.version));

  return NextResponse.json({
    success: true,
    name: project.name,
    head: project.headSha,
    version: project.version,
    bundles,
  });
}
