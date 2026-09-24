import { signTicket, TICKET_TTL_MS, verifyTicket } from "~/server/hand/ticket";

/**
 * The hand route's only auth. It skips the database on purpose (a frame cannot afford the
 * query), so everything a device token check would refuse has to be refused here instead.
 */
describe("hand tickets", () => {
  beforeEach(() => {
    process.env.BETTER_AUTH_SECRET = "a".repeat(32);
  });

  it("round-trips the device it was issued to", () => {
    const { ticket, expiresAt } = signTicket("dev_1", 1_000);
    expect(expiresAt).toBe(1_000 + TICKET_TTL_MS);
    expect(verifyTicket(ticket, 2_000)).toBe("dev_1");
  });

  it("refuses an expired ticket", () => {
    const { ticket } = signTicket("dev_1", 1_000);
    expect(verifyTicket(ticket, 1_000 + TICKET_TTL_MS)).toBeNull();
  });

  it("refuses a ticket whose payload was edited to another device", () => {
    const { ticket } = signTicket("dev_1", 1_000);
    const [, signature] = ticket.slice(4).split(".");
    const forged = Buffer.from(JSON.stringify({ d: "dev_2", exp: 9e15 })).toString("base64url");
    expect(verifyTicket(`jvh_${forged}.${signature}`, 2_000)).toBeNull();
  });

  it("refuses a ticket signed with a different secret", () => {
    const { ticket } = signTicket("dev_1", 1_000);
    process.env.BETTER_AUTH_SECRET = "b".repeat(32);
    expect(verifyTicket(ticket, 2_000)).toBeNull();
  });

  it("refuses device tokens and garbage", () => {
    expect(verifyTicket("jvd_abc", 0)).toBeNull();
    expect(verifyTicket("jvh_", 0)).toBeNull();
    expect(verifyTicket("jvh_x.y", 0)).toBeNull();
  });
});
