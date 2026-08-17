import { runBadgeVariant, unfinished } from "~/lib/automations/run-status";

describe("unfinished", () => {
  // This is the poll-stop condition on both runs pages: wrong in one direction spins
  // forever, wrong in the other leaves a suspended agent step looking abandoned.
  it("counts queued and running as still moving", () => {
    expect(unfinished("queued")).toBe(true);
    expect(unfinished("running")).toBe(true);
  });

  it("counts every terminal status as finished", () => {
    for (const status of ["succeeded", "failed", "canceled", "skipped"]) {
      expect(unfinished(status)).toBe(false);
    }
  });
});

describe("runBadgeVariant", () => {
  it("marks failure and cancellation destructive", () => {
    expect(runBadgeVariant("failed")).toBe("destructive");
    expect(runBadgeVariant("canceled")).toBe("destructive");
  });

  it("marks success and in-flight distinctly", () => {
    expect(runBadgeVariant("succeeded")).toBe("default");
    expect(runBadgeVariant("running")).toBe("secondary");
  });

  it("stays neutral on a status it does not know", () => {
    // A newer runner inventing a status must not have it rendered as an outcome.
    expect(runBadgeVariant("rehearsing")).toBe("outline");
  });
});
