import { NextResponse } from "next/server";
import { auth } from "~/lib/auth";
import type { blueprint } from "~/server/db/schemas/blueprint";
import { ownsBlueprint } from "~/server/ownership";

export type SessionBlueprint = {
  userId: string;
  blueprint: typeof blueprint.$inferSelect;
};

/**
 * The session-side counterpart to `authenticateDevice`: signed-in user, blueprint exists,
 * and the workstation holding it belongs to them. Every browser-facing blueprint route
 * starts here, so the ownership check cannot be forgotten in one of them.
 *
 * The rule itself is in `~/server/ownership`, which the MCP server uses directly — this file
 * exists only to turn it into HTTP.
 */
export async function requireBlueprint(
  request: Request,
  blueprintId: string,
): Promise<SessionBlueprint | NextResponse> {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const found = await ownsBlueprint(session.user.id, blueprintId);
  if (found === "not_found") return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (found === "forbidden") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  return { userId: session.user.id, blueprint: found };
}
