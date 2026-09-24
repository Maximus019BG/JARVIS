import { NextResponse } from "next/server";
import { authenticateDevice } from "~/server/device-auth";
import {
  classifyUpstream,
  failureHeaders,
  openAiErrorBody,
  redactSecrets,
  type GatewayFailure,
} from "./errors";
import { clientHeaders } from "./headers";
import { gatewayEnabled, keyFor } from "./keys";
import { checkLimits, reserveUsage, settleUsage } from "./meter";
import { AUDIO, type GatewayKeyName } from "./upstreams";

/** What a route hands the shared path once it has validated its own body. */
export type AudioCall = {
  upstream: { name: string; baseUrl: string; keyName: GatewayKeyName };
  model: string;
  path: string;
  body: BodyInit;
  headers?: Record<string, string>;
  costMicros: number;
};

export const audioFail = (failure: GatewayFailure) =>
  new NextResponse(JSON.stringify(openAiErrorBody(failure)), {
    status: failure.status,
    headers: failureHeaders(failure),
  });

/**
 * The part both audio routes share, in the chat route's order: enabled → device auth → size cap →
 * the route's own parse → limits → reserve → one upstream call → settle.
 *
 * The response body is passed through untouched, so speech audio streams to the TUI as it is
 * generated. Cost is known before the call (bytes in, or characters in), so the row is settled as
 * soon as the upstream answers rather than when the client finishes reading.
 */
export async function audioGateway(
  request: Request,
  parse: (request: Request) => Promise<AudioCall | GatewayFailure>,
): Promise<Response> {
  if (!gatewayEnabled()) {
    return audioFail({
      status: 503,
      code: "gateway_disabled",
      message: "this gateway is not enabled",
    });
  }

  const authed = await authenticateDevice(request);
  if (authed instanceof NextResponse) return authed;
  const { device } = authed;

  if (
    Number(request.headers.get("content-length") ?? 0) > AUDIO.maxAudioBytes
  ) {
    return audioFail({
      status: 413,
      code: "invalid_request",
      message: `body exceeds ${AUDIO.maxAudioBytes} bytes`,
    });
  }

  const call = await parse(request).catch((error: unknown): GatewayFailure => ({
    status: 400,
    code: "invalid_request",
    message: String(error),
  }));
  if ("status" in call) return audioFail(call);

  const apiKey = keyFor(call.upstream.keyName);
  if (!apiKey) {
    return audioFail({
      status: 503,
      code: "gateway_misconfigured",
      message: "voice is not configured on this server",
    });
  }

  const limited = await checkLimits(device.userId, device.id);
  if (limited) return audioFail(limited);

  const usageId = await reserveUsage({
    userId: device.userId,
    deviceId: device.id,
    workstationId: device.workstationId,
    requestedModel: call.model,
    streamed: false,
  });
  const target = { upstream: { name: call.upstream.name }, model: call.model };
  const started = Date.now();
  const timeout = AbortSignal.timeout(AUDIO.timeoutMs);

  let response: Response;
  try {
    response = await fetch(`${call.upstream.baseUrl}${call.path}`, {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, ...call.headers },
      body: call.body,
      signal: AbortSignal.any([request.signal, timeout]),
    });
  } catch (error) {
    const failure: GatewayFailure = timeout.aborted
      ? {
          status: 504,
          code: "upstream_timeout",
          message: "voice upstream timed out",
        }
      : {
          status: 502,
          code: "upstream_error",
          message: redactSecrets(String(error)),
        };
    await settleUsage(usageId, {
      status:
        failure.code === "upstream_timeout"
          ? "upstream_timeout"
          : "upstream_error",
      target,
    });
    return audioFail(failure);
  }

  if (!response.ok) {
    const failure = classifyUpstream(
      response.status,
      await response.text().catch(() => ""),
      response.headers.get("retry-after"),
    );
    await settleUsage(usageId, {
      status: "upstream_error",
      target,
      upstreamStatus: response.status,
    });
    return audioFail(failure);
  }

  await settleUsage(usageId, {
    status: "ok",
    target,
    costMicros: call.costMicros,
    upstreamStatus: response.status,
    latencyMs: Date.now() - started,
  });
  return new Response(response.body, {
    status: 200,
    headers: clientHeaders(response.headers, call.upstream.name, false),
  });
}
