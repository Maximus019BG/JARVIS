import { createMcpHandler, withMcpAuth } from "mcp-handler";

import { toContext, verifyMcpToken } from "~/server/mcp/auth";
import { registerTools } from "~/server/mcp/registry";

/**
 * JARVIS cloud as an MCP server.
 *
 * Auth is the existing `jvd_` device token, so a client is paired the same way a TUI or a Pi
 * is, and revoking it revokes MCP access too. What the token may *do* comes from
 * `device.scopes`.
 *
 * The token is verified once, up front, and used twice: `withMcpAuth` turns a missing one
 * into an RFC 9728 `401` challenge, and `registerTools` uses its scopes to decide which
 * tools exist for this request. Building the handler per request is what makes that second
 * use possible — `createMcpHandler` constructs a fresh `McpServer` per call, but its factory
 * cannot see the request, so the closure has to.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function mcp(request: Request): Promise<Response> {
  const authInfo = await verifyMcpToken(request);

  const handler = createMcpHandler(
    (server) => {
      // Unauthenticated requests still build a server so `withMcpAuth` can answer the
      // handshake with a proper challenge rather than an empty tool list.
      if (authInfo) registerTools(server, toContext(authInfo));
    },
    { serverInfo: { name: "jarvis-cloud", version: "1.0.0" } },
  );

  return withMcpAuth(handler, async () => authInfo, {
    required: true,
    resourceMetadataPath: "/.well-known/oauth-protected-resource",
  })(request);
}

export { mcp as GET, mcp as POST };
