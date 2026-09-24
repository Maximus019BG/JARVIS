import crypto from "node:crypto";
import { env } from "~/env";

/**
 * Short-lived tickets for the hand-tracking route.
 *
 * The hand route takes ~20 frames a second and a device-token check is a database query
 * (hundreds of ms against the remote DB), so the device authenticates once at
 * `/api/device/hand/ticket` and every frame after that is an HMAC check.
 *
 * ponytail: a revoked device keeps drawing until its ticket expires (TICKET_TTL_MS). Add a
 * revocation list if five minutes is ever too long.
 */
export const TICKET_TTL_MS = 5 * 60 * 1000;
const PREFIX = "jvh_";

/** Derived, so the auth secret itself never signs anything outside better-auth. */
const key = () => crypto.createHmac("sha256", env.BETTER_AUTH_SECRET).update("hand-ticket:v1").digest();
const sign = (payload: string) => crypto.createHmac("sha256", key()).update(payload).digest("base64url");

export function signTicket(deviceId: string, now = Date.now()): { ticket: string; expiresAt: number } {
  const expiresAt = now + TICKET_TTL_MS;
  const payload = Buffer.from(JSON.stringify({ d: deviceId, exp: expiresAt })).toString("base64url");
  return { ticket: `${PREFIX}${payload}.${sign(payload)}`, expiresAt };
}

/** The device id a ticket was issued to, or null if it is forged, malformed or expired. */
export function verifyTicket(ticket: string, now = Date.now()): string | null {
  if (!ticket.startsWith(PREFIX)) return null;
  const [payload, signature] = ticket.slice(PREFIX.length).split(".");
  if (!payload || !signature) return null;

  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null;

  try {
    const { d, exp } = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { d?: unknown; exp?: unknown };
    if (typeof d !== "string" || typeof exp !== "number" || exp <= now) return null;
    return d;
  } catch {
    return null;
  }
}
