import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";

const ACTIVE_WORKSTATION_COOKIE = "active_workstation_id";

export async function GET() {
  const cookieStore = await cookies();
  const activeId = cookieStore.get(ACTIVE_WORKSTATION_COOKIE)?.value;

  if (!activeId) {
    return NextResponse.json(null);
  }

  return NextResponse.json({ id: activeId });
}

export async function POST(request: NextRequest) {
  const body = (await request.json()) as { workstationId: string };
  const cookieStore = await cookies();

  cookieStore.set(ACTIVE_WORKSTATION_COOKIE, body.workstationId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 365, // 1 year
  });

  return NextResponse.json({ success: true });
}
