import { NextResponse } from "next/server";
import { authenticateDevice } from "~/server/device-auth";
import { failureHeaders, openAiErrorBody } from "~/server/gateway/errors";
import { gatewayEnabled, keyFor } from "~/server/gateway/keys";
import { catalog } from "~/server/gateway/resolve";
import { UPSTREAMS } from "~/server/gateway/upstreams";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `GET /api/gateway/v1/models` — the catalog, synthesized from the routing table.
 *
 * Authenticated, even though the response holds no secrets: an open catalog tells anyone who
 * asks which providers the owner pays for. `client.models.list()` sends the key anyway, so no
 * generic client is inconvenienced by requiring it.
 */
export async function GET(request: Request) {
  if (!gatewayEnabled()) {
    const failure = { status: 503 as const, code: "gateway_disabled" as const, message: "this gateway is not enabled" };
    return new NextResponse(JSON.stringify(openAiErrorBody(failure)), { status: 503, headers: failureHeaders(failure) });
  }

  const authed = await authenticateDevice(request);
  if (authed instanceof NextResponse) return authed;

  // Only upstreams whose key is actually set. Advertising a model that fails on first use is
  // worse than not advertising it — the reader picks it, it breaks, and nothing says why.
  const configured = UPSTREAMS.filter((upstream) => upstream.enabled && keyFor(upstream.keyName));
  return NextResponse.json({ object: "list", data: catalog(configured) });
}
