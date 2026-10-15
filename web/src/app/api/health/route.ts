import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Liveness: the process is up and serving. Deliberately touches nothing else, so a database
 * outage marks pods unready (`/api/ready`) instead of restarting every one of them.
 */
export function GET() {
  return NextResponse.json({ ok: true });
}
