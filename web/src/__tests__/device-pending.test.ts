import { mayActOnLink, normaliseUserCode } from "~/server/device-auth";

/**
 * Pairing requests can now be addressed to an account, which is what lets them show up in a
 * pending list instead of being found by typing a code. That makes "who may act on this
 * request" a real authorization question, and this is the whole of the answer — the routes
 * for approve, reject and lookup all defer to it.
 */
describe("mayActOnLink", () => {
  it("lets the addressed user act", () => {
    expect(mayActOnLink({ targetUserId: "user_a" }, "user_a")).toBe(true);
  });

  it("refuses everybody else, even holding the code", () => {
    // The whole point of addressing: a code read over a shoulder is no longer enough to
    // redeem a request into an unrelated account.
    expect(mayActOnLink({ targetUserId: "user_a" }, "user_b")).toBe(false);
  });

  it("leaves an unaddressed request open to whoever holds the code", () => {
    // The behaviour that shipped before requests could be addressed; `/pair` without an
    // email still has to work.
    expect(mayActOnLink({ targetUserId: null }, "user_a")).toBe(true);
    expect(mayActOnLink({ targetUserId: null }, "user_b")).toBe(true);
  });

  it("fails closed on a missing user id", () => {
    // A caller that skipped its session check must not be handed a `true` here.
    expect(mayActOnLink({ targetUserId: null }, "")).toBe(false);
    expect(mayActOnLink({ targetUserId: "user_a" }, "")).toBe(false);
  });

  it("does not treat a lookalike id as the owner", () => {
    expect(mayActOnLink({ targetUserId: "user_a" }, "user_a ")).toBe(false);
    expect(mayActOnLink({ targetUserId: "user_a" }, "USER_A")).toBe(false);
    expect(mayActOnLink({ targetUserId: "user_a" }, "user_ab")).toBe(false);
  });
});

/**
 * Reject takes a code straight from a UI list and deletes on it, so the same normalisation
 * the approve path uses has to apply — otherwise a stored `WXYZ-3QF7` would not match the
 * `wxyz3qf7` a caller sent and the request would silently outlive its rejection.
 */
describe("normaliseUserCode", () => {
  it("accepts what a human or a client actually sends", () => {
    for (const input of ["WXYZ-3QF7", "wxyz3qf7", " wxyz-3qf7 ", "WXYZ 3QF7"]) {
      expect(normaliseUserCode(input)).toBe("WXYZ-3QF7");
    }
  });

  it("does not invent a code from something too short", () => {
    expect(normaliseUserCode("WXYZ")).toBe("WXYZ");
    expect(normaliseUserCode("")).toBe("");
  });
});
