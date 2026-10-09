import path from "node:path";
import { createEmbedder, type Embedder } from "@pi/items.ts";
import jpeg from "jpeg-js";
import { NextResponse } from "next/server";
import { authenticateDevice, bearerToken, forbidden } from "~/server/device-auth";
import { verifyTicket } from "~/server/hand/ticket";
import { satisfies, type McpScope } from "~/server/mcp/scopes";

/**
 * What `/api/vision/items` and `/api/vision/detect` share: the model, the JPEG decoder, the
 * auth check and how a taught item is stored. The matching itself is `@pi/items.ts`.
 */

/** Where to drop the model. Traced into both routes by `outputFileTracingIncludes`. */
const MODEL = path.join(process.cwd(), "models", "items", "dinov2-small.onnx");

let embedder: Promise<Embedder> | undefined;
export const getEmbedder = () =>
  (embedder ??= (async () => {
    const ort = await import("onnxruntime-node");
    return createEmbedder(ort, MODEL);
  })().catch((error: unknown) => {
    // A missing model must not be cached forever: the next request tries again.
    embedder = undefined;
    throw error;
  }));

export const modelMissing = (error: unknown) => {
  console.error("vision model failed to load:", error instanceof Error ? error.message : error);
  return NextResponse.json({ error: "vision model is not installed on the server" }, { status: 503 });
};

/**
 * Packed RGB, or null when it is not a JPEG. The resolution and memory caps are the
 * decompression-bomb guard: a tiny JPEG can claim to be enormous. 4MP is plenty, since
 * the model sees 448px; phones should downscale before sending.
 */
export function decodeJpeg(bytes: Uint8Array): { width: number; height: number; data: Uint8Array } | null {
  try {
    return jpeg.decode(bytes, { useTArray: true, formatAsRGBA: false, maxResolutionInMP: 4, maxMemoryUsageInMB: 64 });
  } catch {
    return null;
  }
}

/** The calling device, or the 401/403 to return. */
export async function deviceFor(request: Request, need: McpScope) {
  const authed = await authenticateDevice(request);
  if (authed instanceof NextResponse) return authed;
  return satisfies(authed.device.scopes, need) ? authed.device : forbidden(`this device lacks ${need}`);
}

/**
 * The calling device's workstation, from a `jvh_` ticket when there is one, or the 401/403.
 * A ticket is an HMAC check rather than a database round trip, which is most of a find's
 * latency against the remote DB. Only for routes that need nothing but the workstation.
 */
export async function callerFor(request: Request, need: McpScope) {
  const token = bearerToken(request);
  if (!token.startsWith("jvh_")) return deviceFor(request, need);
  const ticket = verifyTicket(token);
  if (!ticket) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return satisfies(ticket.scopes, need) ? ticket : forbidden(`this device lacks ${need}`);
}

/**
 * A bank of unit vectors as base64 int8: each component times 127. A quarter the size of
 * float32, which matters because detect reads every item over a ~120ms round trip, and the
 * rounding (at most 1/254 per component) is far below any threshold worth setting.
 */
export const packBank = (bank: Float32Array): string =>
  Buffer.from(Int8Array.from(bank, (value) => Math.round(value * 127)).buffer).toString("base64");

export function unpackBank(text: string): Float32Array {
  const bytes = Buffer.from(text, "base64");
  return Float32Array.from(new Int8Array(bytes.buffer, bytes.byteOffset, bytes.length), (value) => value / 127);
}
