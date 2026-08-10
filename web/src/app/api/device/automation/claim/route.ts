import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "~/server/db";
import { asText, failRun } from "~/server/automations/runner";
import { authenticateDevice } from "~/server/device-auth";

/**
 * A workstation asking for work. Also, incidentally, the whole scheduler: the poll doubles
 * as the device heartbeat (`authenticateDevice` bumps `lastSeenAt`) and as the sweeper for
 * jobs whose timeout has passed, so there is no cron and no worker process to run.
 */
export async function POST(request: Request) {
  const authed = await authenticateDevice(request);
  if (authed instanceof NextResponse) return authed;
  const { device } = authed;

  // Anything handed out and never answered inside its own timeout. Scoped to this
  // workstation so one user's poll never touches another's jobs.
  const stale = await db.execute<{ id: string; run_id: string }>(sql`
    UPDATE automation_job AS j
       SET status = 'failed',
           last_error = 'timed out waiting for the workstation',
           updated_at = now()
     WHERE j.status = 'running'
       AND j.locked_at IS NOT NULL
       AND j.locked_at + make_interval(secs => COALESCE((j.payload->>'timeoutSec')::int, 900)) < now()
       AND j.run_id IN (SELECT r.id FROM automation_run r WHERE r.workstation_id = ${device.workstationId})
    RETURNING j.id, j.run_id
  `);
  for (const row of stale) {
    await failRun(row.run_id, null, "the workstation did not answer in time");
  }

  // `FOR UPDATE SKIP LOCKED` is what makes this safe without a queue server: two devices
  // polling at once take different rows instead of the same one.
  const claimed = await db.execute<{ id: string; payload: Record<string, unknown> }>(sql`
    UPDATE automation_job
       SET status = 'running',
           locked_at = now(),
           locked_by = ${device.id},
           attempts = attempts + 1,
           updated_at = now()
     WHERE id = (
       SELECT j.id
         FROM automation_job j
         JOIN automation_run r ON r.id = j.run_id
        WHERE j.status = 'pending'
          AND j.available_at <= now()
          AND r.workstation_id = ${device.workstationId}
        ORDER BY j.created_at
        LIMIT 1
        FOR UPDATE SKIP LOCKED
     )
    RETURNING id, payload
  `);

  const job = claimed[0];
  if (!job) return NextResponse.json({ job: null });

  const payload = job.payload ?? {};
  return NextResponse.json({
    job: {
      id: job.id,
      prompt: asText(payload.prompt),
      cwd: asText(payload.cwd),
      model: asText(payload.model),
      timeoutSec: Number(payload.timeoutSec ?? 900),
    },
  });
}
