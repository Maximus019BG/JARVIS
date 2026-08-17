import crypto from "node:crypto";
import { and, eq, isNull, or } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "~/server/db";
import { device } from "~/server/db/schemas/device";
import { deviceGrant } from "~/server/db/schemas/device_grant";

/** `jvd_` marks a jarvis device token, so a stray value in a log is recognisable. */
export const TOKEN_PREFIX = "jvd_";

/**
 * A short code a human retypes off a terminal or a projected surface. Crockford base32
 * without I, L, O and U: no character can be confused for another, and no four-letter
 * word can appear by accident. 8 characters is ~40 bits, which is far more than a
 * ten-minute window with a 10-per-hour attempt cap can be brute-forced through.
 */
const CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export const sha256 = (value: string): string => crypto.createHash("sha256").update(value, "utf8").digest("hex");

function randomFrom(alphabet: string, length: number): string {
  // Rejection sampling: `% alphabet.length` on a raw byte would make the first
  // 256 % 32 characters slightly likelier, and a code generator should not be biased.
  const out: string[] = [];
  while (out.length < length) {
    for (const byte of crypto.randomBytes(length * 2)) {
      if (out.length === length) break;
      if (byte < 256 - (256 % alphabet.length)) out.push(alphabet[byte % alphabet.length]!);
    }
  }
  return out.join("");
}

/** `WXYZ-3QF7` */
export const newUserCode = (): string => {
  const raw = randomFrom(CODE_ALPHABET, 8);
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
};

export const newDeviceCode = (): string => crypto.randomBytes(32).toString("base64url");

export const newToken = (): string => `${TOKEN_PREFIX}${crypto.randomBytes(32).toString("base64url")}`;

/** Accepts what a human types: lowercase, missing hyphen, surrounding spaces. */
export function normaliseUserCode(input: string): string {
  const raw = input
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, "")
    .slice(0, 8);
  return raw.length === 8 ? `${raw.slice(0, 4)}-${raw.slice(4)}` : raw;
}

export const CODE_TTL_MS = 10 * 60 * 1000;
export const POLL_INTERVAL_SECONDS = 5;

export type DeviceAuth = { device: typeof device.$inferSelect };

/**
 * Resolves a `Authorization: Bearer jvd_…` header to a device row.
 *
 * The stored value is a sha256, so the lookup is by hash and the comparison is
 * `timingSafeEqual` on top — a plain `eq` in SQL already leaks little, but the extra
 * compare costs nothing and keeps the property obvious to the next reader.
 */
export async function authenticateDevice(request: Request): Promise<DeviceAuth | NextResponse> {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token.startsWith(TOKEN_PREFIX)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const hash = sha256(token);
  const rows = await db.select().from(device).where(eq(device.tokenHash, hash)).limit(1);
  const found = rows[0];
  if (!found?.tokenHash || found.status !== "active" || found.isActive === false) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const a = Buffer.from(found.tokenHash, "utf8");
  const b = Buffer.from(hash, "utf8");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Deliberately not awaited-and-checked: a failed heartbeat must not fail the request.
  void db.update(device).set({ lastSeenAt: new Date() }).where(eq(device.id, found.id));

  return { device: found };
}

/**
 * Whether a device may touch one blueprint. A grant with a NULL `blueprint_id` covers
 * every blueprint in the workstation, including ones created after the grant was made.
 *
 * This is the authorization boundary. The UI showing a narrower list is a convenience;
 * a device that asks for something outside its grants gets a 403 from here.
 */
export async function hasGrant(
  deviceId: string,
  blueprintId: string,
  need: "read" | "write",
): Promise<boolean> {
  const grants = await db
    .select({ mode: deviceGrant.mode })
    .from(deviceGrant)
    .where(
      and(
        eq(deviceGrant.deviceId, deviceId),
        or(isNull(deviceGrant.blueprintId), eq(deviceGrant.blueprintId, blueprintId)),
      ),
    );
  if (grants.length === 0) return false;
  return need === "read" ? true : grants.some((grant) => grant.mode === "write");
}

/** What a device may reach: every blueprint in its workstation, or an explicit set. */
export type Readable = "all" | Set<string>;

/**
 * The reachability rule, kept pure so it can be tested without a database.
 *
 * Mirrors `hasGrant(..., "read")`: a NULL `blueprint_id` is the workstation-wide grant and
 * outranks the specific ones, and mode is irrelevant because a write grant implies read.
 */
export function grantsToReadable(grants: { blueprintId: string | null }[]): Readable {
  if (grants.some((grant) => grant.blueprintId === null)) return "all";

  const ids = new Set<string>();
  for (const grant of grants) if (grant.blueprintId) ids.add(grant.blueprintId);
  return ids;
}

/**
 * Which blueprints a device may read, resolved in one query.
 *
 * Lives here rather than in the caller so the authorization boundary stays in one file.
 * Callers filtering a list must use this: asking `hasGrant` per row is one round trip per
 * blueprint, and the database is remote.
 */
export async function readableBlueprintIds(deviceId: string): Promise<Readable> {
  return grantsToReadable(
    await db
      .select({ blueprintId: deviceGrant.blueprintId })
      .from(deviceGrant)
      .where(eq(deviceGrant.deviceId, deviceId)),
  );
}

export const forbidden = (detail: string) => NextResponse.json({ error: "Forbidden", detail }, { status: 403 });
