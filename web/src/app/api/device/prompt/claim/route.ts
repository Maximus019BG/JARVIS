import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "~/server/db";
import { authenticateDevice } from "~/server/device-auth";
import { z } from "zod";

const bodySchema = z.object({ sessionId: z.string().min(1).max(64) });

/**
 * A terminal asking whether anybody typed something for the session it is running.
 *
 * The claim is a conditional `UPDATE` off `pending` with `FOR UPDATE SKIP LOCKED`, the same
 * shape the automation job queue uses: two terminals polling at once take different rows, and
 * a prompt can never be delivered twice — which matters more here than for a job, because a
 * replayed prompt is an agent doing the same work again for real.
 *
 * Scoped to the device's own workstation in the SQL rather than checked afterwards, so a
 * device asking for somebody else's session id simply matches nothing.
 */
export async function POST(request: Request) {
  const authed = await authenticateDevice(request);
  if (authed instanceof NextResponse) return authed;
  const { device } = authed;

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const claimed = await db.execute<{ id: string; prompt: string }>(sql`
    UPDATE session_prompt
       SET status = 'delivered',
           delivered_at = now()
     WHERE id = (
       SELECT p.id
         FROM session_prompt p
         JOIN agent_session s ON s.id = p.session_id
        WHERE p.status = 'pending'
          AND p.session_id = ${body.sessionId}
          AND s.workstation_id = ${device.workstationId}
        ORDER BY p.created_at
        LIMIT 1
        FOR UPDATE SKIP LOCKED
     )
    RETURNING id, prompt
  `);

  const row = claimed[0];
  // `null` rather than a 404: nothing waiting is the normal answer to almost every poll.
  return NextResponse.json({ prompt: row ? { id: row.id, prompt: row.prompt } : null });
}
