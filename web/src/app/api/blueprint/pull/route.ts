import { asc, eq, gt } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "~/server/db";
import { blueprint } from "~/server/db/schemas/blueprint";
import { blueprintVersion } from "~/server/db/schemas/blueprint_version";
import { authenticateDevice, forbidden, hasGrant } from "~/server/device-auth";

const MAX_COMMITS = 200;

/**
 * Commits the device does not have yet. With no `blueprintId` it lists what this device
 * may reach, so a fresh Pi can discover its work without being told what exists.
 */
export async function GET(request: Request) {
  const authed = await authenticateDevice(request);
  if (authed instanceof NextResponse) return authed;
  const { device } = authed;

  const params = new URL(request.url).searchParams;
  const blueprintId = params.get("blueprintId");

  if (!blueprintId) {
    const all = await db
      .select({ id: blueprint.id, name: blueprint.name, version: blueprint.version, updatedAt: blueprint.updatedAt })
      .from(blueprint)
      .where(eq(blueprint.workstationId, device.workstationId));
    const reachable = [];
    for (const row of all) {
      if (await hasGrant(device.id, row.id, "read")) reachable.push(row);
    }
    return NextResponse.json({ success: true, blueprints: reachable });
  }

  if (!(await hasGrant(device.id, blueprintId, "read"))) {
    return forbidden("this device has no grant for that blueprint");
  }

  const owner = (
    await db.select().from(blueprint).where(eq(blueprint.id, blueprintId)).limit(1)
  )[0];
  if (!owner) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (owner.workstationId !== device.workstationId) return forbidden("blueprint belongs to another workstation");

  const since = params.get("since");
  let after = 0;
  if (since) {
    const found = (
      await db
        .select({ version: blueprintVersion.version })
        .from(blueprintVersion)
        .where(eq(blueprintVersion.commitSha, since))
        .limit(1)
    )[0];
    // An unknown `since` means the device is on a history the server has never seen.
    // Sending everything is the only safe answer; the client merges.
    after = found?.version ?? 0;
  }

  const commits = await db
    .select()
    .from(blueprintVersion)
    .where(after > 0 ? gt(blueprintVersion.version, after) : eq(blueprintVersion.blueprintId, blueprintId))
    .orderBy(asc(blueprintVersion.version))
    .limit(MAX_COMMITS + 1);

  const scoped = commits.filter((row) => row.blueprintId === blueprintId);
  const truncated = scoped.length > MAX_COMMITS;

  return NextResponse.json({
    success: true,
    name: owner.name,
    commits: scoped.slice(0, MAX_COMMITS).map((row) => ({
      sha: row.commitSha,
      parentSha: row.parentSha,
      message: row.message,
      version: row.version,
      at: row.createdAt,
      doc: JSON.parse(row.metadata) as unknown,
    })),
    // Never pretend a truncated answer was the whole history.
    truncated,
  });
}
