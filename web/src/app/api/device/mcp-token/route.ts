import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "~/lib/auth";
import { db } from "~/server/db";
import { blueprint } from "~/server/db/schemas/blueprint";
import { device } from "~/server/db/schemas/device";
import { deviceGrant } from "~/server/db/schemas/device_grant";
import { newToken, sha256, TOKEN_PREFIX } from "~/server/device-auth";
import { isMcpScope } from "~/server/mcp/scopes";
import { ownsWorkstation } from "~/server/ownership";

/**
 * Mints a bearer token for an MCP client.
 *
 * A `device` row rather than a fourth kind of credential: `authenticateDevice`, revocation,
 * `last_seen_at` and the blueprint grant model all already work on one, and an MCP client is
 * a paired machine by any other name. `platform: "mcp"` is what the UI lists it as.
 *
 * Unlike the pairing flow — where the device mints its own token on its next poll and
 * nothing readable is ever stored — an MCP client cannot poll, so the token is generated
 * here and returned **once**. Only its sha256 is persisted.
 */

const bodySchema = z.object({
  workstationId: z.string().min(1),
  name: z.string().trim().min(1).max(64),
  /** Unknown strings are rejected rather than stored: a typo'd scope must not look granted. */
  scopes: z.array(z.string()).max(64).refine((all) => all.every(isMcpScope), {
    message: "unknown scope",
  }),
  blueprintIds: z.array(z.string()).default([]),
  allBlueprints: z.boolean().default(false),
  mode: z.enum(["read", "write"]).default("read"),
});

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch (error) {
    return NextResponse.json(
      { error: "invalid_request", detail: error instanceof z.ZodError ? error.issues.slice(0, 5) : undefined },
      { status: 400 },
    );
  }

  if (!(await ownsWorkstation(session.user.id, body.workstationId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Every named blueprint must live in the workstation being granted, or this route becomes
  // a way to hand a token access to somebody else's drawing.
  const requested = [...new Set(body.blueprintIds)];
  if (requested.length > 0) {
    const found = await db
      .select({ id: blueprint.id })
      .from(blueprint)
      .where(eq(blueprint.workstationId, body.workstationId));
    const allowed = new Set(found.map((row) => row.id));
    if (requested.some((id) => !allowed.has(id))) {
      return NextResponse.json({ error: "blueprint_not_in_workstation" }, { status: 400 });
    }
  }

  const token = newToken();
  const deviceId = `dev_${nanoid(16)}`;
  const now = new Date();
  const scopes = [...new Set(body.scopes)];

  await db.transaction(async (tx) => {
    await tx.insert(device).values({
      id: deviceId,
      name: body.name,
      workstationId: body.workstationId,
      userId: session.user.id,
      tokenHash: sha256(token),
      tokenPrefix: token.slice(0, TOKEN_PREFIX.length + 6),
      platform: "mcp",
      status: "active",
      scopes,
      approvedBy: session.user.id,
      approvedAt: now,
      createdAt: now,
    });

    const grants = body.allBlueprints
      ? [{ blueprintId: null as string | null }]
      : requested.map((blueprintId) => ({ blueprintId }));
    if (grants.length > 0) {
      await tx.insert(deviceGrant).values(
        grants.map((grant) => ({
          id: `grt_${nanoid(16)}`,
          deviceId,
          blueprintId: grant.blueprintId,
          mode: body.mode,
          createdBy: session.user.id,
          createdAt: now,
        })),
      );
    }
  });

  return NextResponse.json({
    success: true,
    // The only time this value exists in readable form. The client stores it or loses it.
    token,
    device: { id: deviceId, name: body.name, scopes },
  });
}
