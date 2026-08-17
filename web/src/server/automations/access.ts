import { NextResponse } from "next/server";
import { auth } from "~/lib/auth";
import type { automation } from "~/server/db/schemas/automation";
import { ownsAutomation } from "~/server/ownership";

export type SessionAutomation = {
  userId: string;
  automation: typeof automation.$inferSelect;
};

/**
 * The signed-in-owner check every automation route repeats, wrapped around
 * `ownsAutomation`.
 *
 * Returns the automation row, or the `NextResponse` to return instead — the same shape
 * `requireBlueprint` uses, so a handler is one `instanceof` away from either carrying on or
 * bailing out. `userId` comes back with it because handlers that write a row need somebody
 * to stamp on it, and re-reading the session for that is a second round trip.
 *
 * The rule itself is in `~/server/ownership`, which the MCP server uses directly — this file
 * exists only to turn it into HTTP.
 */
export async function authorizeAutomation(
  request: Request,
  workstationId: string,
  automationId: string,
): Promise<SessionAutomation | NextResponse> {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const found = await ownsAutomation(session.user.id, workstationId, automationId);
  if (found === "forbidden") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (found === "not_found") return NextResponse.json({ error: "Not found" }, { status: 404 });
  return { userId: session.user.id, automation: found };
}
