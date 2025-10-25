import { NextResponse } from "next/server";
import { auth } from "~/lib/auth";
import { db } from "~/server/db";
import { workstation } from "~/server/db/schemas/workstation";
import { eq } from "drizzle-orm";

export async function GET() {
  const session = await auth.api.getSession({
    headers: await Promise.resolve(new Headers()),
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
