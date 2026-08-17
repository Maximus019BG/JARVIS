import { canDeleteDevice } from "~/server/device-auth";

/**
 * `DELETE /api/device/[deviceId]` is the one irreversible thing the token UI can do, and the
 * only guard on it is this predicate. Pinning it here — rather than trusting the handler —
 * follows `device-grants.test.ts`: the rule is kept out of the route precisely so it can be
 * checked without a database.
 */
describe("canDeleteDevice", () => {
  it("allows purging a device that has already been revoked", () => {
    expect(canDeleteDevice("revoked")).toBe(true);
  });

  it("refuses to purge a live device", () => {
    expect(canDeleteDevice("active")).toBe(false);
  });

  it("refuses any status it does not recognise", () => {
    // A status added later must fail closed: deleting the row would destroy the audit trail
    // of a credential that is, as far as this function knows, still usable.
    for (const status of ["", "pending", "suspended", "Revoked", "REVOKED"]) {
      expect(canDeleteDevice(status)).toBe(false);
    }
  });
});
