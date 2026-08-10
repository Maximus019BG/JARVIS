import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { nanoid } from "nanoid";
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "~/lib/auth";
import { sendPushNotification } from "~/lib/notifications";
import { db } from "~/server/db";
import { getExpoPushTokensByUserId } from "~/server/db/queries/session";
import { approval } from "~/server/db/schemas/approval";
import { device } from "~/server/db/schemas/device";
import { authenticateDevice } from "~/server/device-auth";

/** How long a device is willing to wait, and how long the row is answerable for. */
const TTL_MS = 5 * 60 * 1000;
const POLL_INTERVAL_SECONDS = 3;

const bodySchema = z.object({
  tool: z.string().min(1).max(64),
  title: z.string().min(1).max(200),
  /** A diff can be arbitrarily long; the prompt only needs enough to decide by. */
  detail: z.string().max(4000).optional(),
  detailKind: z.enum(["diff", "text"]).optional(),
  subject: z.string().max(2000).optional(),
});

/** A blocked device announcing that it needs an answer. */
export async function POST(request: Request) {
  const authed = await authenticateDevice(request);
  if (authed instanceof NextResponse) return authed;

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const id = `apr_${nanoid(16)}`;
  await db.insert(approval).values({
    id,
    deviceId: authed.device.id,
    tool: body.tool,
    title: body.title,
    detail: body.detail,
    detailKind: body.detailKind,
    subject: body.subject,
    expiresAt: new Date(Date.now() + TTL_MS),
  });

  // Deliberately not awaited: an agent is blocked on this response, and a slow or dead
  // Expo must not hold it up. Push is a nudge — the row is answerable in the web app
  // whether or not the notification ever lands.
  void getExpoPushTokensByUserId(authed.device.userId)
    .then((tokens) =>
      Promise.all(
        tokens.map((token) =>
          sendPushNotification(token, `${authed.device.name} needs approval`, body.title).catch(
            (error: unknown) => console.error("approval push failed:", error),
          ),
        ),
      ),
    )
    .catch((error: unknown) => console.error("approval push lookup failed:", error));

  return NextResponse.json({ id, interval: POLL_INTERVAL_SECONDS, expiresIn: TTL_MS / 1000 });
}

/** Everything the signed-in user could answer right now, for the web card and the app. */
export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rows = await db
    .select({
      id: approval.id,
      tool: approval.tool,
      title: approval.title,
      detail: approval.detail,
      detailKind: approval.detailKind,
      createdAt: approval.createdAt,
      expiresAt: approval.expiresAt,
      deviceName: device.name,
    })
    .from(approval)
    .innerJoin(device, eq(device.id, approval.deviceId))
    .where(
      and(eq(device.userId, session.user.id), isNull(approval.answer), gt(approval.expiresAt, new Date())),
    )
    .orderBy(desc(approval.createdAt));

  return NextResponse.json({ approvals: rows });
}
