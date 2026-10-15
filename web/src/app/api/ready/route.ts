import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "~/server/db";

export const dynamic = "force-dynamic";

/** Readiness: this pod can reach Postgres, so nginx may send it traffic. */
export async function GET() {
  try {
    await db.execute(sql`select 1`);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false, error: "database unreachable" }, { status: 503 });
  }
}
