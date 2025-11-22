import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { auth } from "~/lib/auth";
import { db } from "~/server/db";
import { workstation } from "~/server/db/schemas/workstation";

export async function POST(request: NextRequest) {
  const session = await auth.api.getSession({
    headers: request.headers,
  });

  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as {
    id: string;
    name: string;
    logo?: string;
  };

  const [createdWorkstation] = await db
    .insert(workstation)
    .values({
      id: body.id,
      name: body.name,
      logo: body.logo,
      userId: session.user.id,
      createdAt: new Date(),
      metadata: null,
    })
    .returning();

  return NextResponse.json(createdWorkstation);
}
