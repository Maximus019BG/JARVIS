import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { auth } from "~/lib/auth";
import { db } from "~/server/db";
import { workstation } from "~/server/db/schemas/workstation";
import { eq } from "drizzle-orm";

export async function GET(request: NextRequest) {
  const session = await auth.api.getSession({
    headers: request.headers,
  });

  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const workstations = await db
    .select()
    .from(workstation)
    .where(eq(workstation.userId, session.user.id));

  return NextResponse.json(workstations);
}
