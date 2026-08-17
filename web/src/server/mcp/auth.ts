import type { AuthInfo } from "@modelcontextprotocol/server";

import { bearerToken, resolveDeviceToken } from "~/server/device-auth";
import type { McpContext } from "~/server/mcp/types";

/**
 * The MCP side of `authenticateDevice`: same `jvd_` token, same hash lookup, no
 * `NextResponse`.
 *
 * Returns the SDK's `AuthInfo` because `withMcpAuth` speaks that shape and turns a missing
 * one into an RFC 9728 `401` for free. The device row travels in `extra` so the tool
 * registry can build its context without a second query.
 */
export async function verifyMcpToken(request: Request): Promise<AuthInfo | undefined> {
  const token = bearerToken(request);
  if (!token) return undefined;

  const device = await resolveDeviceToken(token);
  if (!device) return undefined;

  return {
    token,
    clientId: device.id,
    scopes: device.scopes,
    extra: {
      deviceId: device.id,
      workstationId: device.workstationId,
      userId: device.userId,
      device,
    },
  };
}

/** `AuthInfo` back to the context tools actually use. */
export function toContext(auth: AuthInfo): McpContext {
  const extra = auth.extra as unknown as Pick<McpContext, "device" | "deviceId" | "workstationId" | "userId">;
  return { ...extra, scopes: auth.scopes };
}
