import { NextResponse } from "next/server";
import { authenticateDevice } from "~/server/device-auth";
import { signTicket } from "~/server/hand/ticket";

/** Trades a device token for a short-lived ticket. One DB query, then none per frame or find. */
export async function POST(request: Request) {
  const authed = await authenticateDevice(request);
  if (authed instanceof NextResponse) return authed;
  return NextResponse.json(signTicket(authed.device));
}
